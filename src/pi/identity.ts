import type { AgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { fail } from '../core/errors.js';

export function requireModel(runtime: ModelRuntime, requested: { provider: string; id: string }): NonNullable<ReturnType<ModelRuntime['getModel']>> {
  const model = runtime.getModel(requested.provider, requested.id);
  if (!model) fail('MODEL_UNAVAILABLE');
  return model;
}

/** Called after setup and before any prompt is authorized. */
export function confirmIdentity(session: AgentSession, requested: { provider: string; id: string }, thinking?: string) {
  if (session.model?.provider !== requested.provider || session.model.id !== requested.id) {
    fail('MODEL_CONFIGURATION_MISMATCH');
  }
  if (thinking !== undefined && session.thinkingLevel !== thinking) fail('UNSUPPORTED_THINKING');
  return { model: requested, thinking: session.thinkingLevel };
}
