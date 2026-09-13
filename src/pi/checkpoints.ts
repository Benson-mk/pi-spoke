import { readFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { Checkpoint } from '../core/types.js';

export function validateBranch(manager: SessionManager, leaf: string): void {
  if (!manager.getEntry(leaf)) throw new Error('SESSION_NOT_RESUMABLE');
  const pending = new Set<string>();
  for (const entry of manager.getBranch(leaf)) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (message.role === 'assistant') for (const part of message.content) if (part.type === 'toolCall') {
      if (pending.has(part.id)) throw new Error('SESSION_NOT_RESUMABLE'); pending.add(part.id);
    }
    if (message.role === 'toolResult') {
      if (!pending.delete(message.toolCallId)) throw new Error('SESSION_NOT_RESUMABLE');
    }
  }
  if (pending.size) throw new Error('SESSION_NOT_RESUMABLE');
}
export async function checkpoint(manager: SessionManager): Promise<Checkpoint> {
  const path = manager.getSessionFile(), leaf = manager.getLeafId(); if (!path || !leaf) throw new Error('SESSION_NOT_RESUMABLE');
  validateBranch(manager, leaf);
  const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); }
  const bytes = await readFile(path);
  return { path, leaf, hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, safe: true };
}
export async function reopenCheckpoint(saved: Checkpoint): Promise<SessionManager> {
  // Pi's permissive file parser is preceded by explicit JSON/identity validation.
  const bytes = await readFile(saved.path), ids = new Set<string>();
  const original = saved.bytes === undefined ? bytes : bytes.subarray(0, saved.bytes);
  if (createHash('sha256').update(original).digest('hex') !== saved.hash) throw new Error('SESSION_NOT_RESUMABLE');
  const text = bytes.toString('utf8');
  for (const [index, line] of text.trimEnd().split('\n').entries()) {
    let value; try { value = JSON.parse(line); } catch { throw new Error('SESSION_NOT_RESUMABLE'); }
    if (index === 0) { if (value.type !== 'session' || value.version !== 3) throw new Error('SESSION_NOT_RESUMABLE'); }
    else { if (typeof value.id !== 'string' || ids.has(value.id) || (value.parentId !== null && !ids.has(value.parentId))) throw new Error('SESSION_NOT_RESUMABLE'); ids.add(value.id); }
  }
  const manager = SessionManager.open(saved.path); validateBranch(manager, saved.leaf);
  if (manager.getLeafId() !== saved.leaf) manager.branch(saved.leaf);
  return manager;
}
