import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { modelRef, toolName } from './contracts.js';
import { fail } from './core/errors.js';

const absolute = z.string().refine(path => isAbsolute(path) && !/[\x00*?\[\]]/.test(path), 'Path must be absolute and literal');
const paths = z.array(absolute);
export const configSchema = z.strictObject({
  version: z.literal(2), state_dir: absolute, scratch_dir: absolute, workspace_roots: paths.min(1),
  allowed_tools: z.array(toolName).default(['read', 'grep', 'find', 'ls']),
  permissions: z.strictObject({ file_write_roots: paths.default([]), shell_write_roots: paths.default([]) }).default({ file_write_roots: [], shell_write_roots: [] }),
  sandbox: z.strictObject({ backend: z.literal('srt'), required: z.literal(true), tool_network: z.literal('none'),
    additional_read_deny_paths: paths.default([]), additional_write_deny_paths: paths.default([]), additional_toolchain_read_paths: paths.default([]) }),
  skill_roots: z.array(z.strictObject({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/), path: absolute })).default([]),
  project_skills: z.boolean().default(false),
  pi: z.strictObject({ auth_path: absolute, models_path: absolute.optional() }),
  allowed_models: z.array(modelRef.extend({
    description: z.string().trim().min(1).max(512).regex(/^[^\r\n]*$/, 'Use a single-line description').optional(),
  })).optional(),
  limits: z.strictObject({
    max_active_runs: z.number().int().min(1).max(64).default(3),
    max_run_wall_time_ms: z.number().int().positive().default(1800000), max_run_turns: z.number().int().positive().default(64),
    max_shell_command_seconds: z.number().int().positive().default(120), max_sandbox_startup_seconds: z.number().int().positive().max(15).default(15),
  }).prefault({}),
});
export type OperatorConfig = z.infer<typeof configSchema>;
export function parseConfig(value: unknown): OperatorConfig {
  if (value && typeof value === 'object' && 'version' in value && value.version === 1) fail('INVALID_ARGUMENT', 'Configuration version 1 requires explicit migration to independent write grants in version 2.');
  const result = configSchema.safeParse(value);
  if (!result.success) fail('INVALID_ARGUMENT', 'Invalid operator configuration: ' + result.error.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join('; '));
  return result.data;
}
export async function readConfig(path: string): Promise<OperatorConfig> {
  if (!isAbsolute(path)) fail('INVALID_ARGUMENT', 'Configuration path must be absolute');
  return parseConfig(JSON.parse(await readFile(path, 'utf8')));
}
