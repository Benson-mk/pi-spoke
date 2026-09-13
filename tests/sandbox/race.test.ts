import { mkdtemp,mkdir,writeFile,readFile,realpath,rename,symlink,unlink,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test,expect } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { spawnSchema } from '../../src/contracts.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { Sandbox } from '../../src/sandbox/backend.js';

test('S21/S27: ancestor swaps cannot mutate an outside canary; missing qualified runtime fails closed',async()=>{
  const root=await realpath(await mkdtemp('/private/tmp/ps-race-')),cwd=join(root,'p'),target=join(cwd,'target'),parked=join(cwd,'parked'),outside=join(root,'outside');
  await mkdir(target,{recursive:true});await mkdir(outside);await writeFile(join(outside,'file'),'outside-canary');
  const config=parseConfig({version:2,state_dir:join(root,'s'),scratch_dir:join(root,'t'),workspace_roots:[cwd],allowed_tools:['write'],permissions:{file_write_roots:[cwd]},pi:{auth_path:join(root,'auth')},sandbox:{backend:'srt',required:true,tool_network:'none'}});
  const input=spawnSchema.parse({request_key:'race',task:'fixture',cwd,tools:['write'],permissions:{file_write_roots:[cwd]},model:{provider:'fixture',id:'fixture'}});
  const policy=await resolvePolicy(config,input,join(root,'config'),resolve('.')),sandbox=new Sandbox(config,resolve('.')),run='run_'+randomUUID(),scratch=await sandbox.createScratch(run);
  let stop=false;
  const swapping=(async()=>{while(!stop){await rename(target,parked);await symlink(outside,target);await new Promise(resolve=>setTimeout(resolve,2));await unlink(target);await rename(parked,target);await new Promise(resolve=>setTimeout(resolve,2));}})();
  try{
    for(let i=0;i<4;i++)await sandbox.tool(run,policy,scratch,'write',{path:'target/file',content:'in-scope write'});
    expect(await readFile(join(outside,'file'),'utf8')).toBe('outside-canary');
    const missing=new Sandbox(config,root);await expect(missing.tool('run_'+randomUUID(),policy,scratch,'write',{path:'file',content:'bad'})).rejects.toMatchObject({code:'SANDBOX_UNAVAILABLE'});
  }finally{stop=true;await swapping;await sandbox.cancel(run);await rm(root,{recursive:true,force:true});}
},20000);
