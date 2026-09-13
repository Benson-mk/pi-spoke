import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { httpProvider } from '../fixtures/http-provider.js';
import { parseConfig } from '../../src/config.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { Store } from '../../src/store/database.js';
import { Service } from '../../src/core/service.js';
import { Supervisor } from '../../src/runtime/supervisor.js';

test('real supervised Pi over local HTTP: no-tool handshake, native checkpoint and explicit continuation', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-worker-')); const cwd = join(root, 'project'); await mkdir(cwd);
  const provider = await httpProvider(() => ({ text: 'supervised result' }));
  const models = join(root, 'models.json');
  await writeFile(models, JSON.stringify({ providers: { fixture: { baseUrl: provider.url, api: 'openai-completions', apiKey: 'fake',
    models: [{ id: 'fixture-model', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096 }] } } }));
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth.json'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const store = new Store(config.state_dir), supervisor = new Supervisor(config, store, resolve('.'));
  const service = new Service(store, supervisor, input => resolvePolicy(config, input, join(root, 'config.json'), resolve('.'))); supervisor.attach(service);
  try {
    const first = await service.spawn({ request_key: 'first', task: '/skill:literal task', cwd, tools: [], model: { provider: 'fixture', id: 'fixture-model' } });
    await service.drain();
    const result = await service.observe(first.run_id);
    expect(result.run, JSON.stringify(result)).toMatchObject({ state: 'completed', cleanup: 'confirmed' });
    expect(result.run.effective).toMatchObject({ execution_mode: 'no-execution-tools', backend: null, model: { provider: 'fixture', id: 'fixture-model' } });
    expect((await service.output(first.run_id)).text).toBe('supervised result');
    const second = await service.send({ kind: 'continue', request_key: 'second', session_id: first.session_id, expected_last_run_id: first.run_id, message: 'continue' });
    await service.drain(); expect(store.getRun(second.run_id)?.state).toBe('completed');
    expect(provider.requests).toHaveLength(2); expect(JSON.stringify(provider.requests[1])).toContain('/skill:literal task');
  } finally {
    for (const run of store.runs()) if (['starting','running','waiting_input','stopping'].includes(run.state)) await service.cancel(run.id);
    await service.drain().catch(() => {}); store.close(); await provider.close(); await rm(root, { recursive: true, force: true });
  }
}, 30000);
