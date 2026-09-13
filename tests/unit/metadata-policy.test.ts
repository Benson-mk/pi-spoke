import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test, expect } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { spawnSchema } from '../../src/contracts.js';
import { resolvePolicy } from '../../src/security/policy.js';

test('S13/S14/S16/S22: unsupported shell shapes reject; worktree metadata is parsed as inert data', async () => {
  const root = await mkdtemp('/private/tmp/ps-worktree-'), cwd = join(root,'p'), git = join(root,'git'), common = join(root,'common'), build = join(cwd,'build');
  await mkdir(build,{recursive:true}); await mkdir(git); await mkdir(common);
  await writeFile(join(cwd,'.git'),'gitdir: '+git+'\n'); await writeFile(join(git,'commondir'),'../common\n');
  await writeFile(join(git,'config'),'[core]\n hooksPath = /never/run/repository/commands\n');
  const config = parseConfig({version:2,state_dir:join(root,'state'),scratch_dir:join(root,'scratch'),workspace_roots:[cwd],allowed_tools:['write','bash'],
    permissions:{file_write_roots:[cwd],shell_write_roots:[cwd]},pi:{auth_path:join(root,'auth')},sandbox:{backend:'srt',required:true,tool_network:'none'}});
  const input = spawnSchema.parse({request_key:'meta',task:'fixture',cwd,tools:['write','bash'],permissions:{file_write_roots:[cwd]},model:{provider:'fixture',id:'fixture'}});
  try {
    const policy = await resolvePolicy(config,input,join(root,'config'),resolve('.'));
    expect(policy.protected_write_paths).toEqual(expect.arrayContaining([git,common,join(cwd,'.git')]));
    for (const path of [cwd,build]) await expect(resolvePolicy(config,{...input,permissions:{file_write_roots:[cwd],shell_write_roots:[path]}},join(root,'config'),resolve('.'))).rejects.toMatchObject({code:'SANDBOX_POLICY_UNSUPPORTED'});
    await expect(resolvePolicy(config,{...input,permissions:{file_write_roots:[cwd],shell_write_roots:[join(cwd,'missing')]}},join(root,'config'),resolve('.'))).rejects.toMatchObject({code:'UNSAFE_PATH'});
    expect(await readFile(join(cwd,'.git'),'utf8')).toBe('gitdir: '+git+'\n');
  } finally {await rm(root,{recursive:true,force:true});}
});
