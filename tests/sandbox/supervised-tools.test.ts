import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { httpProvider } from '../fixtures/http-provider.js';
import { parseConfig } from '../../src/config.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { Store } from '../../src/store/database.js';
import { Supervisor } from '../../src/runtime/supervisor.js';
import { Service } from '../../src/core/service.js';

test('real Pi worker uses guarded read/search/write/edit through actual SRT; shell authority stays separate', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-tools-')), cwd = join(root, 'project'); await mkdir(cwd);
  await writeFile(join(cwd, 'source.txt'), 'before');
  const calls = [
    { name: 'read', arguments: { path: 'source.txt' } },
    { name: 'ls', arguments: {} },
    { name: 'find', arguments: { pattern: '*.txt' } },
    { name: 'grep', arguments: { pattern: 'before' } },
    { name: 'write', arguments: { path: 'new/nested.txt', content: 'data' } },
    { name: 'edit', arguments: { path: 'source.txt', edits: [{ oldText: 'before', newText: 'after' }] } },
  ];
  const provider = await httpProvider((_request, index) => calls[index] ? { tool: calls[index] } : { text: 'tools complete' });
  const models = join(root, 'models.json'); await writeFile(models, JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: provider.url, apiKey: 'fake',
    models: [{ id: 'fixture-model', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096 }] } } }));
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    allowed_tools: ['read','ls','find','grep','write','edit','bash'], permissions: { file_write_roots: [cwd], shell_write_roots: [] },
    pi: { auth_path: join(root, 'auth.json'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const store = new Store(config.state_dir), runtime = new Supervisor(config, store, resolve('.'));
  const service = new Service(store, runtime, input => resolvePolicy(config, input, join(root, 'config.json'), resolve('.'))); runtime.attach(service);
  try {
    const receipt = await service.spawn({ request_key: 'tools', task: 'exercise tools', cwd, model: { provider: 'fixture', id: 'fixture-model' },
      tools: calls.map(call => call.name), permissions: { file_write_roots: [cwd] } });
    await service.drain(); const run = store.getRun(receipt.run_id)!;
    expect(run, JSON.stringify(await service.observe(run.id))).toMatchObject({ state: 'completed', cleanup: 'confirmed' });
    expect(await readFile(join(cwd, 'source.txt'), 'utf8')).toBe('after');
    expect(await readFile(join(cwd, 'new/nested.txt'), 'utf8')).toBe('data');
    expect(store.invocations(run.id)).toHaveLength(calls.length);
    expect(store.invocations(run.id).every(invocation => invocation.state === 'completed')).toBe(true);
    expect(run.effective).toMatchObject({ execution_mode: 'sandboxed-tools', shell_write_roots: [], sandbox_scope: 'tool-subprocesses' });
    expect(JSON.stringify(provider.requests)).toContain('before');
  } finally {
    for (const run of store.runs()) if (['starting','running','waiting_input','stopping'].includes(run.state)) await service.cancel(run.id);
    await service.drain().catch(() => {}); store.close(); await provider.close(); await rm(root, { recursive: true, force: true });
  }
}, 45000);
