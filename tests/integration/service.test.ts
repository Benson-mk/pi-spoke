import { mkdtemp, mkdir, rm, realpath, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { Store } from '../../src/store/database.js';
import { Service, type Runtime } from '../../src/core/service.js';
import { parseConfig } from '../../src/config.js';
import { resolvePolicy } from '../../src/security/policy.js';
import type { Run, Session } from '../../src/core/types.js';

type Result = Awaited<ReturnType<Runtime['begin']>>;
class FakeRuntime implements Runtime {
  launches = 0; sends = 0; cleanup: 'confirmed' | 'unconfirmed' = 'confirmed'; failSend = false;
  pending = new Map<string, { result: Promise<Result>; finish: (value: Result) => void }>();
  async setup(_session: Session, run: Run) {
    this.launches++;
    let finish!: (value: Result) => void;
    const result = new Promise<Result>(resolve => { finish = resolve; });
    this.pending.set(run.id, { result, finish });
    return { piSession: { id: 'fake-pi', path: '/fake-checkpoint' }, effective: { fake: true } };
  }
  begin(runId: string) { return this.pending.get(runId)!.result; }
  finish(runId: string, output = 'done') { this.pending.get(runId)!.finish({ output, checkpoint: { safe: true, path: '/fake-checkpoint', leaf: 'leaf', hash: 'hash' }, cleanup: 'confirmed' }); }
  async send() { this.sends++; if (this.failSend) throw new Error('Lost acknowledgement'); }
  async cancel(runId: string) { this.pending.get(runId)?.finish({ output: '', checkpoint: { safe: true, path: '/fake-checkpoint', leaf: 'leaf', hash: 'hash' }, cleanup: 'confirmed' }); return this.cleanup; }
}
async function fixture(maxActive = 3) {
  const root = await realpath(await mkdtemp('/private/tmp/ps-service-'));
  const cwd = join(root, 'project'); await mkdir(cwd);
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth.json') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const store = new Store(config.state_dir), runtime = new FakeRuntime();
  const prepare = (input: Parameters<typeof resolvePolicy>[1]) => resolvePolicy(config, input, join(root, 'config.json'), resolve('.'));
  const service = new Service(store, runtime, prepare, maxActive);
  const request = { request_key: 'one', task: 'test', cwd, model: { provider: 'fixture', id: 'fixture' }, tools: [] };
  async function dispose() {
    vi.restoreAllMocks();
    for (const run of store.runs()) if (['starting','running','waiting_input','stopping'].includes(run.state)) await service.cancel(run.id);
    await service.drain().catch(() => {}); store.close(); await rm(root, { recursive: true, force: true });
  }
  return { root, store, runtime, service, request, prepare, config, dispose };
}
const started = async (store: Store, runId: string) => { await vi.waitFor(() => expect(store.getRun(runId)?.state).toBe('running')); };

test('A06/A07/A09/A10/A24/A25/A28: durable receipts, bounded reads, capacity and retained tombstones', async () => {
  const f = await fixture(1);
  try {
    const receipt = await f.service.spawn(f.request);
    expect(receipt.state).toBe('starting');
    expect(f.store.getCommand('one')?.receipt).toEqual(receipt);
    await started(f.store, receipt.run_id);
    expect(await f.service.spawn(f.request)).toEqual(receipt);
    expect(f.runtime.launches).toBe(1);
    await expect(f.service.spawn({ ...f.request, task: 'different' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(f.service.spawn({ ...f.request, request_key: 'capacity' })).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });
    expect(f.store.getCommand('capacity')).toBeUndefined();
    const events = f.store.events(receipt.run_id), after = events.at(-1)!.seq;
    const observation = await f.service.observe(receipt.run_id, after, 10);
    expect(observation.timed_out).toBe(true); expect(observation.run.state).toBe('running');
    expect(f.runtime.launches).toBe(1); expect(f.runtime.sends).toBe(0);
    expect((await f.service.observe(receipt.run_id)).events).toEqual((await f.service.observe(receipt.run_id)).events);
    const output = '你好🌍'.repeat(3000); f.runtime.finish(receipt.run_id, output); await f.service.drain();
    expect(f.store.getRun(receipt.run_id)?.state).toBe('completed');
    let collected = '', offset = 0;
    do { const page = await f.service.output(receipt.run_id, offset, 101); collected += page.text; offset = page.next_offset_bytes; if (!page.truncated) break; } while (true);
    expect(collected).toBe(output);
    f.store.transaction(() => f.store.prune(receipt.run_id));
    expect(await f.service.spawn(f.request)).toEqual(receipt); expect(f.runtime.launches).toBe(1);
  } finally { await f.dispose(); }
});

test('A08/A18/S30: one explicit continuation wins; revalidate policy without new grants', async () => {
  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request); await started(f.store, receipt.run_id);
    f.runtime.finish(receipt.run_id); await f.service.drain();
    const command = { kind: 'continue', request_key: 'next', session_id: receipt.session_id, expected_last_run_id: receipt.run_id, message: 'next' };
    const results = await Promise.allSettled([f.service.send(command), f.service.send({ ...command, request_key: 'race' })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(f.store.runs()).toHaveLength(2);
    const session = f.store.getSession(receipt.session_id)!;
    expect(session.lastRunId).not.toBe(receipt.run_id); expect(session.input.model).toEqual(f.request.model);
  } finally { await f.dispose(); }
});

test('A11/A12/A23: correlated committed replies, duplicate questions and uncertain delivery', async () => {
  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request); await started(f.store, receipt.run_id);
    const question = f.service.question(receipt.run_id, 'tool-one', 'context?');
    expect(f.service.question(receipt.run_id, 'tool-one', 'context?')).toEqual(question);
    await expect(f.service.send({ kind: 'steer', request_key: 'steer', run_id: receipt.run_id, message: 'answer' })).rejects.toMatchObject({ code: 'QUESTION_REPLY_REQUIRED' });
    expect(f.store.getCommand('steer')).toBeUndefined();
    f.runtime.failSend = true;
    const reply = { kind: 'reply', request_key: 'reply', run_id: receipt.run_id, question_id: question.id, message: 'answer' };
    const accepted = await f.service.send(reply);
    expect(f.store.question(question.id)?.answer).toBe('answer'); expect(f.store.getCommand('reply')?.delivery).toBe('uncertain');
    expect(await f.service.send(reply)).toEqual(accepted); expect(f.runtime.sends).toBe(1);
    await expect(f.service.send({ ...reply, request_key: 'other' })).rejects.toMatchObject({ code: 'QUESTION_CLOSED' });
  } finally { await f.dispose(); }
});

