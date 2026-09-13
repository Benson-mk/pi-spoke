import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { Store } from '../../src/store/database.js';
import { doctor, recover, gc } from '../../src/operator.js';
import { spawnSchema } from '../../src/contracts.js';
import { resolvePolicy } from '../../src/security/policy.js';
const execute = promisify(execFile);

test('P4: doctor is read-oriented; recovery refuses live recorded processes; GC preserves receipt tombstones', async () => {
  const root = await mkdtemp('/private/tmp/ps-operator-'), cwd = join(root, 'project'); await mkdir(cwd);
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const configPath = join(root, 'config.json'); await writeFile(configPath, JSON.stringify(config));
  try {
    expect(await doctor(config, 'test')).toMatchObject({ state_present: false, release_ready: false });
    await expect(access(config.state_dir)).rejects.toThrow();
    const result = await execute(process.execPath, [resolve('dist/cli.js'), 'doctor', '--config', configPath, '--instance', 'test']);
    expect(JSON.parse(result.stdout)).toMatchObject({ configuration_version: 2, state_present: false });
    await expect(execute(process.execPath, [resolve('dist/cli.js'), 'serve', '--config', configPath, '--instance', 'test', '--delete'])).rejects.toThrow();
    const input = spawnSchema.parse({ request_key: 'retained', task: 'fixture', cwd, tools: [], model: { provider: 'fixture', id: 'fixture' } });
    const policy = await resolvePolicy(config, input, configPath, resolve('.')), directory = join(config.state_dir, 'test');
    let store = new Store(directory);
    store.transaction(() => {
      store.putSession({ id: 'ses_fixture', input, policy, created: 1, updated: 1, lastRunId: 'run_abcd', checkpoint: null, piSession: null });
      store.putRun({ id: 'run_abcd', sessionId: 'ses_fixture', input, created: 1, updated: 1, state: 'interrupted', cleanup: 'unconfirmed', effective: null, reason: 'SUPERVISOR_LOST', outputPath: null });
      store.putCommand({ key: 'retained', operation: 'spawn', hash: 'hash', delivery: 'uncertain', receipt: { protocol_version: 1, session_id: 'ses_fixture', run_id: 'run_abcd', state: 'starting', receipt: 'accepted', effective_config: null } });
      store.event('run_abcd', 'worker_started', { pid: process.pid });
    }); store.close();
    await expect(recover(config, 'test', 'run_abcd')).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' });
    expect((await gc(config, 'test', 0, false)).run_ids).toEqual([]);
    store = new Store(directory); store.transaction(() => store.putRun({ ...store.getRun('run_abcd')!, cleanup: 'confirmed' })); store.close();
    expect((await gc(config, 'test', 0, false)).run_ids).toEqual(['run_abcd']);
    store = new Store(directory); expect(store.events('run_abcd')).toHaveLength(1); store.close();
    await gc(config, 'test', 0, true);
    store = new Store(directory); expect(store.getCommand('retained')?.delivery).toBe('uncertain'); expect(store.events('run_abcd')).toEqual([]); store.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});
