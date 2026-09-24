import { mkdtemp, mkdir, writeFile, access, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { Store } from '../../src/store/database.js';
import { doctor, recover, gc, inspectInvocations } from '../../src/operator.js';
import { spawnSchema } from '../../src/contracts.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { processIdentity } from '../../src/sandbox/process-identity.js';
const execute = promisify(execFile);

test('P4: doctor is read-oriented; recovery refuses live recorded processes; GC preserves receipt tombstones', async () => {
  const root = await mkdtemp('/private/tmp/ps-operator-'), cwd = join(root, 'project'); await mkdir(cwd);
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const configPath = join(root, 'config.json'); await writeFile(configPath, JSON.stringify(config));
  try {
    expect(await doctor(config, 'test')).toMatchObject({ state_present: false, release_ready: null });
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
      store.putCommand({ key: 'retained', operation: 'spawn', hash: 'hash', delivery: 'uncertain', receipt: { protocol_version: 1, instance_id: store.instanceId, session_id: 'ses_fixture', run_id: 'run_abcd', state: 'starting', receipt: 'accepted', effective_config: null } });
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

test('doctor inspects only selected instance helper evidence without changing recovery state', async () => {
  const root = await mkdtemp('/private/tmp/ps-evidence-'), cwd = join(root, 'p'); await mkdir(cwd);
  const config = parseConfig({ version: 2, state_dir: join(root, 's'), scratch_dir: join(root, 't'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const store = new Store(join(config.state_dir, 'owner'));
  try {
    const input = spawnSchema.parse({ request_key: 'fixture', task: 'fixture', cwd, tools: [], model: { provider: 'fixture', id: 'fixture' } });
    const policy = await resolvePolicy(config, input, join(root, 'config'), resolve('.'));
    store.transaction(() => {
      store.putSession({ id: 'ses_owner', input, policy, created: 1, updated: 1, lastRunId: 'run_abcd', checkpoint: null, piSession: null });
      store.putRun({ id: 'run_abcd', sessionId: 'ses_owner', input, created: 1, updated: 1, state: 'interrupted', cleanup: 'unconfirmed', effective: null, reason: 'SUPERVISOR_LOST', outputPath: null });
      store.putInvocation({ id: 'inv_one', runId: 'run_abcd', toolCallId: 'call_one', kind: 'read', policyHash: 'synthetic', state: 'uncertain',
        cleanup: 'unconfirmed', evidence: { stage: 'helper_launched', helper: { pid: 321, birth: 'synthetic', group: 321 } } });
    });
    expect(inspectInvocations(config, 'owner', 'run_abcd')).toMatchObject({ invocations: [{ invocation_id: 'inv_one',
      evidence: { stage: 'helper_launched', helper: { birth: 'synthetic' } }, cleanup_status: 'unconfirmed' }], next_after: null });
    expect(() => inspectInvocations(config, 'other', 'run_abcd')).toThrow();
    await symlink(join(config.state_dir, 'owner'), join(config.state_dir, 'alias'));
    expect(() => inspectInvocations(config, 'alias', 'run_abcd')).toThrow();
    expect(store.getRun('run_abcd')).toMatchObject({ state: 'interrupted', cleanup: 'unconfirmed' });
    expect(store.events('run_abcd')).toEqual([]);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('operator recovery refuses live nested launcher/helper ownership even with missing or stale birth evidence', async () => {
  const root = await mkdtemp('/private/tmp/ps-ownership-'), cwd = join(root, 'p'); await mkdir(cwd);
  const config = parseConfig({ version: 2, state_dir: join(root, 's'), scratch_dir: join(root, 't'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const directory = join(config.state_dir, 'owner'), input = spawnSchema.parse({ request_key: 'ownership', task: 'fixture', cwd,
    tools: [], model: { provider: 'fixture', id: 'fixture' } });
  const policy = await resolvePolicy(config, input, join(root, 'config'), resolve('.'));
  let store = new Store(directory), open = true;
  try {
    store.transaction(() => {
      store.putSession({ id: 'ses_owner', input, policy, created: 1, updated: 1, lastRunId: 'run_abcd', checkpoint: null, piSession: null });
      store.putRun({ id: 'run_abcd', sessionId: 'ses_owner', input, created: 1, updated: 1, state: 'interrupted',
        cleanup: 'unconfirmed', effective: null, reason: 'SUPERVISOR_LOST', outputPath: null });
      store.putInvocation({ id: 'inv_helper', runId: 'run_abcd', toolCallId: 'call_helper', kind: 'read', policyHash: 'synthetic',
        state: 'uncertain', cleanup: 'unconfirmed', evidence: { stage: 'helper_launched', helper: { pid: process.pid, birth: null, group: null } } });
    }); store.close(); open = false;
    await expect(recover(config, 'owner', 'run_abcd')).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' });
    store = new Store(directory); open = true;
    store.transaction(() => store.putInvocation({ ...store.invocations('run_abcd')[0]!, evidence: {
      stage: 'launcher_started', launcher: { pid: process.pid, birth: 'deliberately stale birth', group: null } } })); store.close(); open = false;
    await expect(recover(config, 'owner', 'run_abcd')).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' });
    store = new Store(directory); open = true;
    expect(store.getRun('run_abcd')).toMatchObject({ cleanup: 'unconfirmed' });
    expect(store.events('run_abcd')).toEqual([]);
  } finally { if (open) store.close(); await rm(root, { recursive: true, force: true }); }
});

test('operator recovery refuses a live recorded helper group when the leader PID is gone', async () => {
  const identity = await processIdentity(process.pid);
  if (identity.group === null) throw new Error('The fixture requires a real process-group identity');
  const root = await mkdtemp('/private/tmp/ps-group-'), cwd = join(root, 'p'); await mkdir(cwd);
  const config = parseConfig({ version: 2, state_dir: join(root, 's'), scratch_dir: join(root, 't'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const directory = join(config.state_dir, 'owner'), input = spawnSchema.parse({ request_key: 'group', task: 'fixture', cwd,
    tools: [], model: { provider: 'fixture', id: 'fixture' } });
  const policy = await resolvePolicy(config, input, join(root, 'config'), resolve('.'));
  const store = new Store(directory);
  try {
    store.transaction(() => {
      store.putSession({ id: 'ses_owner', input, policy, created: 1, updated: 1, lastRunId: 'run_abcd', checkpoint: null, piSession: null });
      store.putRun({ id: 'run_abcd', sessionId: 'ses_owner', input, created: 1, updated: 1, state: 'interrupted',
        cleanup: 'unconfirmed', effective: null, reason: 'SUPERVISOR_LOST', outputPath: null });
      store.putInvocation({ id: 'inv_helper', runId: 'run_abcd', toolCallId: 'call_helper', kind: 'read', policyHash: 'synthetic',
        state: 'uncertain', cleanup: 'unconfirmed', evidence: { stage: 'helper_launched', helper: { pid: 999999999, birth: null, group: identity.group } } });
    });
  } finally { store.close(); }
  try {
    await expect(recover(config, 'owner', 'run_abcd')).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' });
    const reopened = new Store(directory);
    try { expect(reopened.getRun('run_abcd')).toMatchObject({ cleanup: 'unconfirmed' });
      expect(reopened.events('run_abcd')).toEqual([]); }
    finally { reopened.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