test('A15/A17/A19/S33: recovery preserves ambiguity and never replays; unconfirmed cancellation is interrupted', async () => {
  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request); await started(f.store, receipt.run_id);
    f.store.putInvocation({ id: 'inv-one', runId: receipt.run_id, toolCallId: 'tool', kind: 'write', policyHash: 'hash', state: 'launched', evidence: {}, cleanup: 'pending' });
    // Startup reconciliation operates on persisted records without calling the runtime.
    const restarted = new Service(f.store, f.runtime, f.prepare); restarted.recoverStartup();
    expect(f.store.getRun(receipt.run_id)).toMatchObject({ state: 'interrupted', cleanup: 'unconfirmed' });
    expect(f.store.invocations(receipt.run_id)[0]?.state).toBe('uncertain');
    expect(await restarted.spawn(f.request)).toEqual(receipt); expect(f.runtime.launches).toBe(1);
    await expect(restarted.send({ kind: 'continue', request_key: 'resume', session_id: receipt.session_id, expected_last_run_id: receipt.run_id, message: 'resume' })).rejects.toMatchObject({ code: 'SESSION_NOT_RESUMABLE' });
    f.runtime.finish(receipt.run_id); await f.service.drain();
    const next = await f.service.spawn({ ...f.request, request_key: 'two' }); await started(f.store, next.run_id);
    f.runtime.cleanup = 'unconfirmed'; expect((await f.service.cancel(next.run_id)).state).toBe('interrupted');
  } finally { await f.dispose(); }
});

test('durable acceptance failure launches nothing; terminal artifact failure cannot report completion', async () => {
  const f = await fixture();
  try {
    const original = f.store.putCommand.bind(f.store);
    const fault = vi.spyOn(f.store, 'putCommand').mockImplementationOnce(() => { throw new Error('disk full'); });
    await expect(f.service.spawn(f.request)).rejects.toMatchObject({ code: 'STATE_WRITE_FAILED' });
    expect(f.store.runs()).toHaveLength(0); expect(f.runtime.launches).toBe(0); fault.mockImplementation(original);
    const receipt = await f.service.spawn(f.request); await started(f.store, receipt.run_id);
    vi.spyOn(f.store, 'writeArtifact').mockImplementationOnce(() => { throw new Error('disk full'); });
    f.runtime.finish(receipt.run_id); await f.service.drain();
    expect(f.store.getRun(receipt.run_id)?.state).toBe('failed');
    expect(f.store.getRun(receipt.run_id)?.reason).toBe('STATE_WRITE_FAILED');
    expect(f.store.getSession(receipt.session_id)?.checkpoint).toBeNull();
  } finally { await f.dispose(); }
});

