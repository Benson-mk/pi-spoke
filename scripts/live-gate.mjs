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
  if (new Set(selected.models.map(model => model.provider)).size !== 2) throw Error('Select two distinct provider integrations');
  root = await mkdtemp('/private/tmp/ps-live-'); const cwd = join(root,'project'); await mkdir(cwd);
  const isolated = { ...config, state_dir: join(root,'state'), scratch_dir: join(root,'scratch'), workspace_roots: [cwd], allowed_tools: [],
    permissions: { file_write_roots: [], shell_write_roots: [] }, skill_roots: [], project_skills: false,
    limits: { ...config.limits, max_active_runs: 1, max_run_wall_time_ms: Math.min(config.limits.max_run_wall_time_ms, 120000), max_run_turns: 2 } };
  const path = join(root,'config.json'); await writeFile(path,JSON.stringify(isolated),{mode:0o600});
  const image = join(cwd,'pixel.png'); await writeFile(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'),'serve','--config',path,'--instance','live'], stderr:'pipe' });
  client = new Client({ name:'pi-spoke-opt-in-live',version:'0.1.0' }); await client.connect(transport);
  const call = async (name,args) => {
    const result = await client.callTool({name:'spoke_'+name,arguments:args});
    if (result.isError) throw Error(result.structuredContent?.error?.code ?? 'MCP_ERROR'); return result.structuredContent;
  };
  const evidence = [];
  for (const [index, model] of [...selected.models,selected.vision].entries()) {
    const started = Date.now();
    const receipt = await call('spawn',{request_key:'live-'+index,task:index===2?'Describe the attached tiny image in one short sentence.':'Reply with one short sentence confirming this explicit model request.',cwd,model,tools:[],project_context:'none',
      attachments:index===2?[{type:'image',path:image}]:[]});
    let observed, after_seq=0;
    do { observed=await call('observe',{run_id:receipt.run_id,after_seq,wait_ms:1000});after_seq=observed.next_after_seq; }
    while (!['completed','failed','cancelled','interrupted'].includes(observed.state));
    evidence.push({model,vision:index===2,state:observed.state,cleanup:observed.cleanup_status,elapsed_ms:Date.now()-started});
    if (observed.state!=='completed') throw Error('Live gate failed: '+JSON.stringify(evidence));
  }
  console.log(JSON.stringify({status:'PASS',scope:'two live integrations and one vision input; no tool execution',evidence},null,2));
} catch (error) {
  console.error(JSON.stringify({status:'FAIL_OR_BLOCKED',message:error instanceof Error?error.message:'Live test failed'}));process.exitCode=1;
} finally { await client?.close();if(root)await rm(root,{recursive:true,force:true}); }
