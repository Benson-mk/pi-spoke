import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { httpProvider } from '../fixtures/http-provider.js';
import { parseConfig } from '../../src/config.js';
import { createApplication } from '../../src/app.js';

test('P2: image admission snapshots, model rejection and changed project context on continuation', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-input-')), cwd = join(root, 'project'); await mkdir(cwd);
  const provider = await httpProvider(() => ({ text: 'image accepted' }));
  const models = join(root, 'models.json');
  await writeFile(models, JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: provider.url, apiKey: 'fake', models: [
    { id: 'vision', input: ['text','image'], reasoning: false, contextWindow: 128000, maxTokens: 4096 },
    { id: 'text', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 4096 },
  ] } } }));
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth.json'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const app = await createApplication(config, join(root, 'config.json'), 'test');
  try {
    const image = join(cwd, 'image.png'); const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    await writeFile(image, original); await writeFile(join(cwd, 'AGENTS.md'), 'ORIGINAL_CONTEXT');
    const request = { request_key: 'image', task: 'describe image', cwd, tools: [], model: { provider: 'fixture', id: 'vision' }, attachments: [{ type: 'image', path: image }] };
    await expect(app.service.spawn({ ...request, request_key: 'unsupported', model: { provider: 'fixture', id: 'text' } })).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
    await expect(app.service.spawn({ ...request, request_key: 'missing', model: { provider: 'fixture', id: 'missing' } })).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    expect(provider.requests).toHaveLength(0);
    const receipt = await app.service.spawn(request); await writeFile(image, 'changed after admission'); await app.service.drain();
    expect(app.store.getRun(receipt.run_id)).toMatchObject({ state: 'completed', reason: null });
    expect(JSON.stringify(app.store.getRun(receipt.run_id)?.effective)).not.toContain('ORIGINAL_CONTEXT');
    const saved = app.store.getSession(receipt.session_id)!;
    expect(await readFile(saved.policy.resources!.images[0]!.path)).toEqual(original);
    expect(JSON.stringify(provider.requests)).toContain('image_url'); expect(JSON.stringify(provider.requests)).toContain('ORIGINAL_CONTEXT');
    expect(await app.service.spawn(request)).toEqual(receipt); expect(provider.requests).toHaveLength(1);
    await writeFile(join(cwd, 'AGENTS.md'), 'CHANGED_CONTEXT');
    await expect(app.service.send({ kind: 'continue', request_key: 'changed', session_id: receipt.session_id, expected_last_run_id: receipt.run_id, message: 'continue' })).rejects.toMatchObject({ code: 'RESOURCE_CHANGED' });
    expect(app.store.getCommand('changed')).toBeUndefined();
  } finally { await app.close(); await provider.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('P2: cancellation aborts an actual provider request while a sibling completes', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-cancel-')), cwd = join(root, 'project'); await mkdir(cwd);
  const provider = await httpProvider(request => JSON.stringify(request.messages).includes('slow task') ? { text: 'slow', delay: 15000 } : { text: 'sibling' });
  const models = join(root, 'models.json'); await writeFile(models, JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: provider.url, apiKey: 'fake',
    models: [{ id: 'model', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 4096 }] } } }));
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth.json'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const app = await createApplication(config, join(root, 'config.json'), 'test');
  try {
    const input = { request_key: 'slow', task: 'slow task', cwd, tools: [], model: { provider: 'fixture', id: 'model' } };
    const first = await app.service.spawn(input), second = await app.service.spawn({ ...input, request_key: 'sibling', task: 'fast task' });
    await vi.waitFor(() => expect(provider.requests).toHaveLength(2));
    expect((await app.service.cancel(first.run_id)).state).toBe('cancelled'); await app.service.drain();
    expect(app.store.getRun(second.run_id)?.state).toBe('completed');
  } finally { await app.close(); await provider.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