test('instance lock is exclusive and SQLite state survives a clean reopen', async () => {
  const f = await fixture();
  let originalClosed = false;
  try {
    expect(() => new Store(f.store.directory)).toThrow('INSTANCE_IN_USE');
    const receipt = await f.service.spawn(f.request); await started(f.store, receipt.run_id); f.runtime.finish(receipt.run_id); await f.service.drain();
    expect(await readFile(f.store.getRun(receipt.run_id)!.outputPath!, 'utf8')).toBe('done');
    f.store.close(); originalClosed = true;
    const reopened = new Store(f.store.directory);
    try {
      const runtime = new FakeRuntime(), service = new Service(reopened, runtime, f.prepare);
      service.recoverStartup();
      expect(await service.spawn(f.request)).toEqual(receipt); expect(runtime.launches).toBe(0);
      const next = await service.send({ kind: 'continue', request_key: 'reopened', session_id: receipt.session_id, expected_last_run_id: receipt.run_id, message: 'next' });
      await started(reopened, next.run_id); runtime.finish(next.run_id); await service.drain();
      expect(next.session_id).toBe(receipt.session_id); expect(next.run_id).not.toBe(receipt.run_id);
    } finally { reopened.close(); }
  } finally { if (!originalClosed) await f.dispose(); else await rm(f.root, { recursive: true, force: true }); }
});

test('A17/S33: actual supervisor SIGKILL preserves receipt and unknown mutation without replay', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-crash-')); await mkdir(join(root, 'project'));
  try {
    const child = spawn(process.execPath, [resolve('tests/fixtures/crash-after-acceptance.mjs'), root], {
      env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = ''; child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    const signal = await new Promise<NodeJS.Signals | null>((done, reject) => { child.once('error', reject); child.once('close', (_code, signal) => done(signal)); });
    expect(signal, stderr).toBe('SIGKILL'); const receipt = JSON.parse(stdout);
    const store = new Store(join(root, 'state'));
    try {
      const runtime = new FakeRuntime(); const service = new Service(store, runtime, async () => { throw Error('Deduplicated work must not prepare again'); });
      service.recoverStartup();
      expect(store.getRun(receipt.run_id)).toMatchObject({ state: 'interrupted', cleanup: 'unconfirmed' });
      expect(store.invocations(receipt.run_id)[0]?.state).toBe('uncertain');
      expect(await service.spawn({ request_key: 'crash', task: 'test', cwd: join(root, 'project'), tools: [], model: { provider: 'fixture', id: 'fixture' } })).toEqual(receipt);
      expect(runtime.launches).toBe(0); expect(await readFile(join(root, 'side-effect'), 'utf8')).toBe('once');
    } finally { store.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('S30: revoked policy blocks continuation; replies cannot provide new permission fields', async () => {
  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request); await started(f.store, receipt.run_id); f.runtime.finish(receipt.run_id); await f.service.drain();
    f.config.allowed_models = [];
    await expect(f.service.send({ kind: 'continue', request_key: 'revoked', session_id: receipt.session_id, expected_last_run_id: receipt.run_id, message: 'next' })).rejects.toMatchObject({ code: 'POLICY_CHANGED' });
    expect(f.store.getCommand('revoked')).toBeUndefined(); expect(f.runtime.launches).toBe(1);
    await expect(f.service.send({ kind: 'reply', request_key: 'escalate', run_id: receipt.run_id, question_id: 'unknown', message: 'approve', permissions: { shell_write_roots: [f.request.cwd] } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  } finally { await f.dispose(); }
});

test('A15: cancellation/completion races have one honest terminal result', async () => {
  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request); await started(f.store, receipt.run_id);
    const cancelling = f.service.cancel(receipt.run_id); f.runtime.finish(receipt.run_id);
    expect((await cancelling).state).toBe('cancelled'); await f.service.drain();
    expect((await f.service.cancel(receipt.run_id)).state).toBe('cancelled');
    const completed = await f.service.spawn({ ...f.request, request_key: 'completed' }); await started(f.store, completed.run_id);
    f.runtime.finish(completed.run_id); await f.service.drain();
    expect((await f.service.cancel(completed.run_id)).state).toBe('completed');
  } finally { await f.dispose(); }
});

test('persistent terminal database failure stops admission and is visible rather than completed', async () => {
  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request); await started(f.store, receipt.run_id);
    vi.spyOn(f.store, 'putRun').mockImplementation(() => { throw new Error('disk full'); });
    f.runtime.finish(receipt.run_id);
    await expect(f.service.drain()).rejects.toThrow();
    await vi.waitFor(async () => expect((await f.service.observe(receipt.run_id)).durability_error).toBe('STATE_WRITE_FAILED'));
    expect(f.store.getRun(receipt.run_id)?.state).not.toBe('completed');
    await expect(f.service.spawn({ ...f.request, request_key: 'blocked' })).rejects.toMatchObject({ code: 'STATE_WRITE_FAILED' });
  } finally { await f.dispose(); }
});
