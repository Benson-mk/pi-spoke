import { readFile } from 'node:fs/promises';
import { expect, test, vi } from 'vitest';
import { observationRuntime } from '../fixtures/observation-runtime.js';

test('wall timeout after an edit preserves the effect and leaves no safe checkpoint', async () => {
  const f = await observationRuntime((_request, index) => index === 0
    ? { tool: { name: 'edit', arguments: { path: 'source', edits: [{ oldText: 'before', newText: 'after' }] } } }
    : { text: 'too late', delay: 30000 });
  try {
    const receipt = await f.service.spawn({ request_key: 'timeout', task: 'edit then report', cwd: f.cwd,
      model: { provider: 'fixture', id: 'model' }, tools: ['edit'], permissions: { file_write_roots: [f.cwd] },
      limits: { wall_time_ms: 12000 } });
    await vi.waitFor(async () => expect(await readFile(`${f.cwd}/source`, 'utf8')).toBe('after'), { timeout: 10000 });
    await f.service.drain();
    expect(await f.api.observe({ run_id: receipt.run_id, view: 'summary' })).toMatchObject({ state: 'cancelled', reason: 'WALL_TIME_LIMIT',
      tool_outcomes: { successful: 1, failed: 0, unsettled: 0 } });
    expect(await readFile(`${f.cwd}/source`, 'utf8')).toBe('after');
    expect(f.store.getSession(receipt.session_id)?.checkpoint).toBeNull();
  } finally { await f.dispose(); }
}, 45000);

test('two helper calls in one model turn use one turn; zero-tool generation uses one', async () => {
  const f = await observationRuntime((_request, index) => index === 0
    ? { tools: [{ name: 'read', arguments: { path: 'source' } }, { name: 'read', arguments: { path: 'source' } }] }
    : { text: 'complete' });
  try {
    const multi = await f.service.spawn({ request_key: 'two-tools', task: 'read twice', cwd: f.cwd,
      model: { provider: 'fixture', id: 'model' }, tools: ['read'], limits: { max_turns: 3 } });
    await f.service.drain();
    expect(await f.api.observe({ run_id: multi.run_id, view: 'summary' })).toMatchObject({ state: 'completed',
      tool_count: 2, budget: { turns_used: 2, turns_remaining: 1 }, tool_outcomes: { successful: 2 } });
    const plain = await f.service.spawn({ request_key: 'plain', task: 'reply directly', cwd: f.cwd,
      model: { provider: 'fixture', id: 'model' }, tools: [] });
    await f.service.drain();
    expect(await f.api.observe({ run_id: plain.run_id, view: 'summary' })).toMatchObject({ state: 'completed',
      terminal: { provider_stop_reason: 'stop', final_text_empty: false }, tool_count: 0, budget: { turns_used: 1 } });
  } finally { await f.dispose(); }
}, 45000);
