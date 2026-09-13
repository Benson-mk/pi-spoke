import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createSocket } from 'node:dgram';
import { randomUUID } from 'node:crypto';
import { test,expect } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { spawnSchema } from '../../src/contracts.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { Sandbox } from '../../src/sandbox/backend.js';

test('S25: direct DNS resolver cannot send a query to a controlled local UDP endpoint',async()=>{
  const root=await mkdtemp('/private/tmp/ps-dns-'),cwd=join(root,'p');await mkdir(cwd);const socket=createSocket('udp4');let packets=0;socket.on('message',()=>packets++);
  await new Promise<void>(resolve=>socket.bind(0,'127.0.0.1',resolve));const port=socket.address().port;
  const positive=new Promise<void>(resolve=>socket.once('message',()=>resolve()));
  const sender=createSocket('udp4');sender.send(Buffer.from('positive control'),port,'127.0.0.1');await positive;sender.close();expect(packets).toBe(1);packets=0;
  const config=parseConfig({version:2,state_dir:join(root,'s'),scratch_dir:join(root,'t'),workspace_roots:[cwd],allowed_tools:['bash'],pi:{auth_path:join(root,'auth')},sandbox:{backend:'srt',required:true,tool_network:'none'}});
  const policy=await resolvePolicy(config,spawnSchema.parse({request_key:'dns',task:'fixture',cwd,tools:['bash'],model:{provider:'fixture',id:'fixture'}}),join(root,'config'),resolve('.'));
  const sandbox=new Sandbox(config,resolve('.')),run='run_'+randomUUID(),scratch=await sandbox.createScratch(run),quote=(text:string)=>"'"+text.replaceAll("'","'\\''")+"'";
  try{
    const program=`const {Resolver}=require('node:dns');const r=new Resolver({timeout:250,tries:1});r.setServers(['127.0.0.1:${port}']);r.resolve4('fixture.invalid',(e,a)=>console.log(JSON.stringify({error:e?.code,addresses:a??[]})));`;
    const result=await sandbox.tool(run,policy,scratch,'bash',{command:`${quote(process.execPath)} -e ${quote(program)}`,timeout:3});
    expect(result.evidence.code).toBe(0);expect(JSON.parse(result.evidence.stdout).addresses).toEqual([]);expect(packets).toBe(0);
  }finally{socket.close();await sandbox.cancel(run);await rm(root,{recursive:true,force:true});}
},10000);
