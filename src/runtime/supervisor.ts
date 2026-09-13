import { fork, type ChildProcess } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { Runtime, Service } from '../core/service.js';
import type { Session, Run } from '../core/types.js';
import type { SendInput } from '../contracts.js';
import type { OperatorConfig } from '../config.js';
import type { Store } from '../store/database.js';
import { Sandbox } from '../sandbox/backend.js';
import { validateWorkerMessage } from './ipc.js';
import { within } from '../helpers/file-operations.js';
import { digest } from '../core/idempotency.js';
import { fail, SpokeError } from '../core/errors.js';
import { redact } from '../security/redaction.js';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => {}); return { promise, resolve, reject }; }
type Ready = Awaited<ReturnType<Runtime['setup']>>;
type Done = Awaited<ReturnType<Runtime['begin']>>;
type Active = { session: Session; run: Run; scratch: string | null; child?: ChildProcess; ready: ReturnType<typeof deferred<Ready>>;
  done: ReturnType<typeof deferred<Done>>; closing: boolean; hadShell: boolean; uncertainTool?: boolean; result?: Done; heartbeat?: NodeJS.Timeout; wall?: NodeJS.Timeout;
  terminalValidation?: Promise<void>; questionCalls: Map<string, string>; steerAcks: Map<string, ReturnType<typeof deferred<void>>> };
const here = dirname(fileURLToPath(import.meta.url));
const contact = z.strictObject({ kind: z.enum(['note','question','improvement']), message: z.string().min(1).max(65536),
  evidence: z.array(z.strictObject({ path: z.string().optional(), line: z.number().int().positive().optional(), detail: z.string() })).optional() });
