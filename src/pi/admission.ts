import { mkdir, lstat, readFile, open, realpath } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { OperatorConfig } from '../config.js';
import type { SpawnInput } from '../contracts.js';
import type { ResolvedPolicy } from '../security/policy.js';
import type { ResourceManifest, ImageResource } from '../core/resources.js';
import { checkedTarget, within } from '../helpers/file-operations.js';
import { fail } from '../core/errors.js';
import { requireModel } from './identity.js';
import { selectSkills } from './skills.js';

export async function admitResources(config: OperatorConfig, input: SpawnInput, policy: ResolvedPolicy, runtime: ModelRuntime): Promise<ResourceManifest> {
  const model = requireModel(runtime, input.model);
  if (input.attachments.length && !model.input.includes('image')) fail('UNSUPPORTED_INPUT', 'attachments: selected model does not support image input');
  const context: ResourceManifest['context'] = [], images: ImageResource[] = [];
  const authority = { cwd: policy.cwd, roots: [policy.workspace, ...config.skill_roots.map(root => root.path)], protectedPaths: policy.protected_read_paths };
  const candidates: string[] = [];
  if (input.project_context === 'agents') {
    let directory = policy.cwd; const dirs = [];
    while (within(policy.workspace, directory)) { dirs.unshift(directory); if (directory === policy.workspace) break; directory = dirname(directory); }
    for (const dir of dirs) { const path = join(dir, 'AGENTS.md'); try { await lstat(path); candidates.push(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  }
  candidates.push(...input.context_files);
  let bytes = 0;
  for (const candidate of [...new Set(candidates)]) {
    const path = await checkedTarget(authority, candidate, false), stat = await lstat(path);
    if (!stat.isFile()) fail('UNSUPPORTED_INPUT', 'context_files: expected a regular file');
    if (stat.size > 65536) fail('LIMIT_EXCEEDED', `Single context file measured ${stat.size} bytes; allowed 65536 bytes`);
    const data = await readFile(path);
    if (data.length > 65536) fail('LIMIT_EXCEEDED', `Single context file measured ${data.length} bytes; allowed 65536 bytes`);
    bytes += data.length;
    if (bytes > 65536) fail('LIMIT_EXCEEDED', `Aggregate context measured ${bytes} bytes; allowed 65536 bytes`);
    context.push({ path, hash: createHash('sha256').update(data).digest('hex'), content: data.toString('utf8') });
  }
  for (const attachment of input.attachments) {
    const source = await checkedTarget(authority, attachment.path, false);
    const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    let data: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile()) fail('UNSUPPORTED_INPUT', 'attachments: expected a regular image file');
      if (stat.size > 10 * 1024 * 1024) fail('UNSUPPORTED_INPUT', `Image measured ${stat.size} bytes; allowed ${10 * 1024 * 1024} bytes`);
      data = await file.readFile();
    }
    finally { await file.close(); }
    if (data.length > 10 * 1024 * 1024) fail('UNSUPPORTED_INPUT', `Image measured ${data.length} bytes; allowed ${10 * 1024 * 1024} bytes`);
    let mimeType: ImageResource['mimeType'];
    if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mimeType = 'image/png';
    else if (data[0] === 255 && data[1] === 216 && data[2] === 255) mimeType = 'image/jpeg';
    else if (data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP') mimeType = 'image/webp';
    else fail('UNSUPPORTED_INPUT', 'Image signature must be PNG, JPEG or WebP');
    const hash = createHash('sha256').update(data).digest('hex');
    const directory = join(config.state_dir, 'inputs'); await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(await realpath(directory), hash);
    let output;
    try { output = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); await output.writeFile(data); await output.sync(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || createHash('sha256').update(await readFile(path)).digest('hex') !== hash) throw error; }
    finally { await output?.close(); }
    images.push({ path, source, hash, mimeType });
  }
  return { context, images, skills: await selectSkills(config, policy.cwd, input.suggested_skills) };
}
