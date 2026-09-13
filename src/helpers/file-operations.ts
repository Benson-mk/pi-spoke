import { constants } from 'node:fs';
import { lstat, realpath, open, rename, unlink, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const reserved = new Set(['.git', '.codex', '.agents', '.pi', '.pi-spoke', 'agents.md',
  '.gitconfig', '.gitmodules', '.bashrc', '.bash_profile', '.zshrc', '.zprofile', '.profile', '.ripgreprc', '.mcp.json']);
export function within(root: string, path: string): boolean {
  const part = relative(root, path);
  return part === '' || (part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part));
}

export type FileAuthority = { cwd: string; roots: string[]; protectedPaths: string[] };

export async function checkedTarget(authority: FileAuthority, requested: string, mutation: boolean, createParents = false) {
  const path = resolve(authority.cwd, requested);
  const root = authority.roots.find(root => within(root, path));
  if (!root) throw new Error('PATH_NOT_ALLOWED');
  if (await realpath(root) !== root) throw new Error('UNSAFE_PATH: root changed');
  if (authority.protectedPaths.some(protectedPath => within(protectedPath, path))) throw new Error('PROTECTED_PATH');
  if (mutation && relative(root, path).split(sep).some(part => reserved.has(part.toLowerCase()))) throw new Error('PROTECTED_PATH');
  // Inspect every component, including nonexistent final targets; no traversal through links.
  const parts = relative(root, path).split(sep).filter(Boolean);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (mutation && stat.isFile() && stat.nlink !== 1)) throw new Error('UNSAFE_PATH');
      if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('UNSAFE_PATH');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (index < parts.length - 1) {
        if (!createParents) throw error;
        await mkdir(current, { mode: 0o700 });
      }
    }
  }
  return path;
}

export async function readText(authority: FileAuthority, requested: string): Promise<string> {
  const path = await checkedTarget(authority, requested, false);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('LIMIT_EXCEEDED');
    return await file.readFile('utf8');
  } finally { await file.close(); }
}

/** Complete replacement in an existing authorized parent. No executable input. */
export async function writeText(authority: FileAuthority, requested: string, content: string, expected?: string): Promise<void> {
  const path = await checkedTarget(authority, requested, true, true);
  if (expected !== undefined && await readText(authority, requested) !== expected) throw new Error('FILE_CHANGED');
  if (Buffer.byteLength(content) > 1024 * 1024) throw new Error('LIMIT_EXCEEDED');
  const parent = dirname(path), parentIdentity = await lstat(parent);
  let before;
  try { before = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (before && !before.isFile()) throw new Error('UNSAFE_PATH');
  const temp = join(parent, `.${basename(path)}.pi-spoke-${randomUUID()}`);
  const file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, before ? before.mode & 0o777 : 0o600);
  try {
    await file.writeFile(content); await file.sync(); await file.close();
    await checkedTarget(authority, requested, true);
    const parentAfter = await lstat(parent);
    if (parentAfter.ino !== parentIdentity.ino || parentAfter.dev !== parentIdentity.dev) throw new Error('FILE_CHANGED');
    let after;
    try { after = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (before ? (!after || before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs || before.size !== after.size) : after) throw new Error('FILE_CHANGED');
    await rename(temp, path);
    const directory = await open(parent, constants.O_RDONLY); try { await directory.sync(); } finally { await directory.close(); }
  } finally { await file.close().catch(() => {}); await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
