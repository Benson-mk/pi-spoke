// Explicit isolated Linux VM fixture: root is required only to mount/unmount its own 16 MiB tmpfs.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {checkWritableTopology} from '../dist/security/topology.js';
import {Store} from '../dist/store/database.js';
import {Service} from '../dist/core/service.js';
import {parseConfig} from '../dist/config.js';
import {resolvePolicy} from '../dist/security/policy.js';
const root=await mkdtemp('/private/tmp/ps-volume-'),mount=join(root,'mount'),cwd=join(root,'project');let device,store,detached=false;const evidence={};
try{
  await mkdir(mount);await mkdir(cwd);await checkWritableTopology(root);
  execFileSync('/usr/bin/mount',['-t','tmpfs','-o','size=16m,nosuid,nodev','pi-spoke-disposable',mount],{timeout:15000});
  device=mount;
  const mounted=execFileSync('/usr/bin/findmnt',['-n','-o','FSTYPE','--target',mount],{encoding:'utf8'}).trim();
  if(mounted!=='tmpfs')throw Error('Disposable tmpfs identity not confirmed');
  try{await checkWritableTopology(root);throw Error('Mounted topology was incorrectly accepted');}catch(error){if(error.code!=='UNSAFE_PATH')throw error;evidence.mount_guard=error.code;}
  const config=parseConfig({version:2,state_dir:join(mount,'state'),scratch_dir:join(root,'scratch'),workspace_roots:[cwd],pi:{auth_path:join(root,'auth')},sandbox:{backend:'srt',required:true,tool_network:'none'}});
  store=new Store(config.state_dir);const original=store.writeArtifact.bind(store);let filesystemError;
  store.writeArtifact=(...args)=>{try{return original(...args);}catch(error){filesystemError=error.code;throw error;}};
  const runtime={setup:async()=>({piSession:{id:'fixture',path:join(mount,'checkpoint')},effective:{fixture:true}}),
    begin:async()=>({output:'x'.repeat(32*1024*1024),checkpoint:{path:join(mount,'checkpoint'),leaf:'fixture',hash:'fixture',safe:true},cleanup:'confirmed'}),send:async()=>{},cancel:async()=> 'confirmed'};
  const service=new Service(store,runtime,input=>resolvePolicy(config,input,join(root,'config'),resolve('.')));
  const receipt=await service.spawn({request_key:'disk-full',task:'disposable storage fault',cwd,tools:[],model:{provider:'fixture',id:'unused'}});
  await service.drain().catch(error=>{evidence.durability_error=error.code??error.message;});
  const run=store.getRun(receipt.run_id);if(filesystemError!=='ENOSPC'||run.state==='completed')throw Error('Disk-full gate did not produce the required durable failure');
  evidence.filesystem_error=filesystemError;evidence.run_state=run.state;evidence.reason=run.reason;evidence.receipt_retained=!!store.getCommand('disk-full');
  store.close();store=undefined;
}finally{
  let closeError;try{store?.close();}catch(error){closeError=error;}
  if(device){try{execFileSync('/usr/bin/umount',[device],{timeout:15000});detached=true;}catch(error){throw Error(`Cleanup unconfirmed: inspect ${device} mounted under ${root}; fixture retained`,{cause:error});}}
  await rm(root,{recursive:true,force:true});
  if(closeError)throw closeError;
}
const result={status:'PASS',scope:'actual disposable 16 MiB tmpfs mount; mounted-topology rejection and real ENOSPC artifact failure',...evidence,cleanup:detached?'detached and removed':'not mounted'};
console.log(JSON.stringify(result,null,2));if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');
