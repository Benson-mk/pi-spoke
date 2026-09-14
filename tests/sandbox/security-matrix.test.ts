import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink, link } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { spawnSchema } from '../../src/contracts.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { Sandbox } from '../../src/sandbox/backend.js';

test('P5 S05–S10/S15–S19/S22/S24: production helper and shell containment against disposable metadata, aliases, environment and source canaries', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-matrix-')), cwd = join(root, 'p'), other = join(root, 'other'); await mkdir(cwd); await mkdir(other);
  const source = join(cwd, 'source'), outside = join(other, 'source'); await writeFile(source, 'source'); await writeFile(outside, 'outside');
  const metadata = ['.git','.codex','.agents','.pi','.pi-spoke'];
  for (const name of metadata) { await mkdir(join(cwd, name)); await writeFile(join(cwd, name, 'canary'), name); }
  await writeFile(join(cwd, 'AGENTS.md'), 'instructions');
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd,other], allowed_tools: ['read','write','bash'],
    permissions: { file_write_roots: [cwd] }, pi: { auth_path: join(root, 'auth') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const input = spawnSchema.parse({ request_key: 'matrix', task: 'fixture', cwd, tools: ['read','write','bash'], permissions: { file_write_roots: [cwd] }, model: { provider: 'fixture', id: 'fixture' } });
  const policy = await resolvePolicy(config, input, join(root, 'config.json'), resolve('.')), sandbox = new Sandbox(config, resolve('.')), run = 'run_' + randomUUID();
  const scratch = await sandbox.createScratch(run), quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
  const saved = Object.fromEntries(['OPENAI_API_KEY','SSH_AUTH_SOCK','NODE_OPTIONS','BASH_ENV','HTTPS_PROXY'].map(key => [key, process.env[key]]));
  for (const key of Object.keys(saved)) process.env[key] = 'fixture-secret-never-inherit';
  try {
    const results = await sandbox.tool(run, policy, scratch, 'bash', { command: `${quote(process.execPath)} -e ${quote(`const fs=require('node:fs');const result={};for(const [name,fn] of Object.entries({
      unlink:()=>fs.unlinkSync(${JSON.stringify(source)}),overwrite:()=>fs.writeFileSync(${JSON.stringify(source)},'bad'),
      rename:()=>{const t=${JSON.stringify(join(scratch,'replacement'))};fs.writeFileSync(t,'bad');fs.renameSync(t,${JSON.stringify(source)})},
      rmdir:()=>fs.rmdirSync(${JSON.stringify(join(cwd,'.codex'))}),outside:()=>fs.writeFileSync(${JSON.stringify(outside)},'bad')
    })){try{fn();result[name]='ALLOWED'}catch(e){result[name]=e.code}}console.log(JSON.stringify({result,env:process.env,ipc:!!process.send}));`)}` });
    const inspected = JSON.parse(results.evidence.stdout);
    expect(Object.values(inspected.result).every(code => ['EPERM','EACCES','EROFS','ENOENT','EISDIR','EXDEV'].includes(String(code))), JSON.stringify(inspected.result)).toBe(true);
    expect(inspected.ipc).toBe(false); expect(JSON.stringify(inspected.env)).not.toContain('fixture-secret-never-inherit');
    expect(inspected.env.HOME).toBe(join(scratch, 'home'));
    for (const command of [`rm ${quote(source)}`, `/bin/rm ${quote(source)}`, `printf bad > ${quote(source)}`]) {
      const result = await sandbox.tool(run, policy, scratch, 'bash', { command }); expect(result.evidence.code).not.toBe(0);
    }
    for (const path of [...metadata.map(name => join(name,'canary')), 'AGENTS.md','deep/normal/.agents/skills/new/SKILL.md','../other/source']) {
      const denied = await sandbox.tool(run, policy, scratch, 'write', { path, content: 'bad' });
      expect(denied.result).toMatchObject({ isError: true });
    }
    await symlink(other, join(cwd, 'alias'));
    expect((await sandbox.tool(run, policy, scratch, 'write', { path: 'alias/source', content: 'bad' })).result).toMatchObject({ isError: true });
    expect((await sandbox.tool(run, policy, scratch, 'read', { path: 'alias/source' })).result).toMatchObject({ isError: true });
    await link(outside, join(cwd, 'hardlink'));
    expect((await sandbox.tool(run, policy, scratch, 'write', { path: 'hardlink', content: 'bad' })).result).toMatchObject({ isError: true });
    await sandbox.tool(run, policy, scratch, 'write', { path: '日本語.txt', content: 'allowed' });
    await sandbox.tool(run, policy, scratch, 'write', { path: '日本語.txt', content: '' });
    expect(await readFile(join(cwd,'日本語.txt'),'utf8')).toBe('');
    expect(await readFile(source,'utf8')).toBe('source'); expect(await readFile(outside,'utf8')).toBe('outside');
    for (const name of metadata) expect(await readFile(join(cwd,name,'canary'),'utf8')).toBe(name);
    console.log(JSON.stringify({ cases: 'S05-S10,S15-S19,S22,S24', policy_hash: policy.policy_hash,
      source_before_after_sha256: createHash('sha256').update('source').digest('hex'), outside_before_after_sha256: createHash('sha256').update('outside').digest('hex'), cleanup: 'unconfirmed for arbitrary shell' }));
  } finally {
    for (const [key,value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await sandbox.cancel(run); await rm(root, { recursive: true, force: true });
  }
}, 45000);
