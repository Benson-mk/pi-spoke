import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { renameSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { httpProvider } from '../fixtures/http-provider.js';
import { parseConfig } from '../../src/config.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { Store } from '../../src/store/database.js';
import { Supervisor } from '../../src/runtime/supervisor.js';
import { Service } from '../../src/core/service.js';
import { inspectInvocations } from '../../src/operator.js';
import { Api } from '../../src/api.js';
import { SandboxLaunchUncertain } from '../../src/sandbox/backend.js';
import { SpokeError } from '../../src/core/errors.js';

async function fixture(scenario: 'prelaunch' | 'result' | 'cancel' | 'lost_completion' | 'launcher_failure') {
  const root = await realpath(await mkdtemp('/private/tmp/ps-lifecycle-'));
  const cwd = join(root, 'project'); await mkdir(cwd);
  if (scenario === 'result') await Promise.all(Array.from({ length: 500 }, (_, i) =>
    writeFile(join(cwd, `fixture-${String(i).padStart(4, '0')}-${'z'.repeat(135)}`), 'synthetic')));
  let moved = false;
  const provider = await httpProvider(() => {
    if (scenario === 'prelaunch' && !moved) { renameSync(cwd, join(root, 'moved')); mkdirSync(cwd); moved = true; }
    return { tool: { name: ['cancel', 'lost_completion', 'launcher_failure'].includes(scenario) ? 'read' : 'ls',
      arguments: ['cancel', 'lost_completion', 'launcher_failure'].includes(scenario) ? { path: 'synthetic.txt' } : {} } };
  });
  const models = join(root, 'models.json');
  await writeFile(models, JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: provider.url, apiKey: 'fake',
    models: [{ id: 'model', input: ['text'], contextWindow: 128000, maxTokens: 4096 }] } } }));
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    allowed_tools: ['ls', 'read'], pi: { auth_path: join(root, 'auth'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const store = new Store(join(config.state_dir, 'fixture')), runtime = new Supervisor(config, store, resolve('.'));
  const service = new Service(store, runtime, input => resolvePolicy(config, input, join(root, 'config'), resolve('.'))); runtime.attach(service);
  return { root, cwd, config, store, service, provider, runtime };
}

test('a policy identity change before helper launch has a durable known-not-launched outcome', async () => {
  const f = await fixture('prelaunch');
  try {
    const receipt = await f.service.spawn({ request_key: 'prelaunch', task: 'list', cwd: f.cwd,
      model: { provider: 'fixture', id: 'model' }, tools: ['ls'] });
    // The provider changes topology after preflight but before the helper policy check.
    await f.service.drain();
    const records = inspectInvocations(f.config, 'fixture', receipt.run_id);
    expect(records.invocations).toHaveLength(1);
    expect(records.invocations[0]).toMatchObject({ state: 'completed', cleanup_status: 'confirmed',
      evidence: { stage: 'rejected_before_launch', error_category: 'POLICY_CHANGED' } });
    expect(records.invocations[0]!.evidence).not.toHaveProperty('launcher');
    expect(f.provider.requests).toHaveLength(1);
  } finally { await f.service.shutdown(); f.store.close(); await f.provider.close(); await rm(f.root, { recursive: true, force: true }); }
}, 45000);

test.skipIf(process.env.PS_LAUNCHER_CHILD !== '1')('actual launcher spawn failure stays known-not-launched in its isolated child', async () => {
  const f = await fixture('launcher_failure');
  try {
    await writeFile(join(f.cwd, 'synthetic.txt'), 'fixture');
    const original = f.runtime.sandbox.tool.bind(f.runtime.sandbox);
    // Fault injection after preflight: a vanished child cwd forces an actual
    // child_process spawn error without a PID; no launcher process was created.
    f.runtime.sandbox.tool = ((...args: Parameters<typeof original>) => {
      const [runId, policy, scratch, name, input, lifecycle] = args;
      return original(runId, { ...policy, cwd: join(f.root, 'vanished') }, scratch, name, input, lifecycle);
    }) as typeof f.runtime.sandbox.tool;
    const receipt = await f.service.spawn({ request_key: 'launcher-failure', task: 'read', cwd: f.cwd,
      model: { provider: 'fixture', id: 'model' }, tools: ['read'] });
    await f.service.drain();
    expect(f.store.invocations(receipt.run_id)[0]).toMatchObject({ state: 'completed', cleanup: 'confirmed',
      evidence: { stage: 'rejected_before_launch', error_category: 'SANDBOX_SETUP_FAILED' } });
    expect(f.provider.requests).toHaveLength(1);
  } finally { await f.service.shutdown(); f.store.close(); await f.provider.close(); await rm(f.root, { recursive: true, force: true }); }
}, 45000);

test('a failed OS launcher start cannot signal its parent process group', async () => {
  const child = spawn(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/sandbox/helper-lifecycle.test.ts',
    '-t', 'actual launcher spawn failure stays known-not-launched in its isolated child'], {
    cwd: resolve('.'), detached: true, env: { ...process.env, PS_LAUNCHER_CHILD: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', bytes => { output = (output + bytes.toString()).slice(-4000); });
  child.stderr.on('data', bytes => { output = (output + bytes.toString()).slice(-4000); });
  const timeout = setTimeout(() => { if (child.pid && child.exitCode === null) child.kill('SIGKILL'); }, 20000);
  try {
    const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
    });
    expect({ code, signal }, output).toEqual({ code: 0, signal: null });
  } finally { clearTimeout(timeout); }
}, 25000);

test('a helper with unparseable bounded output keeps trusted ownership and uncertain cleanup after reopening', async () => {
  const f = await fixture('result');
  let closed = false;
  try {
    const receipt = await f.service.spawn({ request_key: 'result', task: 'list synthetic names', cwd: f.cwd,
      model: { provider: 'fixture', id: 'model' }, tools: ['ls'] });
    await f.service.drain();
    const page = inspectInvocations(f.config, 'fixture', receipt.run_id);
    expect(page.invocations).toHaveLength(1);
    expect(page.invocations[0]).toMatchObject({ state: 'uncertain', cleanup_status: 'unconfirmed',
      evidence: { launcher: { pid: expect.any(Number) }, helper: { pid: expect.any(Number) } } });
    expect((page.invocations[0]!.evidence as { policy_hash: string }).policy_hash).toBe(
      f.store.getSession(receipt.session_id)?.policy.policy_hash);
    expect(f.store.getRun(receipt.run_id)).toMatchObject({ state: 'interrupted', cleanup: 'unconfirmed' });
    expect(f.store.events(receipt.run_id).some(event => event.type === 'tool_lifecycle' &&
      (event.payload as { stage?: string }).stage === 'helper_launched')).toBe(true);
    const api = new Api({ service: f.service, store: f.store, instanceId: f.store.instanceId } as ConstructorParameters<typeof Api>[0]);
    let after = 0, found = false;
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const observed = await api.observe({ run_id: receipt.run_id, view: 'events', limit: 100, after_seq: after });
      if (!('events' in observed)) throw new Error('Expected bounded events');
      found ||= observed.events.some(item => {
        const event = item as { type: string; payload: { cleanup_status?: string } };
        return event.type === 'tool_ended' && event.payload.cleanup_status === 'unconfirmed';
      });
      expect(Buffer.byteLength(JSON.stringify(observed))).toBeLessThanOrEqual(16384);
      expect(JSON.stringify(observed)).not.toContain('z'.repeat(135));
      if (!observed.events_truncated) break;
      after = observed.next_after_seq;
    }
    expect(found).toBe(true);
    await f.service.shutdown(); f.store.close(); closed = true;
    const reopened = new Store(join(f.config.state_dir, 'fixture'));
    try {
      expect(reopened.invocations(receipt.run_id)[0]).toMatchObject({ state: 'uncertain', cleanup: 'unconfirmed' });
      expect(inspectInvocations(f.config, 'fixture', receipt.run_id).invocations).toEqual(page.invocations);
    } finally { reopened.close(); }
  } finally { if (!closed) { await f.service.shutdown(); f.store.close(); } await f.provider.close(); await rm(f.root, { recursive: true, force: true }); }
}, 45000);

