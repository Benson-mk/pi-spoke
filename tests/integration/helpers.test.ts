import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';

test('fixed helper validates typed operations, protected paths, aliases and destructive authorized writes', async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'ps-helper-')));
  try {
    const root = join(fixture, 'root'); await mkdir(root);
    const outside = join(fixture, 'outside'); await writeFile(outside, 'outside');
    const authority = { cwd: root, roots: [root], protectedPaths: [] };
    const invoke = (args: object) => {
      const result = spawnSync(process.execPath, [resolve('dist/helpers/file-tool-entry.js')], {
        input: JSON.stringify({ authority, ...args }), encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 5000,
      });
      return { status: result.status, ...JSON.parse(result.stdout) };
    };
    expect(invoke({ operation: 'write', path: 'file', content: 'new' })).toMatchObject({ status: 0, written: true });
    expect(invoke({ operation: 'read', path: 'file' })).toMatchObject({ text: 'new' });
    expect(invoke({ operation: 'write', path: 'file', content: '' }).status).toBe(0);
    expect(await readFile(join(root, 'file'), 'utf8')).toBe('');
    expect(invoke({ operation: 'write', path: '../outside', content: 'bad' }).error).toBe('PATH_NOT_ALLOWED');
    expect(invoke({ operation: 'write', path: 'AGENTS.md', content: 'bad' }).error).toBe('PROTECTED_PATH');
    await mkdir(join(root, 'a/b/c/d/e'), { recursive: true });
    expect(invoke({ operation: 'write', path: 'a/b/c/d/e/AGENTS.md', content: 'bad' }).error).toBe('PROTECTED_PATH');
    await symlink(outside, join(root, 'alias'));
    expect(invoke({ operation: 'write', path: 'alias', content: 'bad' }).error).toBe('UNSAFE_PATH');
    expect(invoke({ operation: 'execute', command: 'anything', path: 'file' }).status).not.toBe(0);
    expect(invoke({ operation: 'write', path: 'file', content: 'bad', command: 'anything' }).status).not.toBe(0);
    expect(await readFile(outside, 'utf8')).toBe('outside');
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('S27: invalid or missing launcher configuration never executes supplied command', () => {
  for (const input of ['', '{}', JSON.stringify({ command: 'exit 0', dangerously_unsandboxed: true })]) {
    const result = spawnSync(process.execPath, [resolve('dist/sandbox/p0-launcher.js')], {
      input, encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 5000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  }
});
