import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { Store } from '../../src/store/database.js';
import { Service, type Runtime } from '../../src/core/service.js';
import { Api } from '../../src/api.js';
import { parseConfig } from '../../src/config.js';
import { resolvePolicy } from '../../src/security/policy.js';
import type { Checkpoint } from '../../src/core/types.js';

const checkpoint: Checkpoint = { safe: true, path: '/fixture/checkpoint', leaf: 'leaf', hash: 'hash' };
async function fixture() {
  const root = await realpath(await mkdtemp('/private/tmp/ps-finalization-'));
  const cwd = join(root, 'project'); await mkdir(cwd);
  const config = parseConfig({ version: 2, state_dir: join(root, 'state'), scratch_dir: join(root, 'scratch'), workspace_roots: [cwd],
    pi: { auth_path: join(root, 'auth.json') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const store = new Store(config.state_dir);
  let settle!: (result: Awaited<ReturnType<Runtime['begin']>>) => void;
  const runtime: Runtime = {
    async setup() { return { piSession: { id: 'fixture', path: checkpoint.path }, effective: {} }; },
    begin() { return new Promise(resolve => { settle = resolve; }); },
    async send() {}, async cancel() { settle?.({ output: '', checkpoint, cleanup: 'confirmed' }); return 'confirmed'; },
  };
  const service = new Service(store, runtime, input => resolvePolicy(config, input, join(root, 'config.json'), resolve('.')));
  const api = new Api({ service, store, instanceId: 'fixture' } as ConstructorParameters<typeof Api>[0]);
  const request = { request_key: 'one', task: 'report', cwd, model: { provider: 'fixture', id: 'fixture' }, tools: [] };
  return { root, store, service, api, request, finish: (output = '') => settle({ output, checkpoint, cleanup: 'confirmed' }),
    async dispose() { for (const run of store.runs()) if (['starting','running','waiting_input','stopping'].includes(run.state)) await service.cancel(run.id);
      await service.drain().catch(() => {}); store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('empty final text is visible even when durable output finalization fails', async () => {
  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request);
    await vi.waitFor(() => expect(f.store.getRun(receipt.run_id)?.state).toBe('running'));
    vi.spyOn(f.store, 'writeArtifact').mockImplementationOnce(() => { throw new Error('disk full'); });
    f.finish(''); await f.service.drain();
    expect(await f.api.observe({ run_id: receipt.run_id })).toMatchObject({ state: 'failed',
      terminal: { failure_stage: 'finalization', error_category: 'STATE_WRITE_FAILED', final_text_empty: true } });
    expect(f.store.getSession(receipt.session_id)?.checkpoint).toBeNull();
  } finally { await f.dispose(); }
});

test('zero-tool empty completion persists checkpoint and reports no invented provider reason', async () => {
  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request);
    await vi.waitFor(() => expect(f.store.getRun(receipt.run_id)?.state).toBe('running'));
    f.finish(''); await f.service.drain();
    expect(await f.api.observe({ run_id: receipt.run_id })).toMatchObject({ state: 'completed', cleanup_status: 'confirmed',
      terminal: { final_text_empty: true, provider_stop_reason: null, failure_stage: null },
      tool_outcomes: { successful: 0, failed: 0, unsettled: 0 } });
    expect(f.store.getSession(receipt.session_id)?.checkpoint?.safe).toBe(true);
  } finally { await f.dispose(); }
});

test('redacted diagnostic keeps structured stage and category under worst-case response expansion', async () => {
  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request);
    await vi.waitFor(() => expect(f.store.getRun(receipt.run_id)?.state).toBe('running'));
    const secret = 'sk-syntheticsecret123456';
    f.service.failure(receipt.run_id, 'provider', 'PROVIDER_ERROR', `Bearer ${secret} ${'\u0000'.repeat(3000)}${'🌍'.repeat(1000)}`);
    f.service.recordEvent(receipt.run_id, 'note', { message: `${secret}${'\u0000'.repeat(6000)}` });
    const result = await f.api.observe({ run_id: receipt.run_id });
    expect(result).toMatchObject({ terminal: { failure_stage: 'provider', error_category: 'PROVIDER_ERROR', diagnostic_truncated: true } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(16384);
  } finally { await f.dispose(); }
});
test('control-rich output preview stays within response envelope with a valid pagination offset', async () => {

  const f = await fixture();
  try {
    const receipt = await f.service.spawn(f.request);
    await vi.waitFor(() => expect(f.store.getRun(receipt.run_id)?.state).toBe('running'));
    f.finish('\u0000'.repeat(16000)); await f.service.drain();
    const summary = await f.api.observe({ run_id: receipt.run_id }) as { output_truncated: boolean; output_preview: string; next_offset_bytes: number };
    expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(16384);
    expect(summary.output_truncated).toBe(true);
    expect(summary.next_offset_bytes).toBe(Buffer.byteLength(summary.output_preview));
    const page = await f.api.observe({ run_id: receipt.run_id, view: 'output', offset_bytes: summary.next_offset_bytes }) as { text: string };
    expect(page.text).toContain('\u0000');
  } finally { await f.dispose(); }
});
