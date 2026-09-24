import { realpath, access } from 'node:fs/promises';
import { platform } from 'node:os';
import type { createApplication } from './app.js';
import { catalogSchema, sessionsSchema, observeSchema, cancelSchema } from './contracts.js';
import { skillCatalog } from './pi/skills.js';
import { within } from './helpers/file-operations.js';
import { digest } from './core/idempotency.js';
import { terminalStates, type Run } from './core/types.js';
import { fail, invalidInput } from './core/errors.js';
import { redact } from './security/redaction.js';

type Application = Awaited<ReturnType<typeof createApplication>>;
function preview(text: string, max = 4096) {
  const bytes = Buffer.from(text); let end = Math.min(bytes.length, max);
  while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0,end).toString(), truncated: end < bytes.length };
}
function terminalSummary(run: Run) {
  const terminal = run.terminal ?? { failure_stage: null, error_category: null, diagnostic: null, diagnostic_truncated: false,
    worker_exit_code: null, worker_exit_signal: null, provider_stop_reason: null, final_text_empty: null };
  const bounded = { ...terminal };
  while (Buffer.byteLength(JSON.stringify(bounded)) > 1600 && bounded.diagnostic) {
    bounded.diagnostic = preview(bounded.diagnostic, Math.floor(Buffer.byteLength(bounded.diagnostic) / 2)).text;
    bounded.diagnostic_truncated = true;
  }
  return bounded;
}
function page<T>(items: T[], cursor: string | undefined, limit: number, scope: unknown) {
  const revision = digest({ scope, items }).slice(0,24); let offset = 0;
  if (cursor) {
    let value; try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString()); } catch { fail('INVALID_ARGUMENT', 'Invalid cursor'); }
    if (value.revision !== revision || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset > items.length) fail('INVALID_ARGUMENT', 'Stale or invalid cursor');
    offset = value.offset;
  }
  const selected: T[] = []; let bytes = 0;
  for (const item of items.slice(offset, offset + limit)) {
    const size = Buffer.byteLength(JSON.stringify(item)); if (size > 14000) fail('LIMIT_EXCEEDED', 'Catalog entry exceeds response envelope');
    if (bytes + size > 14000) break; selected.push(item); bytes += size;
  }
  const next = offset + selected.length;
  return { protocol_version: 1, items: selected, next_cursor: next < items.length ? Buffer.from(JSON.stringify({ revision, offset: next })).toString('base64url') : null };
}
function runSummary(run: Run) {
  const reason = run.reason === null ? null : preview(redact(run.reason), 512);
  return { run_id: run.id, session_id: run.sessionId, state: run.state, reason: reason?.text ?? null, reason_truncated: reason?.truncated ?? false, cleanup_status: run.cleanup,
    created_at: run.created, updated_at: run.updated, elapsed_ms: (terminalStates.includes(run.state) ? run.updated : Date.now()) - run.created };
}
function resourceSummary(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const { resources, ...rest } = value as Record<string, unknown>;
  if (!resources || typeof resources !== 'object') return rest;
  const manifest = resources as { context?: { path: string; hash: string }[]; images?: { source: string; hash: string; mimeType: string }[]; skills?: unknown[] };
  return { ...rest, resources: { context: manifest.context?.map(({ path, hash }) => ({ path, hash })),
    images: manifest.images?.map(({ source, hash, mimeType }) => ({ source, hash, mimeType })), skills: manifest.skills } };
}

