import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fail } from '../core/errors.js';

/** Conservative admission check; worker-created paths remain subject to OS enforcement. */
export async function checkWritableTopology(root: string): Promise<{ path: string; dev: number; ino: number }> {
  if (!isAbsolute(root)) fail('UNSAFE_PATH', 'UNSAFE_PATH: writable root must be absolute');
  const canonical = await realpath(root);
  const identity = await lstat(canonical);
  if (!identity.isDirectory()) fail('UNSAFE_PATH', 'UNSAFE_PATH: writable root must be a directory');
  let examined = 0;
  async function visit(path: string): Promise<void> {
    if (++examined > 100000) fail('SANDBOX_POLICY_UNSUPPORTED', 'Topology scan limit exceeded');
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || entry.dev !== identity.dev || (entry.isFile() && entry.nlink !== 1)) {
      fail('UNSAFE_PATH', 'UNSAFE_PATH: writable aliases, mount crossings and multiply-linked files are unsupported');
    }
    if (entry.isDirectory()) {
      for (const name of await readdir(path)) await visit(join(path, name));
    } else if (!entry.isFile()) {
      fail('UNSAFE_PATH', 'UNSAFE_PATH: writable special files are unsupported');
    }
  }
  await visit(canonical);
  const after = await lstat(canonical);
  if (after.dev !== identity.dev || after.ino !== identity.ino) fail('UNSAFE_PATH', 'UNSAFE_PATH: root identity changed');
  return { path: canonical, dev: identity.dev, ino: identity.ino };
}
