import { mkdtemp, mkdir, writeFile, link, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { checkWritableTopology } from '../../src/security/topology.js';

test('S20: reject pre-existing hard-link and symlink aliases; accept ordinary writable trees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ps-topology-'));
  try {
    const writable = join(root, 'write'); await mkdir(writable);
    await writeFile(join(root, 'source'), 'canary');
    await writeFile(join(writable, 'ordinary'), 'ok');
    expect((await checkWritableTopology(writable)).ino).toBeGreaterThan(0);
    await link(join(root, 'source'), join(writable, 'alias'));
    await expect(checkWritableTopology(writable)).rejects.toThrow('UNSAFE_PATH');
    await rm(join(writable, 'alias'));
    await symlink(join(root, 'source'), join(writable, 'alias'));
    await expect(checkWritableTopology(writable)).rejects.toThrow('UNSAFE_PATH');
    await expect(checkWritableTopology('relative')).rejects.toThrow('UNSAFE_PATH');
  } finally { await rm(root, { recursive: true, force: true }); }
});