export class Api {
  private readonly catalogTimestamp = new Date().toISOString();
  constructor(private readonly app: Application) {}
  private async workspace(cwd: string) {
    const path = await realpath(cwd).catch(() => fail('PATH_NOT_ALLOWED'));
    const roots = await Promise.all(this.app.config.workspace_roots.map(root => realpath(root)));
    const workspace = roots.filter(root => within(root, path)).sort((a,b) => b.length-a.length)[0];
    if (!workspace) fail('PATH_NOT_ALLOWED'); return { cwd: path, workspace };
  }
  async catalog(raw: unknown) {
    const parsed = catalogSchema.safeParse(raw); if (!parsed.success) invalidInput(parsed.error.issues); const input = parsed.data;
    const scope = input.cwd ? await this.workspace(input.cwd) : null;
    let items: unknown[];
    if (input.kind === 'models') {
      // Startup deliberately skips Pi's availability refresh. Its empty auth
      // snapshot cannot establish that authentication is unconfigured. Listing
      // credential metadata performs no key-command execution or token refresh.
      const storedProviders = new Set((await this.app.models.listCredentials()).map(item => item.providerId));
      items = this.app.models.getModels().filter(model => !this.app.config.allowed_models || this.app.config.allowed_models.some(allowed => allowed.provider === model.provider && allowed.id === model.id))
        .map(model => {
          const description = this.app.config.allowed_models?.find(allowed => allowed.provider === model.provider && allowed.id === model.id)?.description ?? null;
          return { provider: model.provider, id: model.id, name: model.name, description,
            description_provenance: description === null ? null : 'operator configuration', input_modalities: model.input, context_window: model.contextWindow,
            max_output_tokens: model.maxTokens, reasoning: model.reasoning, supported_thinking: model.reasoning ? (model.thinkingLevelMap ? Object.entries(model.thinkingLevelMap).filter(([, value]) => value !== null).map(([level]) => level) : null) : ['off'],
            thinking_metadata_complete: !model.reasoning,
            authentication_configured: storedProviders.has(model.provider) || this.app.models.hasConfiguredAuth(model.provider) ? true : null, live_verified: false,
            metadata_provenance: 'Pi ModelRuntime: built-in/cache/operator configuration', catalog_timestamp: this.catalogTimestamp };
        })
        .sort((a,b) => (a.provider + ':' + a.id).localeCompare(b.provider + ':' + b.id));
    } else if (input.kind === 'skills') {
      if (!scope) fail('INVALID_ARGUMENT', 'cwd is required for skill discovery');
      items = (await skillCatalog(this.app.config, scope.cwd)).map(({ id, disabled, ...item }) => ({ ...item, skill_id: id, available_for_model_invocation: !disabled }));
    } else {
      const backendPresent = ['darwin', 'linux'].includes(platform()) && await access(platform() === 'linux' ? '/usr/bin/bwrap' : '/usr/bin/sandbox-exec').then(() => true, () => false);
      items = this.app.config.allowed_tools.map(name => ({ name, description: name === 'bash' ? 'Sandboxed shell: source read-only, network denied, private scratch writable including deletion. Descendant cleanup is unconfirmed; completed shell work ends interrupted.' : ['write','edit'].includes(name) ? 'Fixed sandboxed file helper; explicit independent file-write roots required.' : 'Fixed sandboxed read/search helper.',
        availability: backendPresent ? 'preflight_required' : 'sandbox_unavailable', sandbox_backend: 'srt', sandbox_version: '0.0.76', tool_network: 'none',
        cwd: scope?.cwd ?? null, file_write_ceiling: scope ? this.app.config.permissions.file_write_roots.filter(root => within(scope.workspace, root)) : [],
        shell_write_ceiling: scope ? this.app.config.permissions.shell_write_roots.filter(root => within(scope.workspace, root)) : [],
        project_shell_write_policy: 'rejected: SANDBOX_POLICY_UNSUPPORTED', protected_exclusions: ['.git','.codex','.agents','.pi','.pi-spoke','AGENTS.md','operator configuration','credentials','runtime/state','selected skills'],
        mandatory_sandbox: true }));
    }
    if (input.query) { const query = input.query.toLowerCase(); items = items.filter(item => {
      const value = item as { name?: string; description?: string | null; id?: string; provider?: string }; return [value.name,value.description,value.id,value.provider].some(field => field?.toLowerCase().includes(query));
    }); }
    return { ...page(items, input.cursor, input.limit, { kind: input.kind, cwd: scope?.cwd, query: input.query }), instance_id: this.app.instanceId,
      resource_limits: { run: { wall_time_ms: { maximum: this.app.config.limits.max_run_wall_time_ms, unit: 'ms' }, max_turns: { maximum: this.app.config.limits.max_run_turns, unit: 'turns' } },
        context: { single_file_bytes: { maximum: 65536, unit: 'bytes' }, aggregate_bytes: { maximum: 65536, unit: 'bytes' } },
        output_page_bytes: { minimum: 1, maximum: 16384, unit: 'bytes' } } };
  }
  async sessions(raw: unknown) {
    const parsed = sessionsSchema.safeParse(raw); if (!parsed.success) invalidInput(parsed.error.issues); const input = parsed.data;
    const cwd = input.cwd ? (await this.workspace(input.cwd)).cwd : undefined;
    const items = this.app.store.sessions().filter(session => !cwd || session.policy.cwd === cwd).map(session => {
      const run = this.app.store.getRun(session.lastRunId)!; const terminal = terminalStates.includes(run.state);
      return { instance_id: this.app.instanceId, session_id: session.id, created_at: session.created, updated_at: session.updated, model: session.input.model, cwd: session.policy.cwd,
        latest_run_id: run.id, latest_state: run.state, active_run_id: terminal ? null : run.id, checkpoint_available: !!session.checkpoint?.safe,
        continuation_eligible: terminal && !!session.checkpoint?.safe && ['confirmed','operator_attested'].includes(run.cleanup), revalidation_required: true,
        continuation_note: 'Eligibility is provisional; continuation revalidates expected last run, resources, authority, and cleanup.' };
    });
    return { ...page(items, input.cursor, input.limit, { cwd }), instance_id: this.app.instanceId };
  }
  async observe(raw: unknown) {
    const parsed = observeSchema.safeParse(raw); if (!parsed.success) invalidInput(parsed.error.issues,
      raw && typeof raw === 'object' && 'view' in raw && raw.view === 'question' ? 8192 : 16384); const input = parsed.data;
    if (input.view === 'output') return { protocol_version: 1, instance_id: this.app.instanceId, run_id: input.run_id, ...await this.app.service.output(input.run_id, input.offset_bytes, input.max_bytes) };
    const observed = await this.app.service.observe(input.run_id, input.after_seq, input.wait_ms, input.limit);
    const output = await this.app.service.output(input.run_id, 0, 3072);
    const events: object[] = []; let bytes = 0, truncated = false;
    for (const event of observed.events) {
      const payload = preview(redact(JSON.stringify(resourceSummary(event.payload))), 2048);
      const item = { seq: event.seq, type: event.type, created_at: event.created, payload: payload.truncated ? { preview: payload.text, truncated: true } : JSON.parse(payload.text) };
      const size = Buffer.byteLength(JSON.stringify(item)); if (bytes + size > 4096) { truncated = true; break; } events.push(item); bytes += size;
    }
    const questions = observed.questions.map(question => ({ question_id: question.id, ...preview(redact(question.message), 768) }));
    const effective = preview(JSON.stringify(resourceSummary(observed.run.effective)), 3072);
    const result = { protocol_version: 1, instance_id: this.app.instanceId, ...runSummary(observed.run), timed_out: observed.timed_out, durability_error: observed.durability_error,
      usage: observed.run.metrics ?? null, terminal: terminalSummary(observed.run),
      tool_count: this.app.store.invocations(input.run_id).length, tool_outcomes: observed.tool_outcomes,
      effective_config: effective.truncated ? { preview: effective.text, truncated: true } : JSON.parse(effective.text),
      questions: questions.slice(0,4), questions_truncated: questions.length > 4, events,
      next_after_seq: events.length ? (events.at(-1) as { seq: number }).seq : input.after_seq,
      events_truncated: truncated || this.app.store.events(input.run_id, events.length ? (events.at(-1) as { seq: number }).seq : input.after_seq, 1).length > 0,
      output_preview: output.text, output_truncated: output.truncated, next_offset_bytes: output.next_offset_bytes };
    while (Buffer.byteLength(JSON.stringify(result)) > 16000) {
      if (result.output_preview) {
        result.output_preview = preview(result.output_preview, Math.floor(Buffer.byteLength(result.output_preview) / 2)).text;
        result.output_truncated = true; result.next_offset_bytes = Buffer.byteLength(result.output_preview);
      } else if (result.events.length) {
        result.events.pop(); result.events_truncated = true;
        result.next_after_seq = result.events.length ? (result.events.at(-1) as { seq: number }).seq : input.after_seq;
      } else if (result.questions.some(question => question.text.length)) {
        const question = result.questions.findLast(item => item.text.length)!;
        question.text = preview(question.text, Math.floor(Buffer.byteLength(question.text) / 2)).text; question.truncated = true;
      } else if (result.effective_config && typeof result.effective_config === 'object' &&
        'preview' in result.effective_config && typeof result.effective_config.preview === 'string' && result.effective_config.preview.length) {
        result.effective_config = { preview: preview(result.effective_config.preview,
          Math.floor(Buffer.byteLength(result.effective_config.preview) / 2)).text, truncated: true };
      } else if (result.effective_config) {
        result.effective_config = { preview: preview(JSON.stringify(result.effective_config), 1024).text, truncated: true };
      } else fail('LIMIT_EXCEEDED', 'Observation exceeds response envelope');
    }
    return result;
  }
  async cancel(raw: unknown) { const parsed = cancelSchema.safeParse(raw); if (!parsed.success) invalidInput(parsed.error.issues); return { protocol_version: 1, instance_id: this.app.instanceId, ...runSummary(await this.app.service.cancel(parsed.data.run_id, parsed.data.reason)) }; }
  spawn(raw: unknown) { return this.app.service.spawn(raw); }
  send(raw: unknown) { return this.app.service.send(raw); }
}
