import { z } from 'zod';
import { createAgentSession, ModelRuntime, SessionManager, type AgentSession, type CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent';
import { isolatedResources } from '../pi/resources.js';
import { guardedTools } from '../pi/tools.js';
import { confirmIdentity, requireModel } from '../pi/identity.js';
import { checkpoint, reopenCheckpoint } from '../pi/checkpoints.js';
import { nativeSkills } from '../pi/skills.js';
import type { Session, Run } from '../core/types.js';
import { configSchema, type OperatorConfig } from '../config.js';
import { open, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const inbound = z.discriminatedUnion('kind', [
  z.strictObject({ version: z.literal(1), kind: z.literal('init'), runId: z.string(), session: z.unknown(), run: z.unknown(), config: configSchema,
    sessionDir: z.string(), outputPath: z.string(), context: z.array(z.strictObject({ path: z.string(), content: z.string() })), manifest: z.unknown() }),
  z.strictObject({ version: z.literal(1), kind: z.literal('begin'), runId: z.string() }),
  z.strictObject({ version: z.literal(1), kind: z.literal('steer'), runId: z.string(), requestKey: z.string(), message: z.string() }),
  z.strictObject({ version: z.literal(1), kind: z.literal('tool_result'), runId: z.string(), callId: z.string(), result: z.unknown(), error: z.string().optional() }),
  z.strictObject({ version: z.literal(1), kind: z.literal('abort'), runId: z.string() }),
  z.strictObject({ version: z.literal(1), kind: z.literal('heartbeat'), runId: z.string() }),
]);
let runId = '', session: AgentSession | undefined, initialized = false, begun = false, stopped = false, lastHeartbeat = Date.now();
let failureStage: 'setup' | 'provider' | 'finalization' | 'worker' = 'setup';
let providerDiagnostic: string | null = null;
function reportedHttpFailure(message: string | undefined): string | null {
  // Pi's public errorMessage can contain a raw gateway body and appended metadata.
  // Only read an HTTP status in the leading SDK error prefix; publish no body text.
  const match = /^(?:HTTP\s+([45]\d{2})\b|([45]\d{2}):(?:\s|$)|([45]\d{2})\s+status code\b)/i.exec(message?.trimStart() ?? '');
  if (!match) return null;
  const status = match[1] ?? match[2] ?? match[3];
  return status === '503' ? 'Provider HTTP 503 (service unavailable).' : `Provider HTTP ${status}.`;
}
let savedSession: Session, run: Run, config: OperatorConfig;
let outputPath = '';
let recoveryNotice = '';
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
function send(value: object) {
  const message = { version: 1, runId, ...value };
  if (Buffer.byteLength(JSON.stringify(message)) > 1024 * 1024) throw new Error('LIMIT_EXCEEDED');
  if (process.connected) process.send!(message, error => { if (error) void stop(); });
}
async function stop() {
  if (stopped) return; stopped = true;
  for (const waiter of pending.values()) waiter.reject(new Error('CANCELLED')); pending.clear();
  await session?.abort(); session?.dispose();
  if (process.connected) process.disconnect();
}
const watchdog = setInterval(() => { if (Date.now() - lastHeartbeat > 15000) void stop(); }, 1000); watchdog.unref();
process.once('disconnect', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
process.on('message', value => { void handle(value).catch(async error => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : failureStage === 'provider' ? 'PROVIDER_ERROR' : 'WORKER_EXITED';
  const diagnostic = failureStage === 'provider' && code === 'PROVIDER_ERROR' ? providerDiagnostic : null;
  send({ kind: 'error', stage: failureStage, code,
    message: diagnostic ?? (failureStage === 'provider' && code === 'PROVIDER_ERROR' ? 'Provider reported an error.' :
      error instanceof Error ? error.message.slice(0, 4096) : 'Worker failed') }); await stop();
}); });
async function handle(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024) throw new Error('LIMIT_EXCEEDED');
  const message = inbound.parse(value);
  if (initialized && message.runId !== runId) throw new Error('IPC_IDENTITY_MISMATCH');
  if (message.kind === 'init') {
    if (initialized || stopped) throw new Error('IPC_PROTOCOL_ERROR'); initialized = true; runId = message.runId;
    savedSession = message.session as Session; run = message.run as Run; config = message.config; outputPath = message.outputPath;
    if (run.id !== runId || run.sessionId !== savedSession.id) throw new Error('IPC_IDENTITY_MISMATCH');
    const runtime = await ModelRuntime.create({ authPath: config.pi.auth_path, modelsPath: config.pi.models_path ?? null,
      allowModelNetwork: false, refreshOnCreate: false, modelsStorePath: message.sessionDir + '/model-cache.json' });
    if (stopped) return;
    const model = requireModel(runtime, savedSession.input.model);
    const resources = await isolatedResources(savedSession.policy.cwd, message.sessionDir, await nativeSkills(savedSession.policy.resources?.skills ?? []), message.context);
    if (savedSession.checkpoint && createHash('sha256').update(await readFile(savedSession.checkpoint.path)).digest('hex') !== savedSession.checkpoint.hash) {
      recoveryNotice = `Recovery: continuing from confirmed checkpoint ${savedSession.checkpoint.leaf}. The prior run may have changed the workspace; unfinished tool outcomes are uncertain and must not be automatically replayed.\n\n`;
    }
    const manager = savedSession.checkpoint ? await reopenCheckpoint(savedSession.checkpoint) : SessionManager.create(savedSession.policy.cwd, message.sessionDir);
    if (savedSession.piSession && manager.getSessionId() !== savedSession.piSession.id) throw new Error('SESSION_NOT_RESUMABLE');
    const customTools = guardedTools(savedSession.policy.cwd, savedSession.input.tools, (id, name, args) => new Promise((resolve, reject) => {
      if (stopped || pending.has(id)) { reject(new Error('RUN_NOT_ACTIVE')); return; }
      pending.set(id, { resolve, reject }); send({ kind: 'tool', callId: id, tool: name, args });
    }));
    const options: CreateAgentSessionOptions = { cwd: savedSession.policy.cwd, agentDir: message.sessionDir, modelRuntime: runtime, model,
      tools: [...savedSession.input.tools, 'contact_main'], customTools, resourceLoader: resources.loader, settingsManager: resources.settingsManager, sessionManager: manager };
    if (savedSession.input.thinking !== undefined) options.thinkingLevel = savedSession.input.thinking as CreateAgentSessionOptions['thinkingLevel'] & string;
    const created = await createAgentSession(options); session = created.session;
    if (stopped) { session.dispose(); return; }
    if (created.modelFallbackMessage) throw new Error('MODEL_CONFIGURATION_MISMATCH');
    const identity = confirmIdentity(session, savedSession.input.model, savedSession.input.thinking);
    let turns = 0;
    session.subscribe(event => {
      if (event.type === 'turn_start') {
        if (++turns > savedSession.policy.limits.max_turns) {
          send({ kind: 'event', event: 'limit_reached', payload: { reason: 'MAX_TURNS' } }); void stop();
        } else send({ kind: 'event', event: 'turn_started', payload: { turns_used: turns } });
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        providerDiagnostic = event.message.stopReason === 'error' ? reportedHttpFailure(event.message.errorMessage) : null;
        send({ kind: 'event', event: 'provider_stopped', payload: { reason: event.message.stopReason } });
      }
      if (event.type === 'turn_end') send({ kind: 'event', event: 'turn_ended', payload: {} });
      if (['compaction_start','compaction_end','agent_settled'].includes(event.type)) send({ kind: 'event', event: event.type, payload: {} });
    });
    send({ kind: 'ready', piSession: { id: manager.getSessionId(), path: manager.getSessionFile()! }, effective: { ...(message.manifest as object), ...identity } });
  } else {
    if (!initialized || message.runId !== runId) throw new Error('IPC_PROTOCOL_ERROR');
    if (message.kind === 'heartbeat') { lastHeartbeat = Date.now(); return; }
    if (message.kind === 'abort') { await stop(); return; }
    if (message.kind === 'tool_result') {
      const waiter = pending.get(message.callId); if (!waiter) throw new Error('IPC_PROTOCOL_ERROR'); pending.delete(message.callId);
      if (message.error) waiter.reject(new Error(message.error)); else waiter.resolve(message.result); return;
    }
    if (message.kind === 'steer') {
      await session!.prompt(message.message, { streamingBehavior: 'steer', expandPromptTemplates: false });
      send({ kind: 'event', event: 'steer_delivered', payload: { request_key: message.requestKey } }); return;
    }
    if (begun || stopped) throw new Error('RUN_NOT_ACTIVE'); begun = true;
    const prompt = 'task' in run.input ? run.input.task : run.input.message;
    const images = await Promise.all((savedSession.policy.resources?.images ?? []).map(async image => {
      const bytes = await readFile(image.path); if (createHash('sha256').update(bytes).digest('hex') !== image.hash) throw new Error('RESOURCE_CHANGED');
      return { type: 'image' as const, data: bytes.toString('base64'), mimeType: image.mimeType };
    }));
    const beforeMessages = session!.messages.length;
    failureStage = 'provider';
    await session!.prompt(recoveryNotice + prompt, { expandPromptTemplates: false, images });
    if (stopped) return;
    if (!session!.isIdle) throw new Error('WORKER_NOT_SETTLED');
    const last = session!.messages.findLast(message => message.role === 'assistant');
    if (!last || last.role !== 'assistant' || last.stopReason === 'error' || last.stopReason === 'aborted') throw new Error('PROVIDER_ERROR');
    const output = last.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    send({ kind: 'event', event: 'final_text', payload: { empty: output.length === 0 } });
    failureStage = 'finalization';
    const file = await open(outputPath, 'wx', 0o600); try { await file.writeFile(output); await file.sync(); } finally { await file.close(); }
    const saved = await checkpoint(session!.sessionManager);
    const turns = session!.messages.slice(beforeMessages).filter(message => message.role === 'assistant');
    const known = turns.length > 0 && turns.every(message => message.role === 'assistant' && message.usage.totalTokens > 0);
    const sum = (field: 'input' | 'output' | 'cacheRead' | 'cacheWrite') => known ? turns.reduce((total, message) => total + (message.role === 'assistant' ? message.usage[field] : 0), 0) : null;
    const cost = turns.reduce((total,message) => total + (message.role === 'assistant' ? message.usage.cost.total : 0), 0);
    send({ kind: 'done', outputPath, checkpoint: saved, metrics: { input_tokens: sum('input'), output_tokens: sum('output'), cache_read_tokens: sum('cacheRead'), cache_write_tokens: sum('cacheWrite'),
      estimated_cost_usd: known && cost > 0 ? cost : null } });
    session!.dispose(); clearInterval(watchdog); if (process.connected) process.disconnect();
  }
}
