import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test, expect, vi } from 'vitest';
import { httpProvider } from '../fixtures/http-provider.js';

test('P4: compiled stdio six-tool public contract, durable receipts, questions, continuation, output and strict errors', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-mcp-')), cwd = join(root, 'p'); await mkdir(cwd);
  const provider = await httpProvider((_request, index) => index === 0 ? { tool: { name: 'contact_main', arguments: { kind: 'question', message: 'Which option?' } } } : { text: '🙂bounded output' });
  const models = join(root, 'models.json'); await writeFile(models, JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: provider.url, apiKey: 'fake-secret-never-output',
    models: [{ id: 'model', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 4096 }] } } }));
  const config = join(root, 'config.json'); await writeFile(config, JSON.stringify({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } }));
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'),'serve','--config',config,'--instance','test'], stderr: 'pipe' });
  const client = new Client({ name: 'acceptance-fixture', version: '1.0.0' });
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name: 'spoke_' + name, arguments: args });
    expect(JSON.stringify(result)).not.toContain('fake-secret-never-output');
    return result as { isError?: boolean; structuredContent: Record<string, any> };
  };
  try {
    await client.connect(transport);
    const list = await client.listTools(); expect(list.tools.map(tool => tool.name).sort()).toEqual(['spoke_cancel','spoke_catalog','spoke_observe','spoke_send','spoke_sessions','spoke_spawn']);
    expect(list.tools.find(tool => tool.name === 'spoke_observe')?.annotations?.readOnlyHint).toBe(true);
    expect((await call('catalog', { kind: 'models', query: 'fixture' })).structuredContent.items[0]).toMatchObject({ provider: 'fixture', id: 'model', live_verified: false });
    const input = { request_key: 'spawn', task: 'ask then finish', cwd, tools: [], model: { provider: 'fixture', id: 'model' } };
    expect((await call('spawn', { ...input, unrestricted: true })).structuredContent.error.code).toBe('INVALID_ARGUMENT');
    const spawned = (await call('spawn', input)).structuredContent;
    expect(spawned).toMatchObject({ receipt: 'accepted', state: 'starting', effective_config: null });
    expect((await call('spawn', input)).structuredContent).toEqual(spawned);
    expect((await call('spawn', { ...input, task: 'different' })).structuredContent.error.code).toBe('IDEMPOTENCY_CONFLICT');
    let observed: Record<string, any> = {};
    await vi.waitFor(async () => { observed = (await call('observe', { run_id: spawned.run_id })).structuredContent; expect(observed.state).toBe('waiting_input'); }, { timeout: 5000 });
    const question = observed.questions[0].question_id;
    const calls = provider.requests.length; await call('observe', { run_id: spawned.run_id }); expect(provider.requests).toHaveLength(calls);
    expect((await call('send', { kind: 'steer', request_key: 'steer', run_id: spawned.run_id, message: 'text' })).structuredContent.error.code).toBe('QUESTION_REPLY_REQUIRED');
    const reply = { kind: 'reply', request_key: 'reply', run_id: spawned.run_id, question_id: question, message: 'option A' };
    const accepted = (await call('send', reply)).structuredContent; expect((await call('send', reply)).structuredContent).toEqual(accepted);
    await vi.waitFor(async () => expect((await call('observe', { run_id: spawned.run_id })).structuredContent.state).toBe('completed'));
    expect((await call('observe', { run_id: spawned.run_id, view: 'output', max_bytes: 1 })).structuredContent).toMatchObject({ text: '', next_offset_bytes: 0, minimum_next_bytes: 4 });
    expect((await call('observe', { run_id: spawned.run_id, view: 'output', max_bytes: 4 })).structuredContent.text).toBe('🙂');
    expect((await call('observe', { run_id: spawned.run_id, view: 'output', offset_bytes: 1 })).structuredContent.error.code).toBe('INVALID_ARGUMENT');
    const sessions = (await call('sessions', {})).structuredContent.items; expect(sessions[0]).toMatchObject({ session_id: spawned.session_id, continuation_eligible: true });
    const next = (await call('send', { kind: 'continue', request_key: 'next', session_id: spawned.session_id, expected_last_run_id: spawned.run_id, message: 'continue' })).structuredContent;
    await vi.waitFor(async () => expect((await call('observe', { run_id: next.run_id })).structuredContent.state).toBe('completed'));
    expect((await call('cancel', { run_id: next.run_id })).structuredContent.state).toBe('completed');
    const catalogPage = (await call('catalog', { kind: 'models', limit: 1 })).structuredContent;
    expect(catalogPage.next_cursor).toBeTypeOf('string');
    const catalogNext = (await call('catalog', { kind: 'models', limit: 1, cursor: catalogPage.next_cursor })).structuredContent;
    expect(catalogNext.items).not.toEqual(catalogPage.items);
    expect((await call('catalog', { kind: 'models', query: 'fixture', cursor: catalogPage.next_cursor })).structuredContent.error.code).toBe('INVALID_ARGUMENT');
  } finally { await client.close(); await provider.close(); await rm(root, { recursive: true, force: true }); }
}, 20000);
