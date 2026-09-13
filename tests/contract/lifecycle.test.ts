import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, vi } from 'vitest';
import { httpProvider } from '../fixtures/http-provider.js';
import { createApplication } from '../../src/app.js';
import { parseConfig } from '../../src/config.js';

test('P5 A15/A16/A27: real child crash, provider choice, question cancellation and run limits stay isolated', async () => {
  const root = await mkdtemp('/private/tmp/ps-life-'), cwd = join(root,'p'); await mkdir(cwd);
  const provider = await httpProvider(request => {
    const text = JSON.stringify(request.messages);
    if (text.includes('CRASH_ME') || text.includes('WALL_LIMIT')) return { text: 'delayed', delay: 15000 };
    if (text.includes('QUESTION')) return { tool: { name: 'contact_main', arguments: { kind: 'question', message: 'pending' } } };
    if (text.includes('TURN_LIMIT')) return { tool: { name: 'contact_main', arguments: { kind: 'note', message: 'another turn' } } };
    return { text: 'healthy sibling' };
  });
  const models = join(root,'models.json'), model = (id: string) => ({ id, input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 4096 });
  await writeFile(models, JSON.stringify({ providers: {
    first: { api: 'openai-completions', baseUrl: provider.url, apiKey: 'fake', models: [model('one')] },
    second: { api: 'openai-completions', baseUrl: provider.url, apiKey: 'fake', models: [model('two')] },
  } }));
  const config = parseConfig({ version: 2, state_dir: join(root,'s'), scratch_dir: join(root,'t'), workspace_roots: [cwd],
    pi: { auth_path: join(root,'auth'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const app = await createApplication(config, join(root,'config'), 'test');
  try {
    const input = { request_key: 'crash', task: 'CRASH_ME', cwd, tools: [], model: { provider: 'first', id: 'one' } };
    const crash = await app.service.spawn(input), sibling = await app.service.spawn({ ...input, request_key: 'sibling', task: 'healthy', model: { provider: 'second', id: 'two' } });
    await vi.waitFor(() => expect(provider.requests.length).toBeGreaterThanOrEqual(2));
    const pid = (app.store.getRun(crash.run_id)!.effective as { worker_pid: number }).worker_pid;
    expect(pid).toBeGreaterThan(1); process.kill(pid, 'SIGKILL');
    await app.service.drain();
    expect(app.store.getRun(crash.run_id)?.state).toBe('failed'); expect(app.store.getRun(sibling.run_id)?.state).toBe('completed');
    expect(provider.requests.map(request => request.model).sort()).toEqual(['one','two']);
    const question = await app.service.spawn({ ...input, request_key: 'question', task: 'QUESTION' });
    await vi.waitFor(() => expect(app.store.getRun(question.run_id)?.state).toBe('waiting_input'));
    expect((await app.service.cancel(question.run_id)).state).toBe('cancelled'); await app.service.drain();
    expect(app.store.questions(question.run_id)[0]?.state).toBe('closed');
    const turns = await app.service.spawn({ ...input, request_key: 'turns', task: 'TURN_LIMIT', limits: { max_turns: 2 } });
    await app.service.drain(); expect(app.store.getRun(turns.run_id)).toMatchObject({ state: 'cancelled', reason: 'MAX_TURNS' });
    const wall = await app.service.spawn({ ...input, request_key: 'wall', task: 'WALL_LIMIT', limits: { wall_time_ms: 700 } });
    await app.service.drain(); expect(app.store.getRun(wall.run_id)).toMatchObject({ state: 'cancelled', reason: 'WALL_TIME_LIMIT' });
  } finally { await app.close(); await provider.close(); await rm(root,{recursive:true,force:true}); }
}, 20000);
