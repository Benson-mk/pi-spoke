import { readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { platform, arch, release } from 'node:os';
import { createHash } from 'node:crypto';
import { fail } from '../core/errors.js';
import { qualificationPins } from './qualification-pins.js';

export type Qualification = { platform: string; architecture: string; os: string; lock: string; node: string; bash: string; backend: string; compiler: string };
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
export async function installedQualification(runtimeRoot: string): Promise<Qualification> {
  const root = join(runtimeRoot, 'node_modules/@anthropic-ai/sandbox-runtime'), files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, file.name); if (file.isDirectory()) await walk(path); else if (file.name.endsWith('.js')) files.push(path);
    }
  };
  await walk(join(root, 'dist')); files.push(join(root, 'package.json')); files.sort();
  const entries = await Promise.all(files.map(async file => [relative(root, file), await hash(file)]));
  return { platform: platform(), architecture: arch(), os: release(), lock: await hash(join(runtimeRoot, 'package-lock.json')),
    node: await hash(process.execPath), bash: await hash('/bin/bash'), backend: await hash(await realpath('/usr/bin/sandbox-exec')),
    compiler: createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}
export function assertQualification(actual: Qualification, expected: Qualification = qualificationPins): void {
  for (const key of Object.keys(expected) as (keyof Qualification)[]) if (actual[key] !== expected[key]) fail('SANDBOX_UNAVAILABLE', `Compatibility proof invalidated (${key}); rerun qualification before enabling execution`);
}
export async function verifyQualification(runtimeRoot: string) {
  const actual = await installedQualification(runtimeRoot); assertQualification(actual); return actual;
}
