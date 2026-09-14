import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { httpProvider } from '../fixtures/http-provider.js';

const execute = promisify(execFile);
test('live harness requires actual read results and continuation; shared provider remains partial', async () => {
  const root = await mkdtemp('/private/tmp/ps-live-test-');
  let performRead = true;
  const provider = await httpProvider(request => {
    const messages = JSON.stringify(request.messages);
    if (messages.includes('image_url')) return { text: 'A tiny image.' };
    const token = messages.match(/fixture-[a-f0-9-]{36}/)?.[0];
    if (token) return { text: token };
    return performRead ? { tool: { name: 'read', arguments: { path: 'canary.txt' } } } : { text: 'No read performed.' };
  });
  try {
    const cwd = join(root, 'project'); await mkdir(cwd);
    const models = join(root, 'models.json'), config = join(root, 'config.json'), selection = join(root, 'selection.json');
    await writeFile(models, JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: provider.url, apiKey: 'fake',
      models: [{ id: 'one', input: ['text', 'image'], reasoning: false, contextWindow: 32768, maxTokens: 1024 },
        { id: 'two', input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024 }] } } }));
    await writeFile(config, JSON.stringify({ version: 2, state_dir: join(root,'state'), scratch_dir: join(root,'scratch'), workspace_roots: [cwd],
      pi: { auth_path: join(root,'auth.json'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } }));
    await writeFile(selection, JSON.stringify({ models: [{ provider: 'fixture', id: 'one' }, { provider: 'fixture', id: 'two' }], vision: { provider: 'fixture', id: 'one' } }));
    for (const reads of [true, false]) {
      performRead = reads;
      const result = await execute(process.execPath, [resolve('scripts/live-gate.mjs')], {
        env: { ...process.env, PI_SPOKE_LIVE: '1', PI_SPOKE_LIVE_CONFIG: config, PI_SPOKE_LIVE_SELECTION: selection }, timeout: 60000,
      }).then(() => { throw Error('A shared provider must never pass release qualification'); }, error => error as { code: number; stdout: string });
      expect(result.code).toBe(1);
      const evidence = JSON.parse(result.stdout);
      expect(evidence.status).toBe(reads ? 'PARTIAL' : 'FAIL');
      expect(evidence.distinct_provider_configurations).toBe(false);
      expect(evidence.evidence).toHaveLength(reads ? 5 : 3);
      if (reads) expect(evidence.evidence.every((item: { output_verified: boolean }) => item.output_verified)).toBe(true);
      else expect(evidence.evidence[0].output_verified).toBe(false);
    }
  } finally { await provider.close(); await rm(root, { recursive: true, force: true }); }
}, 120000);