export class Supervisor implements Runtime {
  private readonly active = new Map<string, Active>();
  private readonly cleanup = new Map<string, 'confirmed' | 'unconfirmed'>();
  private readonly mutationLocks = new Map<string, Promise<unknown>>();
  private service?: Service;
  readonly sandbox: Sandbox;
  constructor(private readonly config: OperatorConfig, private readonly store: Store, private readonly runtimeRoot: string) { this.sandbox = new Sandbox(config, runtimeRoot); }
  attach(service: Service) { this.service = service; }
  private post(entry: Active, value: object) {
    if (!entry.child?.connected) fail('WORKER_EXITED');
    const message = { version: 1, runId: entry.run.id, ...value };
    if (Buffer.byteLength(JSON.stringify(message)) > 1024 * 1024) fail('LIMIT_EXCEEDED');
    entry.child.send(message, error => { if (error) { entry.ready.reject(error); entry.done.reject(error); } });
  }
  async setup(session: Session, run: Run): Promise<Ready> {
    if (this.active.has(run.id)) fail('SESSION_BUSY');
    const entry: Active = { session, run, scratch: null, ready: deferred(), done: deferred(), closing: false, hadShell: false, questionCalls: new Map(), steerAcks: new Map() };
    this.active.set(run.id, entry);
    entry.wall = setTimeout(() => { void this.service?.cancel(run.id, 'WALL_TIME_LIMIT'); }, Math.max(1, session.policy.limits.wall_time_ms - (Date.now() - run.created)));
    let manifest: Record<string, unknown> = { execution_mode: 'no-execution-tools', sandbox_scope: null, backend: null, preflight_id: null, shell_scratch_root: null,
      tools: session.input.tools, policy_hash: session.policy.policy_hash, file_write_roots: [], shell_write_roots: [], limits: session.policy.limits };
    if (session.input.tools.length) {
      entry.scratch = await this.sandbox.createScratch(run.id);
      const backend = await this.sandbox.preflight(run.id, session.policy, entry.scratch);
      manifest = { ...session.policy, execution_mode: 'sandboxed-tools', sandbox_scope: 'tool-subprocesses', backend,
        preflight_id: backend.preflight_id, shell_scratch_root: entry.scratch, shell_read_model: 'system-readable-with-explicit-denies' };
    }
    if (entry.closing) fail('RUN_NOT_ACTIVE');
    const sessionDir = join(this.store.directory, 'sessions', session.id); await mkdir(sessionDir, { recursive: true, mode: 0o700 });
    const context: { path: string; content: string }[] = session.policy.resources?.context.map(({ path, content }) => ({ path, content })) ?? [];
    if (!session.policy.resources && session.input.project_context === 'agents') {
      const ancestors: string[] = []; let path = session.policy.cwd;
      while (within(session.policy.workspace, path)) { ancestors.unshift(path); if (path === session.policy.workspace) break; path = dirname(path); }
      for (const parent of ancestors) try { const path = join(parent, 'AGENTS.md'); context.push({ path, content: await readFile(path, 'utf8') }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    for (const path of session.policy.resources ? [] : session.input.context_files) {
      const resolved = resolve(session.policy.cwd, path);
      if (!within(session.policy.workspace, resolved) || session.policy.protected_read_paths.some(path => within(path, resolved))) fail('PATH_NOT_ALLOWED');
      context.push({ path: resolved, content: await readFile(resolved, 'utf8') });
    }
    if (context.reduce((bytes, file) => bytes + Buffer.byteLength(file.content), 0) > 65536) fail('LIMIT_EXCEEDED');
    if (entry.closing) fail('RUN_NOT_ACTIVE');
    const environment: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: sessionDir };
    for (const key of ['NODE_OPTIONS','NODE_PATH','BASH_ENV','ENV','LD_PRELOAD','DYLD_INSERT_LIBRARIES']) delete environment[key];
    const child = fork(join(this.runtimeRoot, 'dist/runtime/worker-entry.js'), [], { cwd: session.policy.cwd, execPath: process.execPath, env: environment,
      stdio: ['ignore','pipe','pipe','ipc'], serialization: 'json', detached: true }); entry.child = child;
    let diagnosticBytes = 0;
    const discardBounded = (bytes: Buffer) => { diagnosticBytes += bytes.length; if (diagnosticBytes > 65536) { entry.ready.reject(new Error('LIMIT_EXCEEDED')); entry.done.reject(new Error('LIMIT_EXCEEDED')); child.kill('SIGTERM'); } };
    child.stdout!.on('data', discardBounded); child.stderr!.on('data', discardBounded);
    const startup = setTimeout(() => { entry.ready.reject(new Error('WORKER_STARTUP_TIMEOUT')); child.kill('SIGTERM'); }, 30000);
    entry.heartbeat = setInterval(() => { if (child.connected) this.post(entry, { kind: 'heartbeat' }); }, 5000);
    child.on('message', value => { const handling = this.message(entry, value, sessionDir, manifest); if (value && typeof value === 'object' && 'kind' in value && value.kind === 'done') entry.terminalValidation = handling;
      void handling.catch(error => {
      entry.ready.reject(error); entry.done.reject(error); void this.cancel(run.id);
    }); });
    child.once('error', error => { entry.ready.reject(error); entry.done.reject(error); });
    child.once('close', () => { void (async () => {
      clearTimeout(startup); clearInterval(entry.heartbeat); clearTimeout(entry.wall);
      const toolCleanup = await this.sandbox.cancel(run.id);
      await entry.terminalValidation?.catch(error => { entry.done.reject(error); });
      const cleanup = entry.hadShell || entry.uncertainTool || toolCleanup === 'unconfirmed' ? 'unconfirmed' : 'confirmed';
      this.cleanup.set(run.id, cleanup); this.active.delete(run.id);
      if (entry.result) entry.result.cleanup = cleanup;
      if (entry.result) entry.done.resolve(entry.result); else entry.done.reject(new Error('WORKER_EXITED'));
      entry.ready.reject(new Error('WORKER_EXITED'));
      for (const ack of entry.steerAcks.values()) ack.reject(new Error('WORKER_EXITED'));
    })(); });
    const outputDirectory = join(this.store.directory, 'runs', run.id); await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    this.post(entry, { kind: 'init', session, run, config: this.config, sessionDir, context, manifest, outputPath: join(outputDirectory, 'worker-output.txt') });
    const ready = await entry.ready.promise; clearTimeout(startup); return ready;
  }
  private async message(entry: Active, raw: unknown, sessionDir: string, manifest: Record<string, unknown>) {
    const message = validateWorkerMessage(raw, entry.run.id);
    if (message.kind === 'ready') {
      const effective = z.object({ model: z.object({ provider: z.string(), id: z.string() }), thinking: z.string(), policy_hash: z.string() }).parse(message.effective);
      if (effective.model.provider !== entry.session.input.model.provider || effective.model.id !== entry.session.input.model.id || effective.policy_hash !== manifest.policy_hash || !within(sessionDir, message.piSession.path)) fail('MODEL_CONFIGURATION_MISMATCH');
      if (entry.session.input.thinking !== undefined && effective.thinking !== entry.session.input.thinking) fail('UNSUPPORTED_THINKING');
      entry.ready.resolve({ piSession: message.piSession, effective: { ...manifest, model: effective.model, thinking: effective.thinking } });
    } else if (message.kind === 'done') {
      if (!within(sessionDir, message.checkpoint.path) || message.checkpoint.path !== this.store.getSession(entry.session.id)?.piSession?.path) fail('STATE_CORRUPT');
      const hash = createHash('sha256').update(await readFile(message.checkpoint.path)).digest('hex');
      if (hash !== message.checkpoint.hash) fail('STATE_CORRUPT');
      if (message.outputPath !== join(this.store.directory, 'runs', entry.run.id, 'worker-output.txt')) fail('STATE_CORRUPT');
      const { bytes, ...checkpoint } = message.checkpoint;
      entry.result = { output: await readFile(message.outputPath, 'utf8'), checkpoint: { ...checkpoint, ...(bytes === undefined ? {} : { bytes }) }, cleanup: entry.hadShell || entry.uncertainTool ? 'unconfirmed' : 'confirmed' };
    } else if (message.kind === 'error') {
      const code = ['PROVIDER_ERROR','UNSUPPORTED_THINKING','MODEL_CONFIGURATION_MISMATCH','MODEL_UNAVAILABLE','SESSION_NOT_RESUMABLE','LIMIT_EXCEEDED'].includes(message.code) ? message.code : 'WORKER_EXITED';
      const error = new SpokeError(code, redact(message.message)); entry.ready.reject(error); entry.done.reject(error);
    } else if (message.kind === 'event') {
      if (message.event === 'limit_reached') { void this.service?.cancel(entry.run.id, 'MAX_TURNS'); return; }
      if (message.event === 'steer_delivered') {
        const value = z.object({ request_key: z.string() }).parse(message.payload); entry.steerAcks.get(value.request_key)?.resolve(); entry.steerAcks.delete(value.request_key);
      } else if (['compaction_start','compaction_end','agent_settled'].includes(message.event)) this.service!.recordEvent(entry.run.id, message.event, {});
    } else {
      if (entry.closing || !['running','waiting_input'].includes(this.store.getRun(entry.run.id)?.state ?? '')) fail('RUN_NOT_ACTIVE');
      if (message.tool === 'contact_main') {
        const request = contact.parse(message.args);
        if (request.kind === 'question') {
          const question = this.service!.question(entry.run.id, message.callId, redact(request.message));
          entry.questionCalls.set(question.id, message.callId);
          if (question.state === 'answered') this.post(entry, { kind: 'tool_result', callId: message.callId, result: { content: [{ type: 'text', text: question.answer }], details: {} } });
        } else {
          this.service!.recordEvent(entry.run.id, request.kind, { message: redact(request.message), evidence: (request.evidence ?? []).map(item => ({ ...item, detail: redact(item.detail), ...(item.path ? { path: redact(item.path) } : {}) })) }, 'contact:' + message.callId);
          this.post(entry, { kind: 'tool_result', callId: message.callId, result: { content: [{ type: 'text', text: 'Recorded for the main agent.' }], details: {} } });
        }
        return;
      }
      if (!entry.scratch) fail('SANDBOX_UNAVAILABLE');
      const previous = this.store.invocations(entry.run.id).find(item => item.toolCallId === message.callId);
      if (previous) fail('STATE_CORRUPT', 'Tool invocation cannot be automatically replayed');
      const invocation = { id: 'inv_' + randomUUID(), runId: entry.run.id, toolCallId: message.callId, kind: message.tool, policyHash: entry.session.policy.policy_hash,
        state: 'accepted' as const, evidence: { request_hash: digest(message.args) }, cleanup: 'pending' as const };
      this.store.transaction(() => { this.store.putInvocation(invocation); this.store.event(entry.run.id, 'tool_started', { invocation_id: invocation.id, tool: message.tool }); });
      const execute = async () => {
        if (entry.closing) fail('RUN_NOT_ACTIVE');
        this.store.transaction(() => this.store.putInvocation({ ...invocation, state: 'launched' }));
        try {
          if (message.tool === 'bash') entry.hadShell = true;
          const result = await this.sandbox.tool(entry.run.id, entry.session.policy, entry.scratch!, message.tool, message.args);
          this.store.transaction(() => { this.store.putInvocation({ ...invocation, state: 'completed', cleanup: result.cleanup,
            evidence: { ...invocation.evidence, exit_code: result.evidence.code, policy_hash: result.evidence.policyHash, launcher_pid: result.evidence.launcherPid } });
            this.store.event(entry.run.id, 'tool_ended', { invocation_id: invocation.id, cleanup_status: result.cleanup, exit_code: result.evidence.code }); });
          if (!entry.closing) this.post(entry, { kind: 'tool_result', callId: message.callId, result: result.result });
        } catch (error) {
          entry.uncertainTool = true;
          this.store.transaction(() => this.store.putInvocation({ ...invocation, state: 'uncertain', cleanup: 'unconfirmed', evidence: { ...invocation.evidence, error: 'TOOL_FAILED' } }));
          if (!entry.closing) this.post(entry, { kind: 'tool_result', callId: message.callId, result: null, error: redact(error instanceof Error ? error.message : 'INTERNAL_ERROR') });
          if (error instanceof SpokeError && ['SANDBOX_SETUP_FAILED','SANDBOX_UNAVAILABLE','POLICY_CHANGED'].includes(error.code)) void this.service?.cancel(entry.run.id, error.code);
        }
      };
      const args = message.args as { path?: unknown };
      if ((message.tool === 'edit' || message.tool === 'write') && typeof args.path === 'string') {
        const key = resolve(entry.session.policy.cwd, args.path), prior = this.mutationLocks.get(key) ?? Promise.resolve();
        const work = prior.catch(() => {}).then(execute); this.mutationLocks.set(key, work);
        try { await work; } finally { if (this.mutationLocks.get(key) === work) this.mutationLocks.delete(key); }
      } else await execute();
    }
  }
  begin(runId: string): Promise<Done> { const entry = this.active.get(runId); if (!entry || entry.closing) fail('RUN_NOT_ACTIVE'); this.post(entry, { kind: 'begin' }); return entry.done.promise; }
  async send(runId: string, input: Exclude<SendInput, { kind: 'continue' }>): Promise<void> {
    const entry = this.active.get(runId); if (!entry || entry.closing) fail('RUN_NOT_ACTIVE');
    if (input.kind === 'reply') {
      const callId = entry.questionCalls.get(input.question_id); if (!callId) fail('QUESTION_CLOSED');
      this.post(entry, { kind: 'tool_result', callId, result: { content: [{ type: 'text', text: input.message }], details: {} } }); entry.questionCalls.delete(input.question_id);
    } else {
      const ack = deferred<void>(); entry.steerAcks.set(input.request_key, ack); this.post(entry, { kind: 'steer', requestKey: input.request_key, message: input.message });
      const timer = setTimeout(() => ack.reject(new Error('STEER_DELIVERY_UNCERTAIN')), 5000); try { await ack.promise; } finally { clearTimeout(timer); }
    }
  }
  async cancel(runId: string): Promise<'confirmed' | 'unconfirmed'> {
    const entry = this.active.get(runId); if (!entry) return this.cleanup.get(runId) ?? 'confirmed'; entry.closing = true;
    clearTimeout(entry.wall); clearInterval(entry.heartbeat);
    const tools = await this.sandbox.cancel(runId);
    let workerExited = !entry.child || entry.child.exitCode !== null || entry.child.signalCode !== null;
    if (entry.child && entry.child.exitCode === null && entry.child.signalCode === null) {
      if (entry.child.connected) this.post(entry, { kind: 'abort' });
      const child = entry.child;
      await new Promise<void>(done => {
        const term = setTimeout(() => child.kill('SIGTERM'), 5000), kill = setTimeout(() => child.kill('SIGKILL'), 7000);
        const deadline = setTimeout(done, 9000);
        child.once('close', () => { workerExited = true; clearTimeout(term); clearTimeout(kill); clearTimeout(deadline); done(); });
      });
    }
    entry.ready.reject(new Error('RUN_NOT_ACTIVE')); entry.done.reject(new Error('RUN_NOT_ACTIVE'));
    const cleanup = !workerExited || entry.hadShell || entry.uncertainTool || tools === 'unconfirmed' ? 'unconfirmed' : 'confirmed';
    this.cleanup.set(runId, cleanup); this.active.delete(runId); return cleanup;
  }
}
