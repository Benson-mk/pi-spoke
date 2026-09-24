import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createApplication } from '../../src/app.js';
import { Api } from '../../src/api.js';
import { parseConfig } from '../../src/config.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { spawnSchema } from '../../src/contracts.js';
import { httpProvider } from '../fixtures/http-provider.js';

test('operator ceilings and context boundaries expose measured resources without accepting rejected work', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-limits-')), cwd = join(root, 'project');
  await mkdir(cwd);
  const provider = await httpProvider(() => ({ text: 'done' }));
  const models = join(root, 'models.json');
  await writeFile(models, JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: provider.url, apiKey: 'private-key',
    models: [{ id: 'model', input: ['text'], contextWindow: 100000, maxTokens: 1000 },
      { id: 'vision', input: ['text', 'image'], contextWindow: 100000, maxTokens: 1000 }] } } }));
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' },
    limits: { max_run_wall_time_ms: 1873, max_run_turns: 7 } });
  const app = await createApplication(config, join(root, 'config'), 'selected');
  try {
    const catalog = await new Api(app).catalog({ kind: 'models' });
    expect(catalog.resource_limits).toMatchObject({ run: { wall_time_ms: { maximum: 1873, unit: 'ms' }, max_turns: { maximum: 7, unit: 'turns' } },
      context: { single_file_bytes: { maximum: 65536 }, aggregate_bytes: { maximum: 65536 } }, output_page_bytes: { maximum: 16384 } });
    expect(JSON.stringify(catalog)).not.toContain('private-key');
    const input = { request_key: 'limit', task: 'test', cwd, model: { provider: 'fixture', id: 'model' }, tools: [], project_context: 'none' };
    for (const [field, allowed, units] of [['wall_time_ms', 1873, 'ms'], ['max_turns', 7, 'turns']] as const) {
      for (const value of [allowed - 1, allowed]) {
        const parsed = spawnSchema.parse({ ...input, limits: { [field]: value } });
        await expect(resolvePolicy(config, parsed, join(root, 'config'), process.cwd())).resolves.toMatchObject({ limits: { [field]: value } });
      }
      await expect(app.service.spawn({ ...input, request_key: `over-${field}`, limits: { [field]: allowed + 1 } })).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED', message: expect.stringContaining(`${allowed + 1} ${units}; allowed ${allowed} ${units}`),
      });
    }
    const a = join(cwd, 'a.txt'), b = join(cwd, 'b.txt');
    await writeFile(a, 'a'.repeat(65535));
    await writeFile(b, 'b'.repeat(2));
    await expect(app.service.spawn({ ...input, request_key: 'aggregate-over', context_files: [a, b] })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED', message: expect.stringContaining('Aggregate context measured 65537 bytes; allowed 65536 bytes'),
    });
    await writeFile(a, 'a'.repeat(65537));
    await expect(app.service.spawn({ ...input, request_key: 'single-over', context_files: [a] })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED', message: expect.stringContaining('Single context file measured 65537 bytes; allowed 65536 bytes'),
    });
    await expect(app.service.spawn({ ...input, request_key: 'wrong-type', context_files: [cwd] })).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
    const image = join(cwd, 'image.bin');
    await writeFile(image, 'unsupported-signature');
    await expect(app.service.spawn({ ...input, request_key: 'unsupported-image', model: { provider: 'fixture', id: 'vision' },
      attachments: [{ type: 'image', path: image }] })).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
    await writeFile(image, Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(app.service.spawn({ ...input, request_key: 'oversized-image', model: { provider: 'fixture', id: 'vision' },
      attachments: [{ type: 'image', path: image }] })).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT',
      message: expect.stringContaining('Image measured 10485761 bytes; allowed 10485760 bytes'),
    });
    expect(app.store.runs()).toHaveLength(0);
    expect(app.store.getCommand('aggregate-over')).toBeUndefined();
    expect(provider.requests).toHaveLength(0);
    await writeFile(a, 'a'.repeat(32767)); await writeFile(b, 'b'.repeat(32767));
    expect((await app.service.spawn({ ...input, request_key: 'below-context-boundary', context_files: [a, b] })).receipt).toBe('accepted');
    await app.service.drain();
    await writeFile(a, 'a'.repeat(65536));
    expect((await app.service.spawn({ ...input, request_key: 'at-single-boundary', context_files: [a] })).receipt).toBe('accepted');
    await app.service.drain();
    await writeFile(a, 'a'.repeat(32768)); await writeFile(b, 'b'.repeat(32768));
    // The exact aggregate boundary remains admissible and starts only deliberately requested work.
    const accepted = await app.service.spawn({ ...input, request_key: 'at-context-boundary', context_files: [a, b] });
    expect(accepted.receipt).toBe('accepted'); expect(app.store.runs()).toHaveLength(3);
    await app.service.drain();
  } finally { await app.close(); await provider.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('output pagination and malformed inputs report safe field-level ranges', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-page-input-')), cwd = join(root, 'project'); await mkdir(cwd);
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const app = await createApplication(config, join(root, 'config'), 'selected');
  try {
    const api = new Api(app);
    for (const max_bytes of [0, 16385, 'secret']) {
      await expect(api.observe({ run_id: 'unknown', view: 'output', max_bytes })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT', message: expect.stringContaining('max_bytes must be an integer from 1 to 16,384 bytes'),
      });
    }
    await expect(api.observe({ run_id: 'unknown', view: 'output', max_bytes: 16384 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('current MCP instance') });
    await expect(app.service.spawn({ request_key: 'malformed', task: { secret: 'private input' }, cwd })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT', message: expect.stringContaining('task: expected string'),
    });
    expect(app.store.runs()).toHaveLength(0);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
