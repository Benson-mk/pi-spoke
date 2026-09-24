import { readFile } from 'node:fs/promises';
import { expect, test, vi } from 'vitest';
import { observationRuntime } from '../fixtures/observation-runtime.js';

test('confirmed edit remains after provider error; terminal stage, no replay, checkpoint and reopen stay honest', async () => {
  const f = await observationRuntime((_request, index) => index === 0
    ? { tool: { name: 'edit', arguments: { path: 'source', edits: [{ oldText: 'before', newText: 'after' }] } } } : { status: 400 });
  try {
    const request = { request_key: 'edit-error', task: 'edit before report', cwd: f.cwd, model: { provider: 'fixture', id: 'model' },
      tools: ['edit'], permissions: { file_write_roots: [f.cwd] } };
    const receipt = await f.service.spawn(request); await f.service.drain();
    expect(await f.api.observe({ run_id: receipt.run_id, view: 'summary' })).toMatchObject({ state: 'failed', cleanup_status: 'confirmed', terminal: {
      failure_stage: 'provider', error_category: 'PROVIDER_ERROR', provider_stop_reason: 'error', final_text_empty: null },
      tool_outcomes: { successful: 1, failed: 0, unsettled: 0 } });
    expect(await readFile(`${f.cwd}/source`, 'utf8')).toBe('after');
    expect(f.provider.requests).toHaveLength(2);
    expect(await f.service.spawn(request)).toEqual(receipt);
    await expect(f.service.send({ kind: 'continue', request_key: 'resume', session_id: receipt.session_id,
      expected_last_run_id: receipt.run_id, message: 'continue' })).rejects.toMatchObject({ code: 'SESSION_NOT_RESUMABLE' });
    const reopened = f.reopen();
    try { expect(reopened.getRun(receipt.run_id)?.terminal?.provider_stop_reason).toBe('error');
      expect(reopened.invocations(receipt.run_id)).toHaveLength(1); }
    finally { reopened.close(); }
  } finally { await f.dispose(); }
}, 45000);

test('provider HTTP 503 after a successful edit yields bounded durable gateway diagnosis without body or retry', async () => {
  const secret = 'sk-syntheticsecret123456';
  const body = `gateway maintenance; bearer ${secret}; private request=${'x'.repeat(4000)}`;
  const f = await observationRuntime((_request, index) => index === 0
    ? { tool: { name: 'edit', arguments: { path: 'source', edits: [{ oldText: 'before', newText: 'after' }] } } }
    : { status: 503, errorBody: body });
  try {
    const request = { request_key: 'edit-503', task: 'edit before report', cwd: f.cwd, model: { provider: 'fixture', id: 'model' },
      tools: ['edit'], permissions: { file_write_roots: [f.cwd] } };
    const receipt = await f.service.spawn(request); await f.service.drain();
    const observed = await f.api.observe({ run_id: receipt.run_id, view: 'summary' });
    expect(observed).toMatchObject({ state: 'failed', cleanup_status: 'confirmed', terminal: {
      failure_stage: 'provider', error_category: 'PROVIDER_ERROR', diagnostic: 'Provider HTTP 503 (service unavailable).',
      diagnostic_truncated: false }, tool_outcomes: { successful: 1, failed: 0, unsettled: 0 } });
    expect(JSON.stringify(observed)).not.toContain(secret);
    expect(JSON.stringify(observed)).not.toContain('private request=');
    expect(Buffer.byteLength(JSON.stringify(observed))).toBeLessThan(16384);
    expect(await readFile(`${f.cwd}/source`, 'utf8')).toBe('after');
    expect(f.provider.requests).toHaveLength(2);
    expect(await f.service.spawn(request)).toEqual(receipt);
    expect(f.provider.requests).toHaveLength(2);
    await expect(f.service.send({ kind: 'continue', request_key: 'resume-503', session_id: receipt.session_id,
      expected_last_run_id: receipt.run_id, message: 'continue' })).rejects.toMatchObject({ code: 'SESSION_NOT_RESUMABLE' });
    const reopened = f.reopen();
    try { expect(reopened.getRun(receipt.run_id)?.terminal?.diagnostic).toBe('Provider HTTP 503 (service unavailable).'); }
    finally { reopened.close(); }
  } finally { await f.dispose(); }
}, 45000);

test('a body mentioning 503 cannot turn a different HTTP status into service-unavailable diagnosis', async () => {
  const f = await observationRuntime(() => ({ status: 400, errorBody: '503 appears in this untrusted body' }));
  try {
    const receipt = await f.service.spawn({ request_key: 'body-503', task: 'answer', cwd: f.cwd,
      model: { provider: 'fixture', id: 'model' }, tools: [] });
    await f.service.drain();
    const observed = await f.api.observe({ run_id: receipt.run_id, view: 'summary' });
    expect(observed).toMatchObject({ state: 'failed', terminal: { error_category: 'PROVIDER_ERROR', diagnostic: 'Provider HTTP 400.' } });
    expect(JSON.stringify(observed)).not.toContain('untrusted body');
    expect(f.provider.requests).toHaveLength(1);
  } finally { await f.dispose(); }
}, 45000);

test('provider output limit is recorded without inferring from token count', async () => {
  const f = await observationRuntime(() => ({ text: '', finishReason: 'length' }));
  try {
    const receipt = await f.service.spawn({ request_key: 'length', task: 'answer', cwd: f.cwd,
      model: { provider: 'fixture', id: 'model' }, tools: [] });
    await f.service.drain();
    expect(await f.api.observe({ run_id: receipt.run_id, view: 'summary' })).toMatchObject({ state: 'failed',
      terminal: { provider_stop_reason: 'length', final_text_empty: null }, tool_outcomes: { successful: 0, failed: 0, unsettled: 0 } });
  } finally { await f.dispose(); }
}, 45000);

test('actual worker SIGKILL reports signal separately from provider and finalization', async () => {
  const f = await observationRuntime(() => ({ text: 'never delivered', delay: 10000 }));
  try {
    const receipt = await f.service.spawn({ request_key: 'worker-exit', task: 'wait', cwd: f.cwd,
      model: { provider: 'fixture', id: 'model' }, tools: [] });
    await vi.waitFor(() => expect(f.store.getRun(receipt.run_id)?.state).toBe('running'));
    const started = f.store.events(receipt.run_id).find(event => event.type === 'worker_started')!;
    process.kill((started.payload as { pid: number }).pid, 'SIGKILL'); await f.service.drain();
    expect(await f.api.observe({ run_id: receipt.run_id, view: 'summary' })).toMatchObject({ state: 'failed',
      terminal: { failure_stage: 'worker', error_category: 'WORKER_EXITED', worker_exit_code: null, worker_exit_signal: 'SIGKILL' } });
    expect(f.store.getSession(receipt.session_id)?.checkpoint).toBeNull();
  } finally { await f.dispose(); }
}, 45000);
