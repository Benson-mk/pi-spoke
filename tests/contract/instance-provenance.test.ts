import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createApplication } from '../../src/app.js';
import { Api } from '../../src/api.js';
import { parseConfig } from '../../src/config.js';
import { httpProvider } from '../fixtures/http-provider.js';

test('handles belong to an opaque, persistent instance even when configured aliases match', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-owners-')), cwd = join(root, 'project'); await mkdir(cwd);
  const provider = await httpProvider(() => ({ text: 'done' }));
  const models = join(root, 'models.json');
  await writeFile(models, JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: provider.url, apiKey: 'private-secret',
    models: [{ id: 'model', input: ['text'], contextWindow: 128000, maxTokens: 4096 }] } } }));
  const makeConfig = (name: string) => parseConfig({ version: 2, state_dir: join(root, name), scratch_dir: join(root, `${name}-scratch`), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const aConfig = makeConfig('first'), bConfig = makeConfig('second');
  let a = await createApplication(aConfig, join(root, 'config-a'), 'same-alias');
  const b = await createApplication(bConfig, join(root, 'config-b'), 'same-alias');
  try {
    const aApi = new Api(a), bApi = new Api(b);
    expect(a.instanceId).toMatch(/^inst_/); expect(b.instanceId).toMatch(/^inst_/); expect(a.instanceId).not.toBe(b.instanceId);
    expect((await aApi.catalog({ kind: 'models' })).instance_id).toBe(a.instanceId);
    expect((await bApi.catalog({ kind: 'models' })).instance_id).toBe(b.instanceId);
    expect(provider.requests).toHaveLength(0);
    const input = { request_key: 'run', task: 'fixture', cwd, tools: [], model: { provider: 'fixture', id: 'model' } };
    const receipt = await aApi.spawn(input); await a.service.drain();
    expect(receipt.instance_id).toBe(a.instanceId);
    expect((await aApi.observe({ run_id: receipt.run_id })).instance_id).toBe(a.instanceId);
    expect((await aApi.sessions({})).items[0]).toMatchObject({ instance_id: a.instanceId, session_id: receipt.session_id });
    expect((await bApi.sessions({})).items).toEqual([]);
    await expect(bApi.observe({ run_id: receipt.run_id })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT',
      message: expect.stringContaining(`current MCP instance ${b.instanceId}`) });
    await expect(bApi.send({ kind: 'continue', request_key: 'foreign', session_id: receipt.session_id, expected_last_run_id: receipt.run_id, message: 'continue' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT', message: expect.stringContaining('another connection'),
    });
    expect(b.store.runs()).toEqual([]); expect(b.store.getCommand('foreign')).toBeUndefined();
    const legacy = a.store.getCommand('run')!;
    const { instance_id: _old, ...oldReceipt } = legacy.receipt;
    a.store.putCommand({ ...legacy, receipt: oldReceipt as typeof receipt });
    await a.close();
    a = await createApplication(aConfig, join(root, 'config-a'), 'same-alias');
    const reopened = new Api(a);
    expect(a.instanceId).toBe(receipt.instance_id);
    expect((await reopened.sessions({})).items[0]).toMatchObject({ instance_id: receipt.instance_id, session_id: receipt.session_id });
    expect((await reopened.observe({ run_id: receipt.run_id })).instance_id).toBe(receipt.instance_id);
    expect(await a.service.spawn(input)).toEqual(receipt); // saved duplicate receipt has actual owning provenance
    const exposed = JSON.stringify({ catalog: await reopened.catalog({ kind: 'models' }), sessions: await reopened.sessions({}) });
    expect(exposed).not.toContain(join(root, 'first')); expect(exposed).not.toContain(join(root, 'second'));
    expect(exposed).not.toContain('private-secret');
    expect(provider.requests).toHaveLength(1);
  } finally { await a.close(); await b.close(); await provider.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
