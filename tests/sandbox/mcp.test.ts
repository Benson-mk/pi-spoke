import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test,expect,vi } from 'vitest';
import { httpProvider } from '../fixtures/http-provider.js';

test('P5 public MCP: guarded file execution and honest shell cancellation with a healthy sibling',async()=>{
  const root=await mkdtemp('/private/tmp/ps-mcp-os-'),cwd=join(root,'p');await mkdir(cwd);await writeFile(join(cwd,'source'),'canary');
  const provider=await httpProvider(request=>{
    const text=JSON.stringify(request.messages);
    if(!request.messages.some(message=>message.role==='tool')){
      if(text.includes('SHELL'))return {tool:{name:'bash',arguments:{command:'printf started > "$TMPDIR/started"; /bin/sleep 60'}}};
      if(text.includes('READ'))return {tool:{name:'read',arguments:{path:'source'}}};
    }return {text:'finished'};
  });
  const models=join(root,'models.json');await writeFile(models,JSON.stringify({providers:{fixture:{api:'openai-completions',baseUrl:provider.url,apiKey:'fake',models:[{id:'model',input:['text'],reasoning:false,contextWindow:128000,maxTokens:4096}]}}}));
  const config=join(root,'config.json');await writeFile(config,JSON.stringify({version:2,state_dir:join(root,'s'),scratch_dir:join(root,'t'),workspace_roots:[cwd],allowed_tools:['read','bash'],pi:{auth_path:join(root,'auth'),models_path:models},sandbox:{backend:'srt',required:true,tool_network:'none'}}));
  const client=new Client({name:'sandbox-contract',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[resolve('dist/cli.js'),'serve','--config',config,'--instance','test'],stderr:'pipe'});
  const call=async(name:string,args:Record<string,unknown>)=>{const result=await client.callTool({name:'spoke_'+name,arguments:args});expect(result.isError,JSON.stringify(result)).not.toBe(true);return result.structuredContent as Record<string,any>;};
  try{
    await client.connect(transport);const input={request_key:'read',task:'READ source',cwd,model:{provider:'fixture',id:'model'},tools:['read']};
    const first=await call('spawn',input);await vi.waitFor(async()=>expect((await call('observe',{run_id:first.run_id})).state).toBe('completed'),{timeout:10000});
    expect(await readFile(join(cwd,'source'),'utf8')).toBe('canary');
    const shell=await call('spawn',{...input,request_key:'shell',task:'SHELL fixture',tools:['bash']});
    await vi.waitFor(async()=>expect((await call('observe',{run_id:shell.run_id,view:'events'})).events.some((event:{type:string})=>event.type==='tool_started')).toBe(true),{timeout:10000});
    const shellState=await call('observe',{run_id:shell.run_id});
    await vi.waitFor(async()=>expect(await readFile(join(shellState.effective_config.shell_scratch_root,'started'),'utf8')).toBe('started'),{timeout:10000});
    const sibling=await call('spawn',{...input,request_key:'sibling',task:'healthy',tools:[]});
    expect(await call('cancel',{run_id:shell.run_id})).toMatchObject({state:'interrupted',cleanup_status:'unconfirmed'});
    await vi.waitFor(async()=>expect((await call('observe',{run_id:sibling.run_id})).state).toBe('completed'));
    expect(await call('cancel',{run_id:shell.run_id})).toMatchObject({state:'interrupted',cleanup_status:'unconfirmed'});
  }finally{await client.close();await provider.close();await rm(root,{recursive:true,force:true});}
},25000);
