#!/usr/bin/env node
/** Synthetic, finite fixture for fixed-helper serial/concurrent sandbox launches. */
import { mkdtemp, mkdir, writeFile, symlink, realpath, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { platform } from 'node:os';
import assert from 'node:assert/strict';
import { parseConfig } from '../dist/config.js';
import { spawnSchema } from '../dist/contracts.js';
import { resolvePolicy } from '../dist/security/policy.js';
import { Sandbox } from '../dist/sandbox/backend.js';
import { installedQualification } from '../dist/sandbox/qualification.js';

const iterations = 3;
const root = await realpath(await mkdtemp('/private/tmp/ps-concurrency-'));
const cwd = join(root, 'project');
await mkdir(cwd);
await writeFile(join(cwd, 'a.txt'), 'synthetic-one\n');
await writeFile(join(cwd, 'b.txt'), 'synthetic-two\n');
await symlink(join(root, 'outside.txt'), join(cwd, 'unsafe.txt'));
await writeFile(join(root, 'outside.txt'), 'synthetic-outside\n');
const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'),
  workspace_roots: [cwd], allowed_tools: ['read', 'find', 'grep'],
  pi: { auth_path: join(root, 'auth') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
const runtimeRoot = resolve('.');
const policy = await resolvePolicy(config, spawnSchema.parse({ request_key: 'synthetic', task: 'read synthetic fixture', cwd,
  model: { provider: 'fixture', id: 'fixture' }, tools: ['read', 'find', 'grep'] }), join(root, 'config'), runtimeRoot);
const sandbox = new Sandbox(config, runtimeRoot);
let toolchain = null;
const deadline = Date.now() + 120_000;
const activeRuns = new Set();
let cleanupUncertain = false;
const cancel = async runId => { if (await sandbox.cancel(runId) === 'unconfirmed') cleanupUncertain = true; };
const timer = setTimeout(() => { for (const runId of activeRuns) void cancel(runId); }, 120_000);
const checkDeadline = () => assert.ok(Date.now() < deadline, 'fixture exceeded its two-minute bound');
const cases = [
  { tool: 'read', args: { path: 'a.txt' }, expected: 'synthetic-one' },
  { tool: 'find', args: { pattern: '*.txt' }, expected: 'a.txt' },
  { tool: 'grep', args: { pattern: 'synthetic-two', glob: 'b.txt' }, expected: 'synthetic-two' },
];
const evidence = [];
let preflight;

async function invoke(runId, scratch, item, schedule, iteration) {
  checkDeadline();
  const stages = [];
  let record;
  try {
    const outcome = await sandbox.tool(runId, policy, scratch, item.tool, item.args, (stage, identity) => {
      stages.push({ stage, at: Date.now(), ...identity });
    });
    const text = outcome.result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    record = { schedule, iteration, tool: item.tool, launched: stages.some(stage => stage.stage === 'helper_launched'),
      settled: stages.some(stage => stage.stage === 'result_received'), uncertain: outcome.cleanup === 'unconfirmed',
      cleanup: outcome.cleanup, error_category: outcome.diagnostic?.category ?? null,
      process_identity_known: stages.some(stage => stage.stage === 'helper_launched' && Number.isInteger(stage.helper?.pid)),
      launched_at: stages.find(stage => stage.stage === 'helper_launched')?.at ?? null,
      settled_at: stages.find(stage => stage.stage === 'result_received')?.at ?? null,
      lifecycle: stages };
    assert.equal(outcome.result.isError, undefined, `${schedule} ${iteration} ${item.tool}: valid helper failed`);
    assert.equal(outcome.cleanup, 'confirmed', `${schedule} ${iteration} ${item.tool}: cleanup uncertain`);
    assert.ok(text.includes(item.expected), `${schedule} ${iteration} ${item.tool}: missing synthetic result`);
    assert.equal(record.launched && record.settled && record.process_identity_known, true,
      `${schedule} ${iteration} ${item.tool}: missing lifecycle evidence`);
    return record;
  } catch (error) {
    record ??= { schedule, iteration, tool: item.tool, launched: stages.some(stage => stage.stage === 'helper_launched'),
      settled: stages.some(stage => stage.stage === 'result_received'), uncertain: true,
      cleanup: 'unconfirmed', lifecycle: stages };
    record.assertion = String(error);
    if (!record.settled || record.uncertain || record.cleanup === 'unconfirmed') cleanupUncertain = true;
    throw error;
  } finally { evidence.push(record); }
}

try {
  toolchain = await installedQualification(runtimeRoot);
  let overlappingIterations = 0;
  for (const schedule of ['serial', 'concurrent']) for (let iteration = 1; iteration <= iterations; iteration++) {
    checkDeadline();
    const runId = 'run_' + randomUUID(), scratch = await sandbox.createScratch(runId);
    activeRuns.add(runId);
    try {
      preflight = await sandbox.preflight(runId, policy, scratch);
      if (schedule === 'serial') for (const item of cases) await invoke(runId, scratch, item, schedule, iteration);
      else {
        const outcomes = await Promise.allSettled(cases.map(item => invoke(runId, scratch, item, schedule, iteration)));
        const failure = outcomes.find(item => item.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        const parallel = outcomes.map(item => item.value);
        const firstSettle = Math.min(...parallel.map(record => record.settled_at));
        assert.ok(parallel.filter(record => record.launched_at <= firstSettle).length >= 2,
          `concurrent ${iteration}: no overlapping helper lifetimes`);
        overlappingIterations++;
      }
    } finally { await cancel(runId); activeRuns.delete(runId); }
  }
  const negativeRun = 'run_' + randomUUID(), negativeScratch = await sandbox.createScratch(negativeRun);
  activeRuns.add(negativeRun);
  let unsafe;
  try {
    checkDeadline(); await sandbox.preflight(negativeRun, policy, negativeScratch);
    unsafe = await sandbox.tool(negativeRun, policy, negativeScratch, 'read', { path: 'unsafe.txt' });
    assert.equal(unsafe.diagnostic?.category, 'UNSAFE_PATH');
    assert.equal(unsafe.cleanup, 'confirmed');
  } finally { await cancel(negativeRun); activeRuns.delete(negativeRun); }
  const unavailable = new Sandbox(config, join(root, 'missing-runtime'));
  let unavailableCode = null;
  try { await unavailable.tool('run_' + randomUUID(), policy, negativeScratch, 'read', { path: 'a.txt' }); }
  catch (error) { unavailableCode = error.code ?? null; }
  assert.equal(unavailableCode, 'SANDBOX_UNAVAILABLE');
  const successful = evidence.filter(item => item.settled && !item.uncertain);
  assert.equal(successful.length, iterations * 2 * cases.length);
  console.log(JSON.stringify({ fixture: 'fixed-helper-concurrency-v1', status: 'PASS', node: process.version, platform: platform(),
    toolchain, policy_hash: policy.policy_hash,
    backend: preflight.name, backend_version: preflight.version, sandbox_binary_sha256: preflight.binary_sha256,
    iterations, schedules: ['serial', 'concurrent'], cases: cases.map(item => item.tool),
    successful: successful.length, overlapping_concurrent_iterations: overlappingIterations,
    uncertain: evidence.filter(item => item.uncertain).length,
    negative: { unsafe_path: unsafe.diagnostic.category, unavailable_setup: unavailableCode },
    historical_cause: 'unresolved; no valid-read failure reproduced', evidence }, null, 2));
} catch (error) {
  if (activeRuns.size) cleanupUncertain = true;
  console.error(JSON.stringify({ fixture: 'fixed-helper-concurrency-v1', status: 'FAIL', assertion: String(error),
    node: process.version, toolchain, policy_hash: policy.policy_hash, iterations, cases, evidence,
    fixture_path: cleanupUncertain ? root : null,
    cleanup: cleanupUncertain ? 'unconfirmed; fixture retained for operator inspection' : 'confirmed; no work replayed' }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await Promise.all([...activeRuns].map(runId => cancel(runId)));
  if (!cleanupUncertain) await rm(root, { recursive: true, force: true });
}
