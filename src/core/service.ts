import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { spawnSchema, sendSchema, type SpawnInput, type SendInput } from '../contracts.js';
import type { ResolvedPolicy } from '../security/policy.js';
import type { Store } from '../store/database.js';
import type { Session, Run, Receipt, Command, Checkpoint, CleanupStatus, RunState, Question } from './types.js';
import { terminalStates } from './types.js';
import { assertTransition } from './state-machine.js';
import { digest } from './idempotency.js';
import { fail, SpokeError } from './errors.js';

export interface Runtime {
  setup(session: Session, run: Run): Promise<{ piSession: { id: string; path: string }; effective: unknown }>;
  begin(runId: string): Promise<{ output: string; checkpoint: Checkpoint; cleanup: 'confirmed' | 'unconfirmed' }>;
  send(runId: string, input: Exclude<SendInput, { kind: 'continue' }>): Promise<void>;
  cancel(runId: string): Promise<'confirmed' | 'unconfirmed'>;
}
export class Service {
  private readonly changes = new EventEmitter();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly stopping = new Map<string, Promise<Run>>();
  private durabilityError: unknown;
  private shuttingDown = false;
  constructor(readonly store: Store, private readonly runtime: Runtime,
    private readonly prepare: (input: SpawnInput) => Promise<ResolvedPolicy>, private readonly maxActive = 3) {}
  private run(id: string): Run { const run = this.store.getRun(id); if (!run) fail('INVALID_ARGUMENT', 'Unknown run'); return run; }
  private session(id: string): Session { const session = this.store.getSession(id); if (!session) fail('INVALID_ARGUMENT', 'Unknown session'); return session; }
  private prior(key: string, operation: string, input: unknown): Receipt | undefined {
    const command = this.store.getCommand(key); if (!command) return undefined;
    if (command.operation !== operation || command.hash !== digest(input)) fail('IDEMPOTENCY_CONFLICT');
    return command.receipt;
  }
  private transition(run: Run, state: RunState, changes: Partial<Run> = {}) {
    assertTransition(run.state, state);
    const next = { ...run, ...changes, state, updated: Date.now() };
    this.store.putRun(next); this.store.event(run.id, state, { state, reason: next.reason, cleanup_status: next.cleanup });
    return next;
  }
  private notify(id: string) { this.changes.emit(id); }
  recordEvent(runId: string, type: string, payload: unknown, source?: string): number {
    this.run(runId);
    const seq = this.store.transaction(() => this.store.event(runId, type, payload, source));
    this.notify(runId); return seq;
  }
  async spawn(raw: unknown): Promise<Receipt> {
    if (this.shuttingDown) fail('RUN_NOT_ACTIVE', 'Supervisor is shutting down');
    if (this.durabilityError) fail('STATE_WRITE_FAILED');
    const parsed = spawnSchema.safeParse(raw); if (!parsed.success) fail('INVALID_ARGUMENT'); const input = parsed.data;
    const previous = this.prior(input.request_key, 'spawn', input); if (previous) return previous;
    const policy = await this.prepare(input);
    const receipt = this.store.transaction(() => {
      if (this.shuttingDown) fail('RUN_NOT_ACTIVE', 'Supervisor is shutting down');
      const previous = this.prior(input.request_key, 'spawn', input); if (previous) return previous;
      if (this.store.activeCount() >= this.maxActive) fail('CAPACITY_EXCEEDED');
      const now = Date.now(), sessionId = 'ses_' + randomUUID(), runId = 'run_' + randomUUID();
      const session: Session = { id: sessionId, input, policy, created: now, updated: now, lastRunId: runId, checkpoint: null, piSession: null };
      this.store.putSession(session);
      return this.reserve(session, runId, input, 'spawn');
    });
    this.dispatch(receipt.run_id);
    return receipt;
  }
  private reserve(session: Session, runId: string, input: SpawnInput | SendInput, operation: string): Receipt {
    const now = Date.now();
    if (session.policy.resources) session = { ...session, policy: { ...session.policy, resources: { ...session.policy.resources,
      images: this.store.copyInputs(runId, session.policy.resources.images) } } };
    const run: Run = { id: runId, sessionId: session.id, input, state: 'starting', created: now, updated: now, effective: null, reason: null, cleanup: 'pending', outputPath: null };
    this.store.putRun(run);
    this.store.putSession({ ...session, lastRunId: runId, updated: now });
    const receipt: Receipt = { protocol_version: 1, session_id: session.id, run_id: runId, state: 'starting', receipt: 'accepted', effective_config: null };
    this.store.putCommand({ key: input.request_key, operation, hash: digest(input), receipt, delivery: 'accepted' });
    this.store.event(runId, 'accepted', receipt);
    return receipt;
  }
  private dispatch(runId: string): void {
    if (this.tasks.has(runId)) return;
    const run = this.run(runId), command = this.store.getCommand(run.input.request_key)!;
    if (command.delivery !== 'accepted' || run.state !== 'starting') return;
    // Mark before IPC. If dispatch/ack becomes ambiguous, startup recovery never replays it.
    this.store.transaction(() => this.store.putCommand({ ...command, delivery: 'dispatched' }));
    const task = Promise.resolve().then(async () => {
      try {
        if (this.run(runId).state !== 'starting') return;
        const session = this.session(run.sessionId);
        const ready = await this.runtime.setup(session, run);
        if (this.run(runId).state !== 'starting') return;
        this.store.transaction(() => {
          this.store.putSession({ ...this.session(run.sessionId), piSession: ready.piSession });
          this.transition(this.run(runId), 'running', { effective: ready.effective });
          this.store.putCommand({ ...command, delivery: 'delivered' });
          this.store.event(runId, 'effective_configuration', ready.effective);
        });
        this.notify(runId);
        const result = await this.runtime.begin(runId);
        if (this.run(runId).state !== 'running') return;
        if (!result.checkpoint.safe) fail('STATE_CORRUPT', 'Unsafe terminal checkpoint');
        let outputPath: string;
        try { outputPath = this.store.writeArtifact(runId, 'output.txt', result.output); }
        catch { fail('STATE_WRITE_FAILED', 'Terminal output could not be durably stored'); }
        this.store.transaction(() => {
          this.store.putSession({ ...this.session(run.sessionId), checkpoint: result.checkpoint, updated: Date.now() });
          this.transition(this.run(runId), result.cleanup === 'confirmed' ? 'completed' : 'interrupted', { outputPath, cleanup: result.cleanup,
            reason: result.cleanup === 'confirmed' ? null : 'CLEANUP_UNCONFIRMED' });
        });
      } catch (error) {
        const current = this.run(runId);
        if (!terminalStates.includes(current.state) && current.state !== 'stopping') {
          const cleanup = await this.runtime.cancel(runId).catch(() => 'unconfirmed' as const);
          this.store.transaction(() => this.transition(this.run(runId), cleanup === 'confirmed' ? 'failed' : 'interrupted', {
            cleanup, reason: error instanceof SpokeError ? error.code : 'WORKER_EXITED',
          }));
        }
      } finally { this.tasks.delete(runId); this.notify(runId); }
    });
    // A storage failure cannot be turned into successful completion. Surface it through drain/shutdown.
    this.tasks.set(runId, task); void task.catch(error => { this.durabilityError = error; });
  }
  async send(raw: unknown): Promise<Receipt> {
    if (this.shuttingDown) fail('RUN_NOT_ACTIVE', 'Supervisor is shutting down');
    if (this.durabilityError) fail('STATE_WRITE_FAILED');
    const parsed = sendSchema.safeParse(raw); if (!parsed.success) fail('INVALID_ARGUMENT'); const input = parsed.data;
    const previous = this.prior(input.request_key, input.kind, input); if (previous) return previous;
    if (input.kind === 'continue') {
      const session = this.session(input.session_id), last = this.run(session.lastRunId);
      if (!terminalStates.includes(last.state)) fail('SESSION_BUSY');
      if (session.lastRunId !== input.expected_last_run_id) fail('SESSION_STALE');
      if (!session.checkpoint?.safe || !['confirmed','operator_attested'].includes(last.cleanup)) fail('SESSION_NOT_RESUMABLE');
      const nextInput = { ...session.input, suggested_skills: input.suggested_skills ?? session.input.suggested_skills,
        attachments: input.attachments, limits: input.limits };
      let policy: ResolvedPolicy;
      try { policy = await this.prepare(nextInput); } catch { fail('POLICY_CHANGED'); }
      if (policy.policy_hash !== session.policy.policy_hash) fail('POLICY_CHANGED');
      if (session.policy.resources && policy.resources) {
        if (digest(policy.resources.context) !== digest(session.policy.resources.context)) fail('RESOURCE_CHANGED');
        if (input.suggested_skills === undefined && digest(policy.resources.skills) !== digest(session.policy.resources.skills)) fail('RESOURCE_CHANGED');
      }
      const receipt = this.store.transaction(() => {
        if (this.shuttingDown) fail('RUN_NOT_ACTIVE', 'Supervisor is shutting down');
        const previous = this.prior(input.request_key, input.kind, input); if (previous) return previous;
        const current = this.session(session.id);
        if (current.lastRunId !== input.expected_last_run_id) fail('SESSION_STALE');
        if (!terminalStates.includes(this.run(current.lastRunId).state)) fail('SESSION_BUSY');
        if (this.store.activeCount() >= this.maxActive) fail('CAPACITY_EXCEEDED');
        return this.reserve({ ...current, input: nextInput, policy }, 'run_' + randomUUID(), input, 'continue');
      });
      this.dispatch(receipt.run_id); return receipt;
    }
    const receipt = this.store.transaction(() => {
      const previous = this.prior(input.request_key, input.kind, input); if (previous) return previous;
      const run = this.run(input.run_id);
      if (input.kind === 'steer' && run.state === 'waiting_input') fail('QUESTION_REPLY_REQUIRED');
      if (input.kind === 'steer' && run.state !== 'running') fail('RUN_NOT_ACTIVE');
      if (input.kind === 'reply') {
        const question = this.store.question(input.question_id);
        if (!question || question.runId !== run.id || question.state !== 'open' || run.state !== 'waiting_input') fail('QUESTION_CLOSED');
        this.store.putQuestion({ ...question, state: 'answered', answer: input.message });
        this.store.event(run.id, 'question_answered', { question_id: question.id });
        if (!this.store.questions(run.id).some(q => q.state === 'open')) this.transition(run, 'running');
      }
      const receipt: Receipt = { protocol_version: 1, session_id: run.sessionId, run_id: run.id, state: run.state, receipt: 'accepted', effective_config: null };
      this.store.putCommand({ key: input.request_key, operation: input.kind, hash: digest(input), receipt, delivery: 'accepted' });
      this.store.event(run.id, input.kind + '_queued', { request_key: input.request_key });
      return receipt;
    });
    const command = this.store.getCommand(input.request_key)!;
    if (command.delivery === 'accepted') {
      this.store.transaction(() => this.store.putCommand({ ...command, delivery: 'dispatched' }));
      try {
        await this.runtime.send(input.run_id, input);
        this.store.transaction(() => {
          this.store.putCommand({ ...command, delivery: 'delivered' });
          this.store.event(input.run_id, input.kind + '_delivered', { request_key: input.request_key });
          const run = this.run(input.run_id);
          if (input.kind === 'reply' && run.state === 'waiting_input' && !this.store.questions(run.id).some(q => q.state === 'open')) this.transition(run, 'running');
        });
      } catch {
        this.store.transaction(() => { this.store.putCommand({ ...command, delivery: 'uncertain' }); this.store.event(input.run_id, input.kind + '_uncertain', { request_key: input.request_key }); });
      }
      this.notify(input.run_id);
    }
    return receipt;
  }
  question(runId: string, toolCallId: string, message: string): Question {
    const question = this.store.transaction(() => {
      const previous = this.store.questions(runId).find(q => q.toolCallId === toolCallId); if (previous) return previous;
      const run = this.run(runId); if (!['running', 'waiting_input'].includes(run.state)) fail('RUN_NOT_ACTIVE');
      const question: Question = { id: 'q_' + randomUUID(), runId, toolCallId, message, state: 'open', answer: null };
      this.store.putQuestion(question); this.store.event(runId, 'question_opened', question, 'question:' + toolCallId);
      if (run.state === 'running') this.transition(run, 'waiting_input'); return question;
    });
    this.notify(runId); return question;
  }
  async cancel(runId: string, reason = 'CANCELLED'): Promise<Run> {
    const previous = this.stopping.get(runId); if (previous) return previous;
    const current = this.run(runId); if (terminalStates.includes(current.state)) return current;
    this.store.transaction(() => {
      if (current.state !== 'stopping') this.transition(current, 'stopping', { reason });
      for (const question of this.store.questions(runId)) if (question.state === 'open') this.store.putQuestion({ ...question, state: 'closed' });
    });
    this.notify(runId);
    const task = (async () => {
      const cleanup = await this.runtime.cancel(runId).catch(() => 'unconfirmed' as const);
      const result = this.store.transaction(() => this.transition(this.run(runId), cleanup === 'confirmed' ? 'cancelled' : 'interrupted', { cleanup }));
      this.notify(runId); return result;
    })();
    this.stopping.set(runId, task);
    try { return await task; } finally { this.stopping.delete(runId); }
  }
  recoverStartup(): void {
    this.store.transaction(() => {
      for (const run of this.store.runs()) if (!terminalStates.includes(run.state)) {
        this.transition(run, 'interrupted', { cleanup: 'unconfirmed', reason: 'SUPERVISOR_LOST' });
        for (const question of this.store.questions(run.id)) if (question.state === 'open') this.store.putQuestion({ ...question, state: 'closed' });
        for (const invocation of this.store.invocations(run.id)) if (invocation.state !== 'completed') this.store.putInvocation({ ...invocation, state: 'uncertain', cleanup: 'unconfirmed' });
      }
      for (const command of this.store.commands()) if (['accepted','dispatched'].includes(command.delivery)) this.store.putCommand({ ...command, delivery: command.delivery === 'accepted' ? 'undelivered' : 'uncertain' });
    });
  }
  async observe(runId: string, after = 0, waitMs = 0, limit = 50) {
    if (waitMs < 0 || waitMs > 25000 || limit < 1 || limit > 100) fail('INVALID_ARGUMENT');
    const available = () => terminalStates.includes(this.run(runId).state) || this.store.questions(runId).some(q => q.state === 'open') || this.store.events(runId, after, 1).length > 0;
    let timedOut = false;
    if (!available() && waitMs) await new Promise<void>(resolve => {
      const ready = () => { clearTimeout(timer); this.changes.removeListener(runId, ready); resolve(); };
      const timer = setTimeout(() => { timedOut = true; ready(); }, waitMs);
      this.changes.on(runId, ready); if (available()) ready();
    });
    return { protocol_version: 1, run: this.run(runId), questions: this.store.questions(runId).filter(q => q.state === 'open'), events: this.store.events(runId, after, limit), timed_out: timedOut,
      durability_error: this.durabilityError ? 'STATE_WRITE_FAILED' : null };
  }
  async output(runId: string, offset = 0, max = 16384) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(max) || max < 1 || max > 16384) fail('INVALID_ARGUMENT');
    const path = this.run(runId).outputPath; const bytes = path ? await readFile(path) : Buffer.alloc(0);
    if (offset > bytes.length || (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80)) fail('INVALID_ARGUMENT', 'Offset must be a UTF-8 boundary');
    let end = Math.min(offset + max, bytes.length); while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    let minimum = offset + 1; while (minimum < bytes.length && (bytes[minimum]! & 0xc0) === 0x80) minimum++;
    return { text: bytes.subarray(offset, end).toString('utf8'), next_offset_bytes: end, truncated: end < bytes.length,
      ...(end === offset && offset < bytes.length ? { minimum_next_bytes: minimum - offset } : {}) };
  }
  async drain(): Promise<void> { await Promise.all([...this.tasks.values(), ...this.stopping.values()]); if (this.durabilityError) throw this.durabilityError; }
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all(this.store.runs().filter(run => !terminalStates.includes(run.state)).map(run => this.cancel(run.id, 'HOST_DISCONNECTED')));
    await this.drain();
  }
}
