if (process.env.PI_SPOKE_LIVE !== '1') {
  console.error('BLOCKED: live inference requires explicit PI_SPOKE_LIVE=1, PI_SPOKE_LIVE_CONFIG and PI_SPOKE_LIVE_SELECTION.');
  process.exit(1);
}
const { readFile, writeFile, mkdtemp, mkdir, rm } = await import('node:fs/promises');
const { resolve, join, isAbsolute } = await import('node:path');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
const { z } = await import('zod');
const { readConfig } = await import('../dist/config.js');
const { modelRef } = await import('../dist/contracts.js');
const selectionSchema = z.strictObject({ models: z.array(modelRef).length(2), vision: modelRef });
let root, client;
try {
  const configPath = process.env.PI_SPOKE_LIVE_CONFIG, selectionPath = process.env.PI_SPOKE_LIVE_SELECTION;
  if (!configPath || !selectionPath || !isAbsolute(configPath) || !isAbsolute(selectionPath)) throw Error('Absolute live configuration and selection paths are required');
  const config = await readConfig(configPath), selected = selectionSchema.parse(JSON.parse(await readFile(selectionPath,'utf8')));
  const distinctProviders = new Set(selected.models.map(model => model.provider)).size === 2;
  root = await mkdtemp('/private/tmp/ps-live-'); const cwd = join(root,'project'); await mkdir(cwd);
  const isolated = { ...config, state_dir: join(root,'state'), scratch_dir: join(root,'scratch'), workspace_roots: [cwd], allowed_tools: ['read'],
    permissions: { file_write_roots: [], shell_write_roots: [] }, skill_roots: [], project_skills: false,
    limits: { ...config.limits, max_active_runs: 1, max_run_wall_time_ms: Math.min(config.limits.max_run_wall_time_ms, 120000), max_run_turns: 4 } };
  const path = join(root,'config.json'); await writeFile(path,JSON.stringify(isolated),{mode:0o600});
  const image = join(cwd,'pixel.png'); await writeFile(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'),'serve','--config',path,'--instance','live'], stderr:'pipe' });
  client = new Client({ name:'pi-spoke-opt-in-live',version:'0.1.0' }); await client.connect(transport);
  const call = async (name,args) => {
    const result = await client.callTool({name:'spoke_'+name,arguments:args});
    if (result.isError) throw Error(result.structuredContent?.error?.code ?? 'MCP_ERROR'); return result.structuredContent;
  };
  const evidence = [];
  const token = 'fixture-' + (await import('node:crypto')).randomUUID();
  await writeFile(join(cwd,'canary.txt'), token);
  const observe = async (receipt) => {
    let observed, after_seq=0; const events=[];
    do { observed=await call('observe',{run_id:receipt.run_id,after_seq,wait_ms:1000});
      events.push(...observed.events); after_seq=observed.next_after_seq;
    } while (!['completed','failed','cancelled','interrupted'].includes(observed.state));
    while(observed.events_truncated) {
      observed=await call('observe',{run_id:receipt.run_id,view:'events',after_seq});
      events.push(...observed.events);after_seq=observed.next_after_seq;
    }
    const output=await call('observe',{run_id:receipt.run_id,view:'output',offset_bytes:0,max_bytes:16384});
    return {observed,events,text:output.text};
  };
  for (const [index, model] of [...selected.models,selected.vision].entries()) {
    const started = Date.now();
    const receipt = await call('spawn',{request_key:'live-'+index,
      task:index===2?'Describe the attached tiny image in one short sentence.':
        'Use the read tool to read canary.txt. Reply with its exact contents and remember it for the next turn.',
      cwd,model,tools:index===2?[]:['read'],project_context:'none',
      attachments:index===2?[{type:'image',path:image}]:[]});
    const result=await observe(receipt);
    const toolExecuted=result.events.some(event=>event.type==='tool_ended');
    const passed=result.observed.state==='completed' && result.observed.cleanup_status==='confirmed' &&
      (index===2 ? Boolean(result.text?.trim()) : toolExecuted && result.text.includes(token));
    evidence.push({model,vision:index===2,state:result.observed.state,cleanup:result.observed.cleanup_status,
      reason:result.observed.reason,tool_executed:toolExecuted,output_verified:passed,elapsed_ms:Date.now()-started});
    if(!passed) continue;
    if(index!==2) {
      const next=await call('send',{kind:'continue',request_key:'continue-'+index,session_id:receipt.session_id,
        expected_last_run_id:receipt.run_id,message:'Without calling tools, repeat the exact file contents you read in the previous turn.'});
      const continuation=await observe(next);
      evidence.push({model,continuation:true,state:continuation.observed.state,cleanup:continuation.observed.cleanup_status,
        output_verified:continuation.observed.state==='completed' && continuation.observed.cleanup_status==='confirmed' && continuation.text.includes(token)});
    }
  }
  const checksPassed=evidence.length===5 && evidence.every(item=>item.output_verified);
  console.log(JSON.stringify({status:checksPassed && distinctProviders?'PASS':checksPassed?'PARTIAL':'FAIL',
    scope:'explicit live models, sandboxed read, native continuation, and vision input',
    distinct_provider_configurations:distinctProviders,
    caveat:'Configured aliases do not certify distinct upstream integrations or gateway routing. Vision completion confirms image acceptance, not perception quality.',evidence},null,2));
  if(!checksPassed || !distinctProviders) process.exitCode=1;
} catch (error) {
  console.error(JSON.stringify({status:'FAIL_OR_BLOCKED',message:error instanceof Error?error.message:'Live test failed'}));process.exitCode=1;
} finally { await client?.close();if(root)await rm(root,{recursive:true,force:true}); }
