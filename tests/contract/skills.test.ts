import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { skillCatalog, selectSkills, nativeSkills } from '../../src/pi/skills.js';

test('P3: public Pi skill metadata, stable IDs, optional selection, disabled skills and name collisions', async () => {
  const root = await mkdtemp('/private/tmp/ps-skills-'), workspace = join(root, 'project'), skills = join(root, 'skills');
  await mkdir(workspace);
  try {
    for (const [folder, name, disabled] of [['first','same',false],['second','same',false],['hidden','hidden',true]] as const) {
      await mkdir(join(skills, folder), { recursive: true });
      await writeFile(join(skills, folder, 'SKILL.md'), `---\nname: ${name}\ndescription: Optional ${folder}\ndisable-model-invocation: ${disabled}\n---\nBODY_${folder}\n`);
    }
    const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [workspace],
      skill_roots: [{ id: 'approved', path: skills }], pi: { auth_path: join(root, 'auth') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
    expect(await selectSkills(config, workspace, [])).toEqual([]);
    const catalog = await skillCatalog(config, workspace);
    expect(catalog.map(item => item.id)).toEqual(['approved:first','approved:hidden','approved:second']);
    expect(JSON.stringify(catalog)).not.toContain('BODY_');
    await expect(selectSkills(config, workspace, ['approved:hidden'])).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
    await expect(selectSkills(config, workspace, ['approved:first','approved:second'])).rejects.toMatchObject({ code: 'SKILL_NAME_COLLISION' });
    const selected = await selectSkills(config, workspace, ['approved:first']);
    expect((await nativeSkills(selected))[0]?.name).toBe('same');
    await writeFile(join(skills, 'first', 'SKILL.md'), 'changed');
    await expect(nativeSkills(selected)).rejects.toMatchObject({ code: 'RESOURCE_CHANGED' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
