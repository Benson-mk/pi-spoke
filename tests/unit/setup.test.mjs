import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, writeFile, stat, access, symlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { checkMcp, copyInstallation, defaults, detectPi, prepare, readAnswers, save } from '../../scripts/setup-config.mjs';
import { resolvePolicy } from '../../src/security/policy.ts';
import { spawnSchema } from '../../src/contracts.ts';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ps-setup-')); roots.push(root);
  const workspace = join(root, 'workspace with spaces'), staging = join(root, 'staging'), configDir = join(root, 'config'), piDir = join(root, 'pi');
  await mkdir(workspace); await mkdir(staging);
  const values = { ...await defaults(configDir, piDir), PS_RUNTIME: resolve('.'), PS_NODE: process.execPath,
    PS_WORKSPACE: workspace, PS_STATE_DIR: join(root, 'state'), PS_SCRATCH_DIR: join(root, 'scratch') };
  return { root, workspace, staging, configDir, piDir, values };
}

async function piFiles(f) {
  await mkdir(f.piDir);
  const auth = JSON.stringify({ fixture: { type: 'api_key', key: `!touch ${join(f.root, 'must-not-execute')}` } });
  const models = '// Keep this Pi comment\n{"providers": {}}';
  await writeFile(join(f.piDir, 'auth.json'), auth);
  await writeFile(join(f.piDir, 'models.json'), models);
  return { auth, models };
}

test('default setup uses read-only limits and verifies MCP without creating provider files or instance state', async () => {
  const f = await fixture();
  const plan = await prepare(f.values, f.staging);
  await expect(access(f.configDir)).rejects.toMatchObject({ code: 'ENOENT' });
  await save(plan);
  const config = JSON.parse(await readFile(join(f.configDir, 'config.json'), 'utf8'));
  expect(config.allowed_tools).toEqual(['read', 'grep', 'find', 'ls']);
  expect(config.permissions).toEqual({ file_write_roots: [], shell_write_roots: [] });
  expect(config.sandbox.tool_network).toBe('none');
  expect(config.limits).toMatchObject({ max_run_wall_time_ms: 180000, max_run_turns: 12, max_active_runs: 3 });
  expect(config.allowed_models).toEqual([]);
  const input = spawnSchema.parse({ request_key: 'no-model-yet', task: 'No worker may run.', cwd: f.workspace, model: { provider: 'fixture', id: 'not-configured' } });
  await expect(resolvePolicy(config, input, join(f.configDir, 'config.json'), resolve('.'))).rejects.toMatchObject({ code: 'MODEL_NOT_ALLOWED' });
  expect((await stat(join(f.configDir, 'config.json'))).mode & 0o777).toBe(0o600);
  expect((await stat(f.configDir)).mode & 0o777).toBe(0o700);
  expect(await checkMcp(plan)).toHaveLength(6);
  await expect(access(config.pi.auth_path)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(config.pi.models_path)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readdir(config.state_dir)).toEqual([]);
}, 30000);

