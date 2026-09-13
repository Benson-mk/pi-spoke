#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApplication } from './app.js';
import { readConfig } from './config.js';
import { Api } from './api.js';
import { mcpServer } from './mcp/server.js';
import { doctor, sandboxCheck, refreshModels, recover, gc } from './operator.js';
import { SpokeError, fail } from './core/errors.js';

async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24 || Number(process.versions.node.split('.')[1]) < 15) fail('UNSUPPORTED_RUNTIME', 'Use qualified Node 24.15.0 or later Node 24');
  const { positionals, values } = parseArgs({ allowPositionals: true, strict: true, options: {
    config: { type: 'string' }, instance: { type: 'string' }, run: { type: 'string' }, 'older-than': { type: 'string' },
    'sandbox-check': { type: 'boolean' }, 'refresh-models': { type: 'boolean' }, 'acknowledge-cleanup': { type: 'boolean' },
    'dry-run': { type: 'boolean' }, delete: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log('pi-spoke <serve|doctor|recover|gc> --config /absolute/config.json --instance ID\nDoctor: --sandbox-check or --refresh-models\nRecover: --run ID --acknowledge-cleanup\nGC: --older-than DAYS --dry-run|--delete'); return; }
  if (positionals.length !== 1 || !['serve','doctor','recover','gc'].includes(positionals[0]!)) fail('INVALID_ARGUMENT', 'Choose serve, doctor, recover or gc');
  if (!values.config || !values.instance || !/^[a-zA-Z0-9_-]{1,64}$/.test(values.instance)) fail('INVALID_ARGUMENT', 'Absolute --config and valid --instance are required');
  const command = positionals[0]!, allowed: readonly string[] = { serve: [], doctor: ['sandbox-check','refresh-models'], recover: ['run','acknowledge-cleanup'], gc: ['older-than','dry-run','delete'] }[command]!;
  for (const key of Object.keys(values)) if (!['config','instance'].includes(key) && !allowed.includes(key)) fail('INVALID_ARGUMENT', 'Flag is not valid for this command');
  const config = await readConfig(values.config), root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (command === 'serve') {
    const app = await createApplication(config, values.config, values.instance), server = mcpServer(new Api(app));
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => { try { await app.close(); } finally { await server.close(); } })();
    server.onclose = () => { void close().catch(report); };
    process.once('SIGTERM', () => { void close().catch(report); }); process.once('SIGINT', () => { void close().catch(report); });
    await server.connect(new StdioServerTransport()); return;
  }
  let result: unknown;
  if (command === 'doctor') {
    if (values['sandbox-check'] && values['refresh-models']) fail('INVALID_ARGUMENT', 'Select one explicit doctor operation');
    result = { ...await doctor(config, values.instance), ...(values['sandbox-check'] ? { sandbox_check: await sandboxCheck(root) } : {}),
      ...(values['refresh-models'] ? { models: await refreshModels(config, values.instance) } : {}) };
  } else if (command === 'recover') {
    if (!values.run || !values['acknowledge-cleanup']) fail('INVALID_ARGUMENT', 'Recovery requires --run and explicit --acknowledge-cleanup');
    result = await recover(config, values.instance, values.run);
  } else {
    const days = Number(values['older-than']);
    if (!Number.isFinite(days) || days < 0 || !!values.delete === !!values['dry-run']) fail('INVALID_ARGUMENT', 'GC requires nonnegative --older-than and exactly one of --dry-run or --delete');
    result = await gc(config, values.instance, days, !!values.delete);
  }
  console.log(JSON.stringify(result, null, 2));
}
function report(error: unknown) {
  const safe = error instanceof SpokeError ? error : new SpokeError('INTERNAL_ERROR');
  console.error(JSON.stringify({ error: { code: safe.code, message: safe.message } })); process.exitCode = 1;
}
void main().catch(report);
