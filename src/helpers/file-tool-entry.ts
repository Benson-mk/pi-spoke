import { z } from 'zod';
import { readText, writeText } from './file-operations.js';
import { createEditTool } from '@earendil-works/pi-coding-agent';

const authority = z.strictObject({ cwd: z.string(), roots: z.array(z.string()), protectedPaths: z.array(z.string()) });
const message = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('read'), authority, path: z.string() }),
  z.strictObject({ operation: z.literal('write'), authority, path: z.string(), content: z.string() }),
  z.strictObject({ operation: z.literal('edit'), authority, path: z.string(), edits: z.array(z.strictObject({ oldText: z.string(), newText: z.string() })).min(1) }),
]);
try {
  let input = '', bytes = 0;
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error('LIMIT_EXCEEDED'); input += chunk.toString(); }
  const request = message.parse(JSON.parse(input));
  if (request.operation === 'read') console.log(JSON.stringify({ text: await readText(request.authority, request.path) }));
  else if (request.operation === 'write') { await writeText(request.authority, request.path, request.content); console.log(JSON.stringify({ written: true })); }
  else {
    let snapshot: string | undefined;
    const tool = createEditTool(request.authority.cwd, { operations: {
      access: async path => { await readText(request.authority, path); },
      readFile: async path => { snapshot = await readText(request.authority, path); return Buffer.from(snapshot); },
      writeFile: async (path, content) => { if (snapshot === undefined) throw new Error('FILE_CHANGED'); await writeText(request.authority, path, content, snapshot); },
    } });
    console.log(JSON.stringify(await tool.execute('fixed-helper', { path: request.path, edits: request.edits })));
  }
} catch (error) { console.log(JSON.stringify({ error: error instanceof Error ? error.message : 'INTERNAL_ERROR' })); process.exitCode = 1; }
