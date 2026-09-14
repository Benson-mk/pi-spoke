import { mkdtemp,mkdir,writeFile,readFile,appendFile,cp,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';
import { test,expect } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { spawnSchema } from '../../src/contracts.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { Sandbox } from '../../src/sandbox/backend.js';
import { installedQualification,assertQualification } from '../../src/sandbox/qualification.js';

test('S35: a changed real compiler copy invalidates its proof before a launcher starts',async()=>{
  const root=await mkdtemp('/private/tmp/ps-upgrade-'),cwd=join(root,'p'),install=join(root,'install'),pkg=join(install,'node_modules/@anthropic-ai/sandbox-runtime'),marker=join(root,'must-not-launch');
  await mkdir(cwd);await mkdir(pkg,{recursive:true});await cp(resolve('node_modules/@anthropic-ai/sandbox-runtime/dist'),join(pkg,'dist'),{recursive:true});
  await cp(resolve('node_modules/@anthropic-ai/sandbox-runtime/package.json'),join(pkg,'package.json'));await cp(resolve('package-lock.json'),join(install,'package-lock.json'));
  if(platform()==='linux'){await cp(resolve('node_modules/@anthropic-ai/sandbox-runtime/vendor'),join(pkg,'vendor'),{recursive:true});await cp(resolve('dist/sandbox/native'),join(install,'dist/sandbox/native'),{recursive:true});}
  await mkdir(join(install,'dist/sandbox'),{recursive:true});await writeFile(join(install,'dist/sandbox/p0-launcher.js'),`require('node:fs').writeFileSync(${JSON.stringify(marker)},'unsafe launch')`);
  const config=parseConfig({version:2,state_dir:join(root,'s'),scratch_dir:join(root,'t'),workspace_roots:[cwd],allowed_tools:['read'],pi:{auth_path:join(root,'auth')},sandbox:{backend:'srt',required:true,tool_network:'none'}});
  const policy=await resolvePolicy(config,spawnSchema.parse({request_key:'upgrade',task:'fixture',cwd,tools:['read'],model:{provider:'fixture',id:'fixture'}}),join(root,'config'),install);
  const sandbox=new Sandbox(config,install),run='run_'+randomUUID(),scratch=await sandbox.createScratch(run);
  try{
    assertQualification(await installedQualification(install));
    await appendFile(join(pkg,'dist/index.js'),'\n// disposable changed compiler\n');
    await expect(sandbox.tool(run,policy,scratch,'read',{path:'file'})).rejects.toMatchObject({code:'SANDBOX_UNAVAILABLE'});
    await expect(readFile(marker)).rejects.toThrow();
    if(platform()==='linux'){
      await cp(resolve('node_modules/@anthropic-ai/sandbox-runtime/dist/index.js'),join(pkg,'dist/index.js'));
      await appendFile(join(install,'dist/sandbox/native/deny-network'),'changed-filter');
      await expect(sandbox.tool(run,policy,scratch,'read',{path:'file'})).rejects.toMatchObject({code:'SANDBOX_UNAVAILABLE'});
      await expect(readFile(marker)).rejects.toThrow();
    }
  }finally{await sandbox.cancel(run);await rm(root,{recursive:true,force:true});}
},15000);