test('cancellation during a live fixed helper records uncertainty without replay', async () => {
  const f = await fixture('cancel');
  try {
    await writeFile(join(f.cwd, 'synthetic.txt'), 'fixture');
    const receipt = await f.service.spawn({ request_key: 'cancel', task: 'read', cwd: f.cwd,
      model: { provider: 'fixture', id: 'model' }, tools: ['read'] });
    const deadline = Date.now() + 15000;
    while (!f.store.events(receipt.run_id).some(event => event.type === 'tool_lifecycle' &&
      (event.payload as { stage?: string }).stage === 'helper_launched')) {
      if (Date.now() > deadline) throw new Error('Helper launch was not observed within 15 seconds');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await f.service.cancel(receipt.run_id);
    await f.service.drain();
    expect(f.store.invocations(receipt.run_id)[0]).toMatchObject({ state: 'uncertain', cleanup: 'unconfirmed',
      evidence: { helper: { pid: expect.any(Number) } } });
    expect(f.store.getRun(receipt.run_id)).toMatchObject({ cleanup: 'unconfirmed' });
    expect(f.provider.requests).toHaveLength(1);
  } finally { await f.service.shutdown(); f.store.close(); await f.provider.close(); await rm(f.root, { recursive: true, force: true }); }
}, 45000);

test('loss of completion after a real helper settles retains an uncertain invocation', async () => {
  const f = await fixture('lost_completion');
  try {
    await writeFile(join(f.cwd, 'synthetic.txt'), 'fixture');
    const original = f.runtime.sandbox.tool.bind(f.runtime.sandbox);
    f.runtime.sandbox.tool = (async (...args: Parameters<typeof original>) => {
      await original(...args);
      throw new Error('synthetic completion delivery lost');
    }) as typeof f.runtime.sandbox.tool;
    const receipt = await f.service.spawn({ request_key: 'lost', task: 'read', cwd: f.cwd,
      model: { provider: 'fixture', id: 'model' }, tools: ['read'] });
    await f.service.drain();
    expect(f.store.invocations(receipt.run_id)[0]).toMatchObject({ state: 'uncertain', cleanup: 'unconfirmed',
      evidence: { stage: 'result_received', error_category: 'TOOL_OUTCOME_UNCERTAIN' } });
    expect(f.store.getRun(receipt.run_id)).toMatchObject({ state: 'interrupted', cleanup: 'unconfirmed' });
    expect(f.provider.requests).toHaveLength(1);
  } finally { await f.service.shutdown(); f.store.close(); await f.provider.close(); await rm(f.root, { recursive: true, force: true }); }
}, 45000);

test('later unknown process identity does not erase an earlier trusted group or birth', async () => {
  const f = await fixture('lost_completion');
  try {
    await writeFile(join(f.cwd, 'synthetic.txt'), 'fixture');
    f.runtime.sandbox.tool = (async (_runId, _policy, _scratch, _name, _args, lifecycle) => {
      lifecycle?.('launcher_started', { launcher: { pid: 987654321, birth: 'synthetic birth', group: 987654321 } });
      lifecycle?.('launcher_started', { launcher: { pid: 987654321, birth: null, group: null } });
      throw new SandboxLaunchUncertain(new SpokeError('SANDBOX_SETUP_FAILED', 'synthetic launcher result loss'));
    }) as typeof f.runtime.sandbox.tool;
    const receipt = await f.service.spawn({ request_key: 'identity-enrichment', task: 'read', cwd: f.cwd,
      model: { provider: 'fixture', id: 'model' }, tools: ['read'] });
    await f.service.drain();
    expect(f.store.invocations(receipt.run_id)[0]).toMatchObject({ state: 'uncertain', cleanup: 'unconfirmed',
      evidence: { launcher: { pid: 987654321, birth: 'synthetic birth', group: 987654321 } } });
  } finally { await f.service.shutdown(); f.store.close(); await f.provider.close(); await rm(f.root, { recursive: true, force: true }); }
}, 45000);
