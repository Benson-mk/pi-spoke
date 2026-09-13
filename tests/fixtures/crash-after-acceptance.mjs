import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from '../../dist/store/database.js';
import { Service } from '../../dist/core/service.js';
import { parseConfig } from '../../dist/config.js';
import { resolvePolicy } from '../../dist/security/policy.js';

const root = process.argv[2];
const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'),
  workspace_roots: [join(root, 'project')], pi: { auth_path: join(root, 'auth.json') },
  sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
const store = new Store(config.state_dir);
const runtime = {
  setup(session, run) {
    setImmediate(() => {
      store.transaction(() => store.putInvocation({ id: 'inv-crash', runId: run.id, toolCallId: 'tool', kind: 'write',
        policyHash: session.policy.policy_hash, state: 'launched', evidence: {}, cleanup: 'pending' }));
      writeFileSync(join(root, 'side-effect'), 'once');
      process.kill(process.pid, 'SIGKILL');
    });
    return new Promise(() => {});
  },
  begin() { throw Error('Inference must not start'); }, send() { throw Error('Not used'); }, cancel() { return Promise.resolve('unconfirmed'); },
};
const service = new Service(store, runtime, input => resolvePolicy(config, input, join(root, 'config.json'), resolve('.')));
console.log(JSON.stringify(await service.spawn({ request_key: 'crash', task: 'test', cwd: join(root, 'project'), tools: [], model: { provider: 'fixture', id: 'fixture' } })));
