import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { httpProvider } from './http-provider.js';
import { parseConfig } from '../../src/config.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { Store } from '../../src/store/database.js';
import { Supervisor } from '../../src/runtime/supervisor.js';
import { Service } from '../../src/core/service.js';
import { Api } from '../../src/api.js';

export async function observationRuntime(reply: Parameters<typeof httpProvider>[0]) {
  const root = await realpath(await mkdtemp('/private/tmp/ps-observability-')), cwd = join(root, 'project'); await mkdir(cwd);
  await writeFile(join(cwd, 'source'), 'before');
  const provider = await httpProvider(reply);
  const models = join(root, 'models.json'); await writeFile(models, JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: provider.url, apiKey: 'fake', models: [{ id: 'model', input: ['text'], contextWindow: 128000, maxTokens: 4096 }],
  } } }));
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    allowed_tools: ['edit','read'], permissions: { file_write_roots: [cwd] },
    pi: { auth_path: join(root, 'auth'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const store = new Store(config.state_dir), supervisor = new Supervisor(config, store, resolve('.'));
  const service = new Service(store, supervisor, input => resolvePolicy(config, input, join(root, 'config'), resolve('.'))); supervisor.attach(service);
  const api = new Api({ service, store, instanceId: 'fixture' } as ConstructorParameters<typeof Api>[0]);
  let closed = false;
  return { cwd, root, provider, store, service, api,
    reopen() { store.close(); closed = true; return new Store(config.state_dir); },
    async dispose() { if (!closed) { await service.shutdown().catch(() => {}); store.close(); }
      await provider.close(); await rm(root, { recursive: true, force: true }); } };
}
