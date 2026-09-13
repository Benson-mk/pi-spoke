import { z } from 'zod';
const id = z.string().min(1).max(128);
const envelope = { version: z.literal(1), runId: id };
export const workerMessage = z.discriminatedUnion('kind', [
  z.strictObject({ ...envelope, kind: z.literal('ready'), piSession: z.strictObject({ id, path: z.string() }), effective: z.unknown() }),
  z.strictObject({ ...envelope, kind: z.literal('tool'), callId: id, tool: z.string().max(64), args: z.unknown() }),
  z.strictObject({ ...envelope, kind: z.literal('event'), event: z.string().max(64), payload: z.unknown() }),
  z.strictObject({ ...envelope, kind: z.literal('done'), outputPath: z.string(), checkpoint: z.strictObject({ path: z.string(), leaf: id, hash: z.string(), bytes: z.number().int().positive().optional(), safe: z.literal(true) }),
    metrics: z.strictObject({ input_tokens: z.number().nonnegative().nullable(), output_tokens: z.number().nonnegative().nullable(), cache_read_tokens: z.number().nonnegative().nullable(), cache_write_tokens: z.number().nonnegative().nullable(), estimated_cost_usd: z.number().nonnegative().nullable() }) }),
  z.strictObject({ ...envelope, kind: z.literal('error'), code: z.string().max(64), message: z.string().max(4096) }),
]);
export type WorkerMessage = z.infer<typeof workerMessage>;
export function validateWorkerMessage(value: unknown, runId: string): WorkerMessage {
  if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024) throw new Error('IPC payload exceeds 1 MiB');
  const message = workerMessage.parse(value); if (message.runId !== runId) throw new Error('IPC identity mismatch'); return message;
}
