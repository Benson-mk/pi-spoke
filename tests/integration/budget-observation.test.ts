import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { Store } from '../../src/store/database.js';
import { Service, type Runtime } from '../../src/core/service.js';
import { Api } from '../../src/api.js';
import { parseConfig } from '../../src/config.js';
import { resolvePolicy } from '../../src/security/policy.js';
import type { Checkpoint } from '../../src/core/types.js';

const checkpoint: Checkpoint = { safe: true, path: '/fixture/checkpoint', leaf: 'leaf', hash: 'hash' };
async function fixture() {
  const root = await realpath(await mkdtemp('/private/tmp/ps-budget-')), cwd = join(root, 'project'); await mkdir(cwd);
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth.json') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const store = new Store(config.state_dir);
  let settle!: (result: Awaited<ReturnType<Runtime['begin']>>) => void;
  let failDelivery = false;
  const runtime: Runtime = {
    async setup() { return { piSession: { id: 'fixture', path: checkpoint.path }, effective: {} }; },
    begin() { return new Promise(resolve => { settle = resolve; }); },
    async send() { if (failDelivery) throw new Error('delivery uncertain'); },
    async cancel() { settle?.({ output: '', checkpoint, cleanup: 'confirmed' }); return 'confirmed'; },
  };
  const service = new Service(store, runtime, input => resolvePolicy(config, input, join(root, 'config.json'), resolve('.')));
  const api = new Api({ service, store, instanceId: 'fixture' } as ConstructorParameters<typeof Api>[0]);
  const request = { request_key: 'one', task: 'work', cwd, model: { provider: 'fixture', id: 'fixture' }, tools: [], limits: { wall_time_ms: 60000, max_turns: 4 } };
  return { store, service, api, request, finish: (output = '') => settle({ output, checkpoint, cleanup: 'confirmed' }),
    failNextDelivery() { failDelivery = true; },
    async dispose() { for (const run of store.runs()) if (['starting','running','waiting_input','stopping'].includes(run.state)) await service.cancel(run.id);
      await service.drain().catch(() => {}); store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('questions and replies preserve deadline, reveal allowance and paginate correlated Unicode text', async () => {
  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request);
    await vi.waitFor(() => expect(f.store.getRun(receipt.run_id)?.state).toBe('running'));
    const initial = await f.service.observe(receipt.run_id);
    expect(initial.budget).toMatchObject({ deadline_at: f.store.getRun(receipt.run_id)!.created + 60000, turns_used: 0, turns_remaining: 4 });
    const question = f.service.question(receipt.run_id, 'call', '🌍'.repeat(400));
    const waiting = await f.service.observe(receipt.run_id);
    expect(waiting.budget.deadline_at).toBe(initial.budget.deadline_at);
    expect(waiting.activity.category).toBe('waiting_for_reply');
    const summary = await f.api.observe({ run_id: receipt.run_id }) as { questions: { question_id: string; truncated: boolean; retrieval: object }[] };
    expect(summary.questions[0]).toMatchObject({ question_id: question.id, truncated: true,
      retrieval: { view: 'question', question_id: question.id } });
    const first = await f.api.observe({ run_id: receipt.run_id, view: 'question', question_id: question.id, max_bytes: 1024 }) as { text: string; next_offset_bytes: number };
    const rest = await f.api.observe({ run_id: receipt.run_id, view: 'question', question_id: question.id,
      offset_bytes: first.next_offset_bytes, max_bytes: 1024 }) as { text: string };
    expect(first.text + rest.text).toBe(question.message);
    expect(await f.api.observe({ run_id: receipt.run_id, view: 'question', question_id: question.id, max_bytes: 1 }))
      .toMatchObject({ text: '', next_offset_bytes: 0, minimum_next_bytes: 4, truncated: true });
    await expect(f.api.observe({ run_id: receipt.run_id, view: 'question', question_id: question.id, max_bytes: 8193 }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('8,192') });
    await f.service.send({ kind: 'reply', request_key: 'reply', run_id: receipt.run_id, question_id: question.id, message: 'yes' });
    expect((await f.service.observe(receipt.run_id)).budget.deadline_at).toBe(initial.budget.deadline_at);
    expect((await f.service.observe(receipt.run_id)).activity.category).toBe('unknown');
    const uncertain = f.service.question(receipt.run_id, 'second-call', 'another question'); f.failNextDelivery();
    await f.service.send({ kind: 'reply', request_key: 'uncertain', run_id: receipt.run_id, question_id: uncertain.id, message: 'answer' });
    expect(f.store.getCommand('uncertain')?.delivery).toBe('uncertain');
    expect((await f.service.observe(receipt.run_id)).activity.category).toBe('unknown');
    const events = f.store.events(receipt.run_id);
    expect(events.find(event => event.type === 'question_opened')?.payload).toMatchObject({ budget: { deadline_at: initial.budget.deadline_at } });
    expect(events.find(event => event.type === 'reply_delivered')?.payload).toMatchObject({ budget: { deadline_at: initial.budget.deadline_at } });
    f.finish(); await f.service.drain();
  } finally { await f.dispose(); }
});

test('controlled clock emits approach events once; several helpers do not consume invented turns', async () => {
  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request);
    await vi.waitFor(() => expect(f.store.getRun(receipt.run_id)?.state).toBe('running'));
    const accepted = f.store.getRun(receipt.run_id)!.created;
    f.service.activity(receipt.run_id, 'generation', 1);
    f.service.activity(receipt.run_id, 'helper'); f.service.activity(receipt.run_id, 'helper');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(accepted + 55000);
    f.service.limitApproaching(receipt.run_id); f.service.limitApproaching(receipt.run_id);
    const observed = await f.service.observe(receipt.run_id);
    expect(observed.budget).toMatchObject({ remaining_wall_ms: 5000, turns_used: 1, turns_remaining: 3 });
    expect(observed.activity.category).toBe('helper');
    expect(observed.events.filter(event => event.type === 'limit_approaching')).toHaveLength(1);
    expect((await f.service.observe(receipt.run_id)).budget).toEqual(observed.budget);
    clock.mockRestore(); f.finish(); await f.service.drain();
  } finally { await f.dispose(); }
});

