import { access, mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { platform, arch } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { OperatorConfig } from './config.js';
import { Store } from './store/database.js';
import { fail } from './core/errors.js';
import { terminalStates } from './core/types.js';
import { reopenCheckpoint } from './pi/checkpoints.js';
import { Sandbox } from './sandbox/backend.js';
import { resolvePolicy } from './security/policy.js';
import { spawnSchema } from './contracts.js';

export async function doctor(config: OperatorConfig, instance: string) {
  const directory = join(config.state_dir, instance);
  const lock = await readFile(join(directory, 'instance.lock', 'owner.json'), 'utf8').then(() => 'present', () => 'absent_or_unreadable');
  return { version: '0.1.0', node: process.version, platform: platform(), architecture: arch(), configuration_version: 2,
    instance, state_present: await access(directory).then(() => true, () => false), ownership_lock: lock,
    backend: 'srt', backend_version: '0.0.76', backend_binary_present: ['darwin', 'linux'].includes(platform()) && await access(platform() === 'linux' ? '/usr/bin/bwrap' : '/usr/bin/sandbox-exec').then(() => true, () => false),
    sandbox_check: 'NOT RUN; use --sandbox-check', release_ready: null, release_assessment: 'Not assessed by doctor; see the release acceptance ledger',
    limitations: ['macOS/Linux adapters; exact qualified identities required', 'arbitrary shell descendant cleanup unconfirmed', 'project shell-write roots rejected'],
    live_provider_tests: 'NOT RUN; explicitly opt-in' };
}
export async function sandboxCheck(runtimeRoot: string) {
  if (!['darwin', 'linux'].includes(platform())) fail('SANDBOX_UNAVAILABLE', 'This adapter requires a qualified macOS or Linux host');
  const root = await mkdtemp('/private/tmp/ps-doctor-'), cwd = join(root, 'workspace'); await mkdir(cwd);
  const config: OperatorConfig = { version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd], allowed_tools: ['read'],
    permissions: { file_write_roots: [], shell_write_roots: [] }, skill_roots: [], project_skills: false,
    pi: { auth_path: join(root, 'auth.json') }, sandbox: { backend: 'srt', required: true, tool_network: 'none', additional_read_deny_paths: [], additional_write_deny_paths: [], additional_toolchain_read_paths: [] },
    limits: { max_active_runs: 1, max_run_wall_time_ms: 30000, max_run_turns: 1, max_shell_command_seconds: 10, max_sandbox_startup_seconds: 15 } };
  const sandbox = new Sandbox(config, runtimeRoot), runId = 'run_' + randomUUID();
  try {
    const policy = await resolvePolicy(config, spawnSchema.parse({ request_key: 'doctor', task: 'canary', cwd, model: { provider: 'fixture', id: 'unused' }, tools: ['read'] }), join(root, 'config.json'), runtimeRoot);
    const result = await sandbox.preflight(runId, policy, await sandbox.createScratch(runId));
    return { status: 'PASS', scope: 'disposable baseline preflight; not full release qualification', ...result };
  } finally { await sandbox.cancel(runId); await rm(root, { recursive: true, force: true }); }
}
export async function refreshModels(config: OperatorConfig, instance: string) {
  const store = new Store(join(config.state_dir, instance));
  try {
    const models = await ModelRuntime.create({ authPath: config.pi.auth_path, modelsPath: config.pi.models_path ?? null,
      modelsStorePath: join(store.directory, 'model-cache.json'), allowModelNetwork: true, refreshOnCreate: false });
    const result = await models.refresh({ allowNetwork: true, force: true });
    return { status: models.getError() || result.errors.size || result.aborted ? 'STALE' : 'REFRESHED', model_count: models.getModels().length, live_verified: false, refresh_completed: !result.aborted && result.errors.size === 0 };
  } finally { store.close(); }
}
export async function recover(config: OperatorConfig, instance: string, runId: string) {
  const store = new Store(join(config.state_dir, instance));
  try {
    const run = store.getRun(runId); if (!run) fail('INVALID_ARGUMENT', 'Unknown run');
    if (!terminalStates.includes(run.state)) fail('RUN_NOT_ACTIVE', 'Start the supervisor once to record interrupted startup recovery before attestation');
    const session = store.getSession(run.sessionId)!;
    const pids = store.events(runId, 0, 100000).filter(event => event.type === 'worker_started').map(event => (event.payload as { pid: number }).pid);
    for (const invocation of store.invocations(runId)) {
      const evidence = invocation.evidence as { launcher_pid?: number }; if (evidence.launcher_pid) pids.push(evidence.launcher_pid);
    }
    for (const pid of pids) {
      if (!Number.isSafeInteger(pid) || pid < 1) fail('STATE_CORRUPT');
      try { process.kill(pid, 0); fail('CLEANUP_UNCONFIRMED', 'A recorded process PID is still live; inspect ownership before recovery'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    if (session.checkpoint) await reopenCheckpoint(session.checkpoint);
    store.transaction(() => {
      store.putRun({ ...run, cleanup: 'operator_attested', updated: Date.now() });
      store.event(runId, 'cleanup_attested', { cleanup_status: 'operator_attested', actor: 'operator', task_replayed: false });
    });
    return { run_id: runId, cleanup_status: 'operator_attested', checkpoint_available: !!session.checkpoint, task_replayed: false };
  } finally { store.close(); }
}
export async function gc(config: OperatorConfig, instance: string, days: number, deletion: boolean) {
  const store = new Store(join(config.state_dir, instance));
  try {
    const before = Date.now() - days * 86400000;
    const candidates = store.runs().filter(run => terminalStates.includes(run.state) && run.updated < before && ['confirmed','operator_attested'].includes(run.cleanup));
    if (deletion) for (const run of candidates) {
      if (!/^run_[a-f0-9-]+$/.test(run.id)) fail('STATE_CORRUPT');
      store.transaction(() => store.prune(run.id));
      await rm(resolve(store.directory, 'runs', run.id), { recursive: true, force: true });
    }
    return { dry_run: !deletion, run_ids: candidates.map(run => run.id), retained: ['request-key tombstones','session identity','native checkpoints','unconfirmed-cleanup runs','scratch pending separate cleanup inspection'] };
  } finally { store.close(); }
}
