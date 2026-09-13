import type { RunState } from './types.js';
import { fail } from './errors.js';

const transitions: Record<RunState, RunState[]> = {
  starting: ['running', 'stopping', 'failed', 'interrupted'],
  running: ['waiting_input', 'stopping', 'completed', 'failed', 'interrupted'],
  waiting_input: ['running', 'stopping', 'failed', 'interrupted'],
  stopping: ['cancelled', 'interrupted'],
  completed: [], failed: [], cancelled: [], interrupted: [],
};
export function assertTransition(from: RunState, to: RunState): void {
  if (!transitions[from].includes(to)) fail('INTERNAL_ERROR', `Invalid run transition ${from} -> ${to}`);
}
