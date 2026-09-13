// Local fake-provider measurement only; never uses operator credentials.
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform,arch,release } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { httpProvider } from '../tests/fixtures/http-provider.ts';
const execute=promisify(execFile), root=await mkdtemp('/private/tmp/ps-bench-'), cwd=join(root,'p');await mkdir(cwd);await writeFile(join(cwd,'source'),'canary');
const provider=await httpProvider(request=>{
  const text=JSON.stringify(request.messages);
  if(text.includes('DELAY'))return {text:'cancelled fixture',delay:15000};
  if(text.includes('READ')&&!request.messages.some(message=>message.role==='tool'))return {tool:{name:'read',arguments:{path:'source'}}};
  return {text:text.includes('LARGE')?'🙂'.repeat(10000):'done'};
});
const modelPath=join(root,'models.json');await writeFile(modelPath,JSON.stringify({providers:{fixture:{api:'openai-completions',baseUrl:provider.url,apiKey:'fake',models:[{id:'model',input:['text'],reasoning:false,contextWindow:128000,maxTokens:65536}]}}}));
const config=join(root,'config.json');await writeFile(config,JSON.stringify({version:2,state_dir:join(root,'s'),scratch_dir:join(root,'t'),workspace_roots:[cwd],pi:{auth_path:join(root,'auth'),models_path:modelPath},sandbox:{backend:'srt',required:true,tool_network:'none'}}));
const transport=new StdioClientTransport({command:process.execPath,args:[resolve('dist/cli.js'),'serve','--config',config,'--instance','bench'],stderr:'pipe'});
const client=new Client({name:'measurement',version:'1'});const started=performance.now();let peakSupervisorRssKiB=0;const runs=[];
const call=async(name,args)=>{const r=await client.callTool({name:'spoke_'+name,arguments:args});if(r.isError)throw Error(JSON.stringify(r.structuredContent));return r.structuredContent;};
const memory=async()=>{const {stdout}=await execute('/bin/ps',['-o','rss=','-p',String(transport.pid)]);peakSupervisorRssKiB=Math.max(peakSupervisorRssKiB,Number(stdout.trim())||0);};
const run=async(task,key,tools=[])=>{
  const begin=performance.now();const receipt=await call('spawn',{request_key:key,task,cwd,model:{provider:'fixture',id:'model'},tools});let cursor=0,status;const events=[];
  do {status=await call('observe',{run_id:receipt.run_id,after_seq:cursor,wait_ms:100});events.push(...status.events);cursor=status.next_after_seq;await memory();}
  while(!['completed','failed','cancelled','interrupted'].includes(status.state));
  while(status.events_truncated){status=await call('observe',{run_id:receipt.run_id,view:'events',after_seq:cursor});events.push(...status.events);cursor=status.next_after_seq;}
  if(status.state!=='completed')throw Error('Benchmark run failed: '+JSON.stringify(status));
  const accepted=events.find(e=>e.type==='accepted'),ready=events.find(e=>e.type==='running'),start=events.find(e=>e.type==='tool_started'),end=events.find(e=>e.type==='tool_ended');
  const result={task,elapsed_ms:Math.round(performance.now()-begin),readiness_ms:ready&&accepted?ready.created_at-accepted.created_at:null,tool_ms:end&&start?end.created_at-start.created_at:null};runs.push(result);return receipt;
};
try{
  await client.connect(transport);const mcp_startup_ms=Math.round(performance.now()-started);await memory();
  await run('plain','plain');await run('READ source','read-cold',['read']);await run('READ source','read-repeat',['read']);
  const concurrentStart=performance.now();await Promise.all([0,1,2].map(i=>run('concurrent '+i,'parallel-'+i)));const three_concurrent_ms=Math.round(performance.now()-concurrentStart);
  const large=await run('LARGE output','large');let offset=0,bytes=0,pages=0;const outputStart=performance.now();
  for(;;){const value=await call('observe',{run_id:large.run_id,view:'output',offset_bytes:offset,max_bytes:16384});bytes+=Buffer.byteLength(value.text);pages++;offset=value.next_offset_bytes;if(!value.truncated)break;}
  const output_ms=Math.round(performance.now()-outputStart);
  const slow=await call('spawn',{request_key:'cancel',task:'DELAY',cwd,model:{provider:'fixture',id:'model'},tools:[]});
  let state;do{state=await call('observe',{run_id:slow.run_id,wait_ms:100,after_seq:state?.next_after_seq??0});}while(state.state==='starting');
  const cancelStart=performance.now();const cancelled=await call('cancel',{run_id:slow.run_id});const cancellation_ms=Math.round(performance.now()-cancelStart);
  const evidence={timestamp:new Date().toISOString(),platform:platform(),architecture:arch(),os:release(),node:process.version,provider:'local HTTP fake; no live inference',mcp_startup_ms,runs,three_concurrent_ms,
    peak_sampled_supervisor_rss_kib:peakSupervisorRssKiB,output:{bytes,pages,elapsed_ms:output_ms},cancellation:{elapsed_ms:cancellation_ms,state:cancelled.state},preflight_cache:'none; repeated run rechecks binary/compiler hashes and real canaries',limitations:['single local sample set','RSS is sampled supervisor only, not aggregate process-tree peak','fake provider latency is not live model latency']};
  const text=JSON.stringify(evidence,null,2);console.log(text);if(process.argv[2])await writeFile(process.argv[2],text+'\n');
}finally{await client.close();await provider.close();await rm(root,{recursive:true,force:true});}
