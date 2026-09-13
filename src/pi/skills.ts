import { loadSkills, createSyntheticSourceInfo, type Skill } from '@earendil-works/pi-coding-agent';
import { readdir, lstat, realpath, readFile } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { OperatorConfig } from '../config.js';
import type { SkillResource } from '../core/resources.js';
import { checkedTarget, within } from '../helpers/file-operations.js';
import { fail } from '../core/errors.js';

export async function skillCatalog(config: OperatorConfig, cwd: string) {
  const canonicalCwd = await realpath(cwd), workspaces = await Promise.all(config.workspace_roots.map(path => realpath(path)));
  const workspace = workspaces.filter(path => within(path, canonicalCwd)).sort((a,b) => b.length - a.length)[0];
  if (!workspace) fail('PATH_NOT_ALLOWED');
  const roots = [...config.skill_roots, ...(config.project_skills ? [{ id: 'project', path: join(workspace, '.agents', 'skills') }] : [])];
  if (new Set(roots.map(root => root.id)).size !== roots.length) fail('INVALID_ARGUMENT', 'Skill root IDs must be unique; project is reserved when project skills are enabled');
  const items: (SkillResource & { source_root: string; diagnostics: unknown[]; disabled: boolean })[] = [];
  let entries = 0;
  for (const root of roots) {
    let path: string;
    try { path = await realpath(root.path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const walk = async (directory: string): Promise<void> => {
      if (++entries > 10000) fail('LIMIT_EXCEEDED', 'Skill catalog exceeds discovery limit');
      const files = await readdir(directory, { withFileTypes: true });
      const skillFile = files.find(file => file.name === 'SKILL.md' && file.isFile());
      if (skillFile) {
        const file = await checkedTarget({ cwd: path, roots: [path], protectedPaths: [config.state_dir, config.pi.auth_path, ...(config.pi.models_path ? [config.pi.models_path] : [])] }, join(directory, skillFile.name), false);
        if ((await lstat(file)).size > 65536) fail('LIMIT_EXCEEDED');
        const loaded = loadSkills({ cwd: canonicalCwd, agentDir: config.state_dir, skillPaths: [file], includeDefaults: false });
        const skill = loaded.skills[0];
        if (skill) items.push({ id: `${root.id}:${relative(path, directory).split('\\').join('/') || '.'}`, name: skill.name, description: skill.description,
          path: file, baseDir: directory, hash: createHash('sha256').update(await readFile(file)).digest('hex'), source_root: root.id,
          diagnostics: loaded.diagnostics, disabled: skill.disableModelInvocation });
        return;
      }
      for (const file of files.sort((a,b) => a.name.localeCompare(b.name))) if (file.isDirectory() && !['.git','node_modules'].includes(file.name)) await walk(join(directory, file.name));
    };
    await walk(path);
  }
  return items.sort((a,b) => a.id.localeCompare(b.id));
}

export async function selectSkills(config: OperatorConfig, cwd: string, ids: string[]): Promise<SkillResource[]> {
  if (!ids.length) return [];
  const catalog = await skillCatalog(config, cwd), selected: SkillResource[] = [], names = new Set<string>();
  for (const id of ids) {
    const item = catalog.find(item => item.id === id);
    if (!item || item.disabled) fail('SKILL_NOT_FOUND');
    if (names.has(item.name)) fail('SKILL_NAME_COLLISION'); names.add(item.name);
    const { source_root: _root, diagnostics: _diagnostics, disabled: _disabled, ...resource } = item; selected.push(resource);
  }
  return selected;
}

export async function nativeSkills(resources: SkillResource[]): Promise<Skill[]> {
  return await Promise.all(resources.map(async resource => {
    if (createHash('sha256').update(await readFile(resource.path)).digest('hex') !== resource.hash) fail('RESOURCE_CHANGED');
    return { name: resource.name, description: resource.description, filePath: resource.path, baseDir: dirname(resource.path), disableModelInvocation: false,
      sourceInfo: createSyntheticSourceInfo(resource.path, { source: 'pi-spoke:' + resource.id, scope: 'temporary', baseDir: resource.baseDir }) };
  }));
}
