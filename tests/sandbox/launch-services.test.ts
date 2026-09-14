import { mkdtemp,mkdir,writeFile,readFile,unlink,rm,realpath } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';
import { test,expect } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { spawnSchema } from '../../src/contracts.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { Sandbox } from '../../src/sandbox/backend.js';
const execute=promisify(execFile);

test.skipIf(platform() !== 'darwin')('S26: Launch Services cannot start a disposable background app outside the tool sandbox',async()=>{
  const root=await realpath(await mkdtemp('/private/tmp/ps-launch-')),cwd=join(root,'p'),bundle=join(root,'Canary.app'),binary=join(bundle,'Contents/MacOS/canary'),marker=join(root,'launched');
  await mkdir(cwd);await mkdir(join(bundle,'Contents/MacOS'),{recursive:true});
  await writeFile(join(bundle,'Contents/Info.plist'),`<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>canary</string><key>CFBundleIdentifier</key><string>local.pi-spoke.fixture.${randomUUID()}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/></dict></plist>`);
  const source=join(root,'canary.c');await writeFile(source,`#include <stdio.h>\nint main(){FILE*f=fopen(${JSON.stringify(marker)},"w");if(!f)return 2;fputs("started",f);fclose(f);return 0;}\n`);
  await execute('/usr/bin/clang',[source,'-o',binary]);
  const config=parseConfig({version:2,state_dir:join(root,'s'),scratch_dir:join(root,'t'),workspace_roots:[cwd],allowed_tools:['bash'],pi:{auth_path:join(root,'auth')},sandbox:{backend:'srt',required:true,tool_network:'none'}});
  const policy=await resolvePolicy(config,spawnSchema.parse({request_key:'launch',task:'fixture',cwd,tools:['bash'],model:{provider:'fixture',id:'fixture'}}),join(root,'config'),resolve('.'));
  const sandbox=new Sandbox(config,resolve('.')),run='run_'+randomUUID(),scratch=await sandbox.createScratch(run);
  try{
    // Positive control starts only this finite, non-UI fixture, never a host application.
    await execute('/usr/bin/open',['-W','-n',bundle],{timeout:5000});expect(await readFile(marker,'utf8')).toBe('started');await unlink(marker);
    const quote=(text:string)=>"'"+text.replaceAll("'","'\\''")+"'";
    const result=await sandbox.tool(run,policy,scratch,'bash',{command:`/usr/bin/open -W -n ${quote(bundle)}`,timeout:5});
    expect(result.evidence.code).not.toBe(0);await expect(readFile(marker)).rejects.toThrow();
  }finally{await sandbox.cancel(run);await rm(root,{recursive:true,force:true});}
},20000);
