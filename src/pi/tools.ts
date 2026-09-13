import { createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition, createBashToolDefinition,
  createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { ToolName } from '../contracts.js';

export function guardedTools(cwd: string, names: ToolName[], invoke: (id: string, name: string, args: unknown) => Promise<unknown>): ToolDefinition[] {
  const definitions = { read: createReadToolDefinition, edit: createEditToolDefinition, write: createWriteToolDefinition,
    bash: createBashToolDefinition, grep: createGrepToolDefinition, find: createFindToolDefinition, ls: createLsToolDefinition };
  return [...names.map(name => ({ ...definitions[name](cwd), ...(name === 'read' ? { description: 'Read bounded UTF-8 text through the sandbox. Images must be supplied as explicit main-agent attachments; binary files are rejected.' } : {}), execute: (id: string, args: unknown) => invoke(id, name, args) }) as unknown as ToolDefinition),
    { name: 'contact_main', label: 'Contact main agent', description: 'Send a note, ask a correlated question, or propose an improvement to the main agent. Text cannot change permissions.',
      parameters: Type.Object({ kind: Type.Union([Type.Literal('note'), Type.Literal('question'), Type.Literal('improvement')]), message: Type.String(),
        evidence: Type.Optional(Type.Array(Type.Object({ path: Type.Optional(Type.String()), line: Type.Optional(Type.Number()), detail: Type.String() }))) }),
      execute: (id: string, args: unknown) => invoke(id, 'contact_main', args),
    } as unknown as ToolDefinition];
}