test.each([undefined, [], [{ provider: 'other', id: 'retain-me', description: 'Keep this guidance' }]])(
  'declining Pi import preserves existing model policy %j and all unprompted settings', async allowed => {
    const f = await fixture();
    await save(await prepare(f.values, f.staging));
    const configPath = join(f.configDir, 'config.json');
    const old = JSON.parse(await readFile(configPath, 'utf8'));
    const another = join(f.root, 'another-workspace'); await mkdir(another);
    old.workspace_roots.push(another);
    if (allowed === undefined) delete old.allowed_models; else old.allowed_models = allowed;
    old.project_skills = true;
    old.limits.max_run_turns = 99;
    old.allowed_tools.push('edit', 'write');
    old.permissions.file_write_roots = [another];
    old.sandbox.additional_read_deny_paths = [join(f.root, 'private')];
    await writeFile(configPath, JSON.stringify(old));
    const original = await piFiles(f);
    const detected = await defaults(f.configDir, f.piDir);
    expect(detected.PS_PI_DIR).not.toBe('');
    const plan = await prepare({ ...f.values, PS_PI_DIR: detected.PS_PI_DIR, PS_LOAD_PI: 'no' }, f.staging);
    const backups = await save(plan);
    expect(plan.config).toEqual(old);
    expect(backups).toHaveLength(2);
    expect(JSON.parse(await readFile(backups.find(p => p.includes('config.json.backup-')), 'utf8'))).toEqual(old);
    expect(await readFile(join(f.piDir, 'auth.json'), 'utf8')).toBe(original.auth);
    expect(await readFile(join(f.piDir, 'models.json'), 'utf8')).toBe(original.models);
    await expect(access(join(f.root, 'must-not-execute'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

test('accepting Pi import references its files and exposes its catalog without executing credential commands', async () => {
  const f = await fixture(), original = await piFiles(f);
  const detected = await detectPi(f.piDir);
  const plan = await prepare({ ...f.values, PS_PI_DIR: detected.directory, PS_LOAD_PI: 'yes' }, f.staging);
  await save(plan);
  expect(plan.config.pi).toEqual({ auth_path: detected.auth_path, models_path: detected.models_path });
  expect(plan.config).not.toHaveProperty('allowed_models');
  expect(plan.config.permissions).toEqual({ file_write_roots: [], shell_write_roots: [] });
  expect(await checkMcp(plan)).toHaveLength(6);
  expect(await readFile(detected.auth_path, 'utf8')).toBe(original.auth);
  expect(await readFile(detected.models_path, 'utf8')).toBe(original.models);
  await expect(access(join(f.root, 'must-not-execute'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await readdir(f.configDir)).sort()).toEqual(['codex.toml', 'config.json']);
}, 30000);

test('Pi detection supports built-in-only setups and absent configurations', async () => {
  const f = await fixture();
  expect(await detectPi(f.piDir)).toBeNull();
  await mkdir(f.piDir); await writeFile(join(f.piDir, 'auth.json'), '{}');
  const detected = await detectPi(f.piDir);
  expect(detected).not.toHaveProperty('models_path');
  const plan = await prepare({ ...f.values, PS_PI_DIR: detected.directory, PS_LOAD_PI: 'yes' }, f.staging);
  expect(plan.config.pi).toEqual({ auth_path: detected.auth_path });
});

test('setup rejects source/private overlap and imported Pi files inside a workspace', async () => {
  const f = await fixture();
  await expect(prepare({ ...f.values, PS_WORKSPACE: resolve('.') }, f.staging)).rejects.toThrow('overlaps');
  await expect(prepare({ ...f.values, PS_CONFIG_DIR: join(f.workspace, 'config') }, f.staging)).rejects.toThrow('outside worker workspaces');
  const alias = join(f.root, 'workspace-alias'); await symlink(f.workspace, alias);
  await expect(prepare({ ...f.values, PS_STATE_DIR: join(alias, 'state') }, f.staging)).rejects.toThrow('overlaps');
  await writeFile(join(f.workspace, 'auth.json'), '{}');
  await expect(prepare({ ...f.values, PS_PI_DIR: f.workspace, PS_LOAD_PI: 'yes' }, f.staging)).rejects.toThrow('outside worker workspaces');
});

test('concurrent config edits abort saving before any reviewed file is changed', async () => {
  const f = await fixture();
  const plan = await prepare(f.values, f.staging);
  await mkdir(f.configDir);
  const path = join(f.configDir, 'config.json'); await writeFile(path, 'user changed this');
  await expect(save(plan)).rejects.toThrow('File changed since review');
  expect(await readFile(path, 'utf8')).toBe('user changed this');
  await expect(access(join(f.configDir, 'codex.toml'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('installation copies only runtime sources and refuses to overwrite an existing directory', async () => {
  const f = await fixture(), source = join(f.root, 'source'), target = join(f.root, 'installed');
  await mkdir(source);
  for (const name of ['src', 'scripts', 'docs', 'examples', 'skills']) await mkdir(join(source, name));
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'CONTEXT.md', 'LICENSE', '.env']) await writeFile(join(source, name), 'fixture');
  await copyInstallation(source, target);
  await expect(access(join(target, '.env'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(target, 'package-lock.json'), 'utf8')).toBe('fixture');
  await expect(copyInstallation(source, target)).rejects.toMatchObject({ code: 'EEXIST' });
});

test('answer parsing treats shell syntax and equals signs as path data', () => {
  expect(readAnswers('PS_WORKSPACE=/tmp/a=b\nPS_CONFIG_DIR=/tmp/$(touch never) `echo never`\n')).toMatchObject({
    PS_WORKSPACE: '/tmp/a=b', PS_CONFIG_DIR: '/tmp/$(touch never) `echo never`',
  });
});
