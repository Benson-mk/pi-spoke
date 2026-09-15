import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, stat, access, symlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { checkMcp, copyInstallation, defaults, prepare, readAnswers, save } from '../../scripts/setup-config.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ps-setup-')); roots.push(root);
  const workspace = join(root, 'workspace with spaces'), staging = join(root, 'staging'), configDir = join(root, 'config');
  await mkdir(workspace); await mkdir(staging);
  const values = { ...await defaults(configDir), PS_RUNTIME: resolve('.'), PS_NODE: process.execPath,
    PS_WORKSPACE: workspace, PS_STATE_DIR: join(root, 'state'), PS_SCRATCH_DIR: join(root, 'scratch'),
    PS_AUTH_MODE: 'new', PS_PROVIDER: 'setup-fixture', PS_MODEL: 'model/fixture', PS_KEY: 'secret-"\\=value',
    PS_BASE_URL: 'http://127.0.0.1:9/v1', PS_PERMISSION_MODE: 'read' };
  return { root, workspace, staging, configDir, values };
}

test('setup prepares privately, preserves literal credentials, and exposes all six MCP tools without inference', async () => {
  const f = await fixture();
  const plan = await prepare(f.values, f.staging);
  await expect(access(f.configDir)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(f.values.PS_STATE_DIR)).rejects.toMatchObject({ code: 'ENOENT' });
  await save(plan);
  const config = JSON.parse(await readFile(join(f.configDir, 'config.json'), 'utf8'));
  expect(config.allowed_tools).toEqual(['read', 'grep', 'find', 'ls']);
  expect(config.permissions).toEqual({ file_write_roots: [], shell_write_roots: [] });
  expect(config.sandbox.tool_network).toBe('none');
  expect(JSON.parse(await readFile(config.pi.auth_path, 'utf8'))['setup-fixture'].key).toBe(f.values.PS_KEY);
  expect((await stat(config.pi.auth_path)).mode & 0o777).toBe(0o600);
  expect((await stat(f.configDir)).mode & 0o777).toBe(0o700);
  expect(await checkMcp(plan)).toHaveLength(6);
  // The configured endpoint has no provider listening: startup/discovery must not call it.
}, 30000);

test('reuse keeps Pi JSONC and credential commands as inert files and retains unrelated policy', async () => {
  const f = await fixture();
  const first = await prepare(f.values, f.staging); await save(first);
  const configPath = join(f.configDir, 'config.json');
  const old = JSON.parse(await readFile(configPath, 'utf8'));
  const another = join(f.root, 'another-workspace'); await mkdir(another);
  old.workspace_roots.push(another);
  old.allowed_models.push({ provider: 'other', id: 'retain-me' });
  old.project_skills = true;
  old.sandbox.additional_read_deny_paths = [join(f.root, 'private')];
  await writeFile(configPath, JSON.stringify(old));
  const authText = JSON.stringify({ 'setup-fixture': { type: 'api_key', key: `!touch ${join(f.root, 'must-not-execute')}` } });
  await writeFile(old.pi.auth_path, authText);
  const modelsText = '// Keep this operator comment\n' + await readFile(old.pi.models_path, 'utf8');
  await writeFile(old.pi.models_path, modelsText);
  const plan = await prepare({ ...f.values, PS_AUTH_MODE: 'reuse', PS_AUTH_PATH: old.pi.auth_path,
    PS_MODELS_PATH: old.pi.models_path, PS_PERMISSION_MODE: 'keep', PS_DESCRIPTION: 'Updated description' }, f.staging);
  const backups = await save(plan);
  expect(plan.config.workspace_roots).toContain(another);
  expect(plan.config.allowed_models).toContainEqual({ provider: 'other', id: 'retain-me' });
  expect(plan.config.project_skills).toBe(true);
  expect(plan.config.sandbox.additional_read_deny_paths).toEqual(old.sandbox.additional_read_deny_paths);
  expect(await readFile(old.pi.auth_path, 'utf8')).toBe(authText);
  expect(await readFile(old.pi.models_path, 'utf8')).toBe(modelsText);
  expect(backups).toHaveLength(2);
  expect(JSON.parse(await readFile(backups.find(p => p.includes('config.json.backup-')), 'utf8'))).toEqual(old);
  await expect(access(join(f.root, 'must-not-execute'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('setup rejects source/private overlap, unrelated write grants, and overwriting provider files', async () => {
  const f = await fixture();
  await expect(prepare({ ...f.values, PS_WORKSPACE: resolve('.') }, f.staging)).rejects.toThrow('overlaps');
  await expect(prepare({ ...f.values, PS_CONFIG_DIR: join(f.workspace, 'config') }, f.staging)).rejects.toThrow('outside worker workspaces');
  const alias = join(f.root, 'workspace-alias'); await symlink(f.workspace, alias);
  await expect(prepare({ ...f.values, PS_STATE_DIR: join(alias, 'state') }, f.staging)).rejects.toThrow('overlaps');
  await expect(prepare({ ...f.values, PS_PERMISSION_MODE: 'edit', PS_FILE_ROOT: f.root }, f.staging)).rejects.toThrow('inside a configured workspace');
  await save(await prepare(f.values, f.staging));
  await expect(prepare(f.values, f.staging)).rejects.toThrow('Refusing to replace existing provider files');
});

test('concurrent config edits abort saving before any reviewed file is changed', async () => {
  const f = await fixture();
  const plan = await prepare(f.values, f.staging);
  await mkdir(f.configDir);
  const path = join(f.configDir, 'config.json'); await writeFile(path, 'user changed this');
  await expect(save(plan)).rejects.toThrow('File changed since review');
  expect(await readFile(path, 'utf8')).toBe('user changed this');
  await expect(access(join(f.configDir, 'auth.json'))).rejects.toMatchObject({ code: 'ENOENT' });
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

test('answer parsing treats shell syntax and equals signs as data', () => {
  expect(readAnswers('PS_KEY=secret=abc\nPS_DESCRIPTION=$(touch never) `echo never`\n')).toMatchObject({
    PS_KEY: 'secret=abc', PS_DESCRIPTION: '$(touch never) `echo never`',
  });
});
