import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test, expect, vi } from 'vitest';
import { httpProvider } from '../fixtures/http-provider.js';

test('A17/A18/S32: actual supervisor death aborts its worker, retains receipts, and allows only explicit safe-session continuation', async () => {
  const root = await mkdtemp('/private/tmp/ps-restart-'), cwd = join(root,'p'); await mkdir(cwd);
  const provider = await httpProvider(request => JSON.stringify(request.messages).includes('SLOW') ? {text:'pending',delay:15000} : {text:'saved context'});
  const models = join(root,'models.json'); await writeFile(models,JSON.stringify({providers:{fixture:{api:'openai-completions',baseUrl:provider.url,apiKey:'fake',models:[{id:'model',input:['text'],reasoning:false,contextWindow:128000,maxTokens:4096}]}}}));
  const config = join(root,'config.json'); await writeFile(config,JSON.stringify({version:2,state_dir:join(root,'s'),scratch_dir:join(root,'t'),workspace_roots:[cwd],pi:{auth_path:join(root,'auth'),models_path:models},sandbox:{backend:'srt',required:true,tool_network:'none'}}));
  let client: Client, transport: StdioClientTransport;
  const connect = async () => { transport=new StdioClientTransport({command:process.execPath,args:[resolve('dist/cli.js'),'serve','--config',config,'--instance','test'],stderr:'pipe'});client=new Client({name:'restart-fixture',version:'1'});await client.connect(transport); };
  const call = async (name:string,args:Record<string,unknown>) => {const result=await client.callTool({name:'spoke_'+name,arguments:args});expect(result.isError,JSON.stringify(result)).not.toBe(true);return result.structuredContent as Record<string,any>;};
  try {
    await connect(); const input={request_key:'safe',task:'remember ORIGINAL',cwd,tools:[],model:{provider:'fixture',id:'model'}};
    const safe=await call('spawn',input);await vi.waitFor(async()=>expect((await call('observe',{run_id:safe.run_id})).state).toBe('completed'));
    const slowInput={...input,request_key:'slow',task:'SLOW'};const slow=await call('spawn',slowInput);
    await vi.waitFor(()=>expect(provider.requests).toHaveLength(2));
    const status=await call('observe',{run_id:slow.run_id});const worker=status.effective_config.worker_pid;
    expect(worker).toBeGreaterThan(1);expect(transport!.pid).toBeGreaterThan(1);process.kill(transport!.pid!,'SIGKILL');await client!.close();
    await vi.waitFor(()=>expect(()=>process.kill(worker,0)).toThrow(),{timeout:10000});
    await connect();
    expect((await call('observe',{run_id:slow.run_id}))).toMatchObject({state:'interrupted',cleanup_status:'unconfirmed'});
    expect(await call('spawn',slowInput)).toEqual(slow);expect(provider.requests).toHaveLength(2);
    const next=await call('send',{kind:'continue',request_key:'after-restart',session_id:safe.session_id,expected_last_run_id:safe.run_id,message:'use the saved context'});
    await vi.waitFor(async()=>expect((await call('observe',{run_id:next.run_id})).state).toBe('completed'));
    expect(JSON.stringify(provider.requests[2])).toContain('ORIGINAL');expect(provider.requests).toHaveLength(3);
  } finally {await client!?.close();await provider.close();await rm(root,{recursive:true,force:true});}
},20000);
