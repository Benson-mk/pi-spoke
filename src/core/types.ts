import type { SpawnInput, SendInput } from '../contracts.js';
import type { ResolvedPolicy } from '../security/policy.js';

export type RunState = 'starting' | 'running' | 'waiting_input' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type CleanupStatus = 'pending' | 'confirmed' | 'unconfirmed' | 'operator_attested';
export const terminalStates: RunState[] = ['completed', 'failed', 'cancelled', 'interrupted'];
export type Checkpoint = { path: string; leaf: string; hash: string; safe: true };
export type Receipt = { protocol_version: 1; session_id: string; run_id: string; state: RunState; receipt: 'accepted'; effective_config: null };
export type Session = { id: string; input: SpawnInput; policy: ResolvedPolicy; created: number; updated: number;
  lastRunId: string; checkpoint: Checkpoint | null; piSession: { id: string; path: string } | null };
export type Run = { id: string; sessionId: string; state: RunState; input: SpawnInput | SendInput; created: number; updated: number;
  effective: unknown | null; reason: string | null; cleanup: CleanupStatus; outputPath: string | null };
export type Command = { key: string; operation: string; hash: string; receipt: Receipt;
  delivery: 'accepted' | 'dispatched' | 'delivered' | 'uncertain' | 'undelivered' };
export type Event = { seq: number; runId: string; type: string; payload: unknown; created: number; source: string };
export type Question = { id: string; runId: string; toolCallId: string; message: string; state: 'open' | 'answered' | 'closed'; answer: string | null };
export type Invocation = { id: string; runId: string; toolCallId: string; kind: string; policyHash: string;
  state: 'accepted' | 'launched' | 'completed' | 'uncertain'; evidence: unknown; cleanup: CleanupStatus };
