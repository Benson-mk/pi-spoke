import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { OperatorConfig } from './config.js';
import { Store } from './store/database.js';
import { Service } from './core/service.js';
import { Supervisor } from './runtime/supervisor.js';
import { resolvePolicy } from './security/policy.js';
import { admitResources } from './pi/admission.js';
import { fail } from './core/errors.js';

export async function createApplication(config: OperatorConfig, configPath: string, instanceId: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(instanceId)) fail('INVALID_ARGUMENT', 'Invalid instance identity');
  const scoped = { ...config, state_dir: join(config.state_dir, instanceId), scratch_dir: join(config.scratch_dir, instanceId) };
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const store = new Store(scoped.state_dir);
  try {
    const models = await ModelRuntime.create({ authPath: config.pi.auth_path, modelsPath: config.pi.models_path ?? null,
      modelsStorePath: join(store.directory, 'model-cache.json'), allowModelNetwork: false, refreshOnCreate: false });
    const runtime = new Supervisor(scoped, store, root);
    const service = new Service(store, runtime, async input => {
      const policy = await resolvePolicy(config, input, configPath, root);
      return { ...policy, resources: await admitResources(scoped, input, policy, models) };
    }, config.limits.max_active_runs);
    runtime.attach(service); service.recoverStartup();
    return { service, runtime, store, models, config: scoped,
      async close() {
        try { await service.shutdown(); } finally { store.close(); }
      } };
  } catch (error) { store.close(); throw error; }
}
