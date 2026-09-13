import { lstat, realpath, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { OperatorConfig } from '../config.js';
import type { SpawnInput } from '../contracts.js';
import { within } from '../helpers/file-operations.js';
import { fail } from '../core/errors.js';
import { digest } from '../core/idempotency.js';
import { checkWritableTopology } from './topology.js';
import type { ResourceManifest } from '../core/resources.js';

const reserved = ['.git', '.codex', '.agents', '.pi', '.pi-spoke', 'AGENTS.md'];
async function directory(path: string) {
  if (!isAbsolute(path) || /[\x00*?\[\]]/.test(path)) fail('UNSAFE_PATH', 'Roots must be absolute literal paths');
  const canonical = await realpath(path).catch(() => fail('UNSAFE_PATH', 'Root cannot be resolved')), stat = await lstat(canonical);
  if (!stat.isDirectory()) fail('UNSAFE_PATH', 'Root is not a directory');
  return { path: canonical, dev: stat.dev, ino: stat.ino };
}
async function knownPath(path: string): Promise<string> {
  try { return await realpath(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(path); if (parent === path) throw error;
    return join(await knownPath(parent), path.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
  }
}
export async function resolvePolicy(config: OperatorConfig, input: SpawnInput, configPath: string, runtimeRoot: string) {
  const cwd = await directory(input.cwd);
  const workspaces = await Promise.all(config.workspace_roots.map(directory));
  const workspace = workspaces.filter(root => within(root.path, cwd.path)).sort((a, b) => b.path.length - a.path.length)[0] ?? fail('PATH_NOT_ALLOWED');
  const state = await knownPath(config.state_dir), scratch = await knownPath(config.scratch_dir), runtime = await knownPath(runtimeRoot);
  for (const root of workspaces) for (const privateRoot of [state, scratch, runtime]) {
    if (within(root.path, privateRoot) || within(privateRoot, root.path)) fail('PERMISSION_DENIED', 'Workspace overlaps private runtime, state or scratch');
  }
  if (within(state, scratch) || within(scratch, state) || within(runtime, scratch) || within(scratch, runtime)) fail('PERMISSION_DENIED', 'Private roots overlap');
  for (const tool of input.tools) if (!config.allowed_tools.includes(tool)) fail('TOOL_NOT_ALLOWED');
  if (input.suggested_skills.length && !input.tools.includes('read') && !input.tools.includes('bash')) fail('SKILL_READER_REQUIRED');
  if (config.allowed_models && !config.allowed_models.some(model => model.provider === input.model.provider && model.id === input.model.id)) fail('MODEL_NOT_ALLOWED');
  const fileTools = input.tools.includes('edit') || input.tools.includes('write');
  if (fileTools && !input.permissions.file_write_roots.length) fail('WRITE_SCOPE_REQUIRED');
  if ((!fileTools && input.permissions.file_write_roots.length) || (!input.tools.includes('bash') && input.permissions.shell_write_roots.length)) fail('INVALID_ARGUMENT');
  const protectedRead = await Promise.all([state, configPath, config.pi.auth_path, ...(config.pi.models_path ? [config.pi.models_path] : []),
    ...config.sandbox.additional_read_deny_paths].map(knownPath));
  const protectedWrite = [...protectedRead, runtime, ...await Promise.all(config.skill_roots.map(root => knownPath(root.path))),
    ...await Promise.all(config.sandbox.additional_write_deny_paths.map(knownPath)), ...reserved.map(name => join(workspace.path, name))];
  // Shell gets one explicit scratch read/write exception at launch; other instances remain private.
  protectedRead.push(scratch);
  // Resolve worktree pointers as data, without invoking git or repository hooks.
  const git = join(workspace.path, '.git');
  try {
    if ((await lstat(git)).isFile()) {
      const pointer = (await readFile(git, 'utf8')).trim();
      if (!pointer.startsWith('gitdir: ')) fail('UNSAFE_PATH', 'Invalid Git metadata pointer');
      const target = await knownPath(resolve(workspace.path, pointer.slice(8))); protectedWrite.push(target);
      try { protectedWrite.push(await knownPath(resolve(target, (await readFile(join(target, 'commondir'), 'utf8')).trim()))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    } else protectedWrite.push(await knownPath(git));
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  async function grants(requested: string[], ceiling: string[]) {
    const allowed = await Promise.all(ceiling.map(directory));
    return await Promise.all(requested.map(async path => {
      const root = await directory(path);
      if (!within(workspace.path, root.path) || !allowed.some(max => within(max.path, root.path))) fail('PERMISSION_DENIED');
      if (relative(workspace.path, root.path).split(sep).some(part => reserved.some(name => name.toLowerCase() === part.toLowerCase())) ||
        protectedWrite.some(path => within(path, root.path))) fail('PROTECTED_PATH');
      await checkWritableTopology(root.path);
      return root;
    }));
  }
  const fileRoots = await grants(input.permissions.file_write_roots, config.permissions.file_write_roots);
  const shellRoots = await grants(input.permissions.shell_write_roots, config.permissions.shell_write_roots);
  // Literal exclusions cannot yet protect every future nested metadata target in arbitrary code's write root.
  if (shellRoots.length) fail('SANDBOX_POLICY_UNSUPPORTED', 'Project shell-write scopes are not yet qualified; scratch-only shell is supported by the macOS baseline.');
  const wall = input.limits.wall_time_ms ?? config.limits.max_run_wall_time_ms;
  const turns = input.limits.max_turns ?? config.limits.max_run_turns;
  if (wall > config.limits.max_run_wall_time_ms || turns > config.limits.max_run_turns) fail('LIMIT_EXCEEDED');
  const policy = { cwd: cwd.path, workspace: workspace.path, cwdIdentity: cwd, workspaceIdentity: workspace,
    model: input.model, tools: input.tools, file_write_roots: fileRoots.map(root => root.path), shell_write_roots: shellRoots.map(root => root.path),
    rootIdentities: [...fileRoots, ...shellRoots], protected_read_paths: [...new Set(protectedRead)].sort(),
    protected_write_paths: [...new Set(protectedWrite)].sort(), limits: { wall_time_ms: wall, max_turns: turns }, tool_network: 'none' as const };
  return { ...policy, policy_hash: digest({ ...policy, limits: undefined }) };
}
export type ResolvedPolicy = Awaited<ReturnType<typeof resolvePolicy>> & { resources?: ResourceManifest };
