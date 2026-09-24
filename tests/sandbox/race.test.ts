import { mkdtemp, mkdir, writeFile, readFile, realpath, rename, symlink, unlink, rm, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { spawnSchema } from '../../src/contracts.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { Sandbox } from '../../src/sandbox/backend.js';

test('S21/S27: ancestor swaps cannot mutate an outside canary; missing qualified runtime fails closed', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-race-'));
  const cwd = join(root, 'p'), target = join(cwd, 'target'), parked = join(cwd, 'parked'), outside = join(root, 'outside');
  await mkdir(target, { recursive: true }); await mkdir(outside); await writeFile(join(outside, 'file'), 'outside-canary');
  const config = parseConfig({ version: 2, state_dir: join(root, 's'), scratch_dir: join(root, 't'), workspace_roots: [cwd],
    allowed_tools: ['write'], permissions: { file_write_roots: [cwd] }, pi: { auth_path: join(root, 'auth') },
    sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const input = spawnSchema.parse({ request_key: 'race', task: 'fixture', cwd, tools: ['write'],
    permissions: { file_write_roots: [cwd] }, model: { provider: 'fixture', id: 'fixture' } });
  const policy = await resolvePolicy(config, input, join(root, 'config'), resolve('.'));
  const sandbox = new Sandbox(config, resolve('.')), run = 'run_' + randomUUID(), scratch = await sandbox.createScratch(run);
  let stop = false, swapFailure: unknown, symlinkWindows = 0;
  const retireParked = async () => {
    // An authorized helper may recreate target while its former directory is parked.
    if (!(await lstat(target)).isDirectory()) throw new Error('Unexpected ancestor topology during swap');
    await rename(parked, join(cwd, 'retired-' + randomUUID()));
  };
  const swapping = (async () => {
    while (!stop) {
      await rename(target, parked);
      try { await symlink(outside, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await retireParked(); continue;
      }
      symlinkWindows++;
      await new Promise(resolve => setTimeout(resolve, 2));
      await unlink(target);
      try { await rename(parked, target); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await retireParked(); continue;
      }
      await new Promise(resolve => setTimeout(resolve, 2));
    }
  })().catch(error => { swapFailure = error; stop = true; });
  try {
    for (let i = 0; i < 4; i++) await sandbox.tool(run, policy, scratch, 'write', { path: 'target/file', content: 'in-scope write' });
    if (swapFailure) throw swapFailure;
    expect(symlinkWindows).toBeGreaterThan(0);
    expect(await readFile(join(outside, 'file'), 'utf8')).toBe('outside-canary');
    const missing = new Sandbox(config, root);
    await expect(missing.tool('run_' + randomUUID(), policy, scratch, 'write', { path: 'file', content: 'bad' }))
      .rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
  } finally {
    stop = true;
    await swapping;
    const canary = await readFile(join(outside, 'file'), 'utf8');
    await sandbox.cancel(run);
    await rm(root, { recursive: true, force: true });
    expect(canary).toBe('outside-canary');
    if (swapFailure) throw swapFailure;
  }
}, 20000);
