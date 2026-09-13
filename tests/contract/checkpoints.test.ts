import { mkdtemp, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { checkpoint, reopenCheckpoint } from '../../src/pi/checkpoints.js';

test('P2: native checkpoint rejects missing tool results and corruption, and branches from a confirmed prefix', async () => {
  const root = await mkdtemp('/private/tmp/ps-checkpoint-');
  try {
    const manager = SessionManager.create(root, join(root, 'sessions'));
    manager.appendMessage({ role: 'user', content: 'task', timestamp: Date.now() });
    const assistant: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'fixture', model: 'fixture', timestamp: Date.now(),
      content: [{ type: 'text', text: 'confirmed' }], stopReason: 'stop',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    manager.appendMessage(assistant);
    const saved = await checkpoint(manager), original = await readFile(saved.path);
    manager.appendMessage({ ...assistant, content: [{ type: 'toolCall', id: 'uncertain-write', name: 'write', arguments: { path: 'file', content: 'data' } }], stopReason: 'toolUse' });
    await expect(checkpoint(manager)).rejects.toThrow('SESSION_NOT_RESUMABLE');
    const reopened = await reopenCheckpoint(saved);
    expect(reopened.getLeafId()).toBe(saved.leaf);
    expect(reopened.getBranch().some(entry => entry.type === 'message' && JSON.stringify(entry.message).includes('uncertain-write'))).toBe(false);
    await appendFile(saved.path, '{partial');
    await expect(reopenCheckpoint(saved)).rejects.toThrow('SESSION_NOT_RESUMABLE');
    const corrupt = Buffer.from(original); corrupt[0] = 32; await writeFile(saved.path, corrupt);
    await expect(reopenCheckpoint(saved)).rejects.toThrow('SESSION_NOT_RESUMABLE');
  } finally { await rm(root, { recursive: true, force: true }); }
});
