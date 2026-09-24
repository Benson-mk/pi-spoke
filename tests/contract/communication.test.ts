import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { httpProvider } from '../fixtures/http-provider.js';
import { parseConfig } from '../../src/config.js';
import { createApplication } from '../../src/app.js';

test('P3: real worker persists notes, waits for a correlated reply, and records an improvement without applying it', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-contact-')), cwd = join(root, 'project'); await mkdir(cwd);
  const requests = [
    { kind: 'note', message: 'progress' },
    { kind: 'question', message: 'Which detail?' },
    { kind: 'improvement', message: 'Propose clearer guidance', evidence: [{ path: 'AGENTS.md', detail: 'proposal only' }] },
  ];
  const provider = await httpProvider((_request, index) => requests[index] ? { tool: { name: 'contact_main', arguments: requests[index] } } : { text: 'finished with reply' });
  const models = join(root, 'models.json'); await writeFile(models, JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: provider.url, apiKey: 'fake',
    models: [{ id: 'model', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 4096 }] } } }));
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth.json'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const app = await createApplication(config, join(root, 'config.json'), 'test');
  try {
    const receipt = await app.service.spawn({ request_key: 'contact', task: 'coordinate', cwd, tools: [], model: { provider: 'fixture', id: 'model' } });
    await vi.waitFor(() => expect(app.store.getRun(receipt.run_id)?.state).toBe('waiting_input'), { timeout: 10000 });
    const question = app.store.questions(receipt.run_id)[0]!;
    for (let i = 0; i < 3; i++) expect((await app.service.observe(receipt.run_id)).questions[0]?.id).toBe(question.id);
    expect(provider.requests).toHaveLength(2);
    await expect(app.service.send({ kind: 'steer', request_key: 'wrong', run_id: receipt.run_id, message: 'not a reply' })).rejects.toMatchObject({ code: 'QUESTION_REPLY_REQUIRED' });
    const reply = { kind: 'reply', request_key: 'reply', run_id: receipt.run_id, question_id: question.id, message: 'literal /skill:answer' };
    const accepted = await app.service.send(reply); expect(await app.service.send(reply)).toEqual(accepted);
    await app.service.drain();
    expect(app.store.getRun(receipt.run_id)).toMatchObject({ state: 'completed', cleanup: 'confirmed' });
    expect(provider.requests).toHaveLength(4); expect(JSON.stringify(provider.requests)).toContain('literal /skill:answer');
    expect(app.store.events(receipt.run_id).filter(event => ['note','improvement'].includes(event.type)).map(event => event.type)).toEqual(['note','improvement']);
  } finally { await app.close(); await provider.close(); await rm(root, { recursive: true, force: true }); }
}, 15000);
