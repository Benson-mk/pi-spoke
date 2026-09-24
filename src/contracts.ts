import { z } from 'zod';

const text = z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= 65536, 'Text exceeds 64 KiB');
const id = z.string().min(1).max(128);
export const toolName = z.enum(['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash']);
export const modelRef = z.strictObject({ provider: id, id });
const roots = z.array(z.string().min(1)).transform(values => [...new Set(values)].sort());
const skills = z.array(id).transform(values => [...new Set(values)].sort());
const limits = z.strictObject({ wall_time_ms: z.number().int().positive().optional(), max_turns: z.number().int().positive().optional() });
const attachments = z.array(z.strictObject({ type: z.literal('image'), path: z.string().min(1) })).max(4);
export const spawnSchema = z.strictObject({
  request_key: id, task: text, cwd: z.string().min(1), model: modelRef, thinking: id.optional(),
  tools: z.array(toolName).transform(values => [...new Set(values)].sort()).prefault(['read', 'grep', 'find', 'ls']),
  permissions: z.strictObject({ file_write_roots: roots.default([]), shell_write_roots: roots.default([]) })
    .default({ file_write_roots: [], shell_write_roots: [] }),
  suggested_skills: skills.default([]), project_context: z.enum(['agents', 'none']).default('agents'),
  context_files: roots.default([]), attachments: attachments.default([]), limits: limits.default({}),
});
export const sendSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('steer'), request_key: id, run_id: id, message: text }),
  z.strictObject({ kind: z.literal('reply'), request_key: id, run_id: id, question_id: id, message: text }),
  z.strictObject({ kind: z.literal('continue'), request_key: id, session_id: id, expected_last_run_id: id, message: text,
    suggested_skills: skills.optional(), attachments: attachments.default([]), limits: limits.default({}) }),
]);
export const observeSchema = z.union([
  z.strictObject({ run_id: id, view: z.enum(['summary', 'events']).default('summary'), after_seq: z.number().int().nonnegative().default(0),
    wait_ms: z.number().int().min(0).max(25000).default(0), limit: z.number().int().min(1).max(100).default(50) }),
  z.strictObject({ run_id: id, view: z.literal('output'), offset_bytes: z.number().int().nonnegative().default(0),
    max_bytes: z.number().int().min(1).max(16384).default(16384) }),
  z.strictObject({ run_id: id, view: z.literal('question'), question_id: id, offset_bytes: z.number().int().nonnegative().default(0),
    max_bytes: z.number().int().min(1).max(8192).default(8192) }),
]);
export const catalogSchema = z.strictObject({ kind: z.enum(['models', 'skills', 'tools']), cwd: z.string().optional(), query: z.string().max(1024).optional(),
  cursor: id.optional(), limit: z.number().int().min(1).max(100).default(25) });
export const cancelSchema = z.strictObject({ run_id: id, reason: text.optional() });
export const sessionsSchema = z.strictObject({ cwd: z.string().optional(), cursor: id.optional(), limit: z.number().int().min(1).max(100).default(25) });
export type SpawnInput = z.infer<typeof spawnSchema>;
export type SendInput = z.infer<typeof sendSchema>;
export type ToolName = z.infer<typeof toolName>;
