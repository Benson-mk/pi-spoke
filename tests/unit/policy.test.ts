import { mkdtemp, mkdir, rm, realpath, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { spawnSchema } from '../../src/contracts.js';
import { resolvePolicy } from '../../src/security/policy.js';

test('S01–S03/S18/S30/S36: independent grants, whole-request rejection, canonical roots and strict migration', async () => {
  const fixture = await realpath(await mkdtemp('/private/tmp/ps-policy-'));
  try {
    const cwd = join(fixture, 'project'), source = join(cwd, 'src'), other = join(fixture, 'project-other');
    await mkdir(source, { recursive: true }); await mkdir(other);
    const config = parseConfig({ version: 2, state_dir: join(fixture, 'state'), scratch_dir: join(fixture, 'scratch'), workspace_roots: [cwd],
      pi: { auth_path: join(fixture, 'auth.json') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
    const input = spawnSchema.parse({ request_key: 'one', task: 'test', cwd, model: { provider: 'fixture', id: 'fixture' } });
    const resolveGrant = (value = input, policy = config) => resolvePolicy(policy, value, join(fixture, 'config.json'), resolve('.'));
    expect((await resolveGrant()).file_write_roots).toEqual([]);
    await expect(resolveGrant({ ...input, tools: ['bash'] })).rejects.toMatchObject({ code: 'TOOL_NOT_ALLOWED' });
    const editable = { ...config, allowed_tools: [...config.allowed_tools, 'edit' as const, 'bash' as const], permissions: { file_write_roots: [source], shell_write_roots: [] } };
    await expect(resolveGrant({ ...input, tools: ['edit'] }, editable)).rejects.toMatchObject({ code: 'WRITE_SCOPE_REQUIRED' });
    const granted = { ...input, tools: ['edit' as const, 'bash' as const], permissions: { file_write_roots: [source], shell_write_roots: [] } };
    expect((await resolveGrant(granted, editable)).shell_write_roots).toEqual([]);
    await expect(resolveGrant({ ...granted, permissions: { file_write_roots: [source, other], shell_write_roots: [] } }, editable)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(resolveGrant({ ...granted, permissions: { file_write_roots: [cwd], shell_write_roots: [] } }, editable)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(resolveGrant(granted, { ...editable, permissions: { file_write_roots: [], shell_write_roots: [] } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await symlink(source, join(fixture, 'alias'));
    expect((await resolveGrant({ ...granted, permissions: { file_write_roots: [join(fixture, 'alias')], shell_write_roots: [] } }, editable)).file_write_roots).toEqual([source]);
    expect(() => parseConfig({ ...config, version: 1 })).toThrow('migration');
    expect(() => parseConfig({ ...config, dangerously_unsandboxed: true })).toThrow();
    expect(() => parseConfig({ ...config, sandbox: { ...config.sandbox, required: false } })).toThrow();
    expect(() => parseConfig({ ...config, sandbox: { ...config.sandbox, tool_network: 'all' } })).toThrow();
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