test('old run allowance survives continuation with narrower limits; legacy unknown stays unknown', async () => {
  const f = await fixture();
  try {
    const first = await f.service.spawn(f.request);
    await vi.waitFor(() => expect(f.store.getRun(first.run_id)?.state).toBe('running'));
    f.finish('ready'); await f.service.drain();
    const prior = (await f.service.observe(first.run_id)).budget;
    const completed = f.store.getRun(first.run_id)!;
    f.store.putRun({ ...completed, cleanup: 'operator_attested', updated: completed.updated + 30000 });
    expect((await f.service.observe(first.run_id)).budget).toEqual(prior);
    const next = await f.service.send({ kind: 'continue', request_key: 'next', session_id: first.session_id,
      expected_last_run_id: first.run_id, message: 'continue', limits: { wall_time_ms: 2000, max_turns: 2 } });
    await vi.waitFor(() => expect(f.store.getRun(next.run_id)?.state).toBe('running'));
    expect((await f.service.observe(first.run_id)).budget).toEqual(prior);
    expect((await f.service.observe(next.run_id)).budget).toMatchObject({ max_turns: 2, turns_remaining: 2 });
    const { appliedLimits: _limits, deadlineAt: _deadline, settledAt: _settled, turnsUsed: _turns, ...old } = f.store.getRun(first.run_id)!;
    f.store.putRun(old);
    expect((await f.service.observe(first.run_id)).budget).toMatchObject({ deadline_at: null, turns_used: null, turns_remaining: null });
    f.finish(); await f.service.drain();
  } finally { await f.dispose(); }
});

test('long question and event surfaces redact secrets and bound serialized response', async () => {
  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request);
    await vi.waitFor(() => expect(f.store.getRun(receipt.run_id)?.state).toBe('running'));
    const secret = 'sk-syntheticsecret123456';
    for (let index = 0; index < 4; index++) f.service.question(receipt.run_id, 'call-' + index, `${secret}\n"${'🌍'.repeat(1600)}`);
    f.service.recordEvent(receipt.run_id, 'note', { message: `${secret} ${'\u0000'.repeat(6000)}${'🌍'.repeat(1600)}` });
    const summary = await f.api.observe({ run_id: receipt.run_id }) as { events_truncated: boolean; [key: string]: unknown };
    expect(JSON.stringify(summary)).not.toContain(secret);
    expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(16384);
    expect(summary.events_truncated).toBe(true);
    const page = await f.api.observe({ run_id: receipt.run_id, view: 'question', question_id: f.store.questions(receipt.run_id)[0]!.id, max_bytes: 4096 });
    expect(JSON.stringify(page)).not.toContain(secret);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(8192);
  } finally { await f.dispose(); }
});
