import { z } from 'zod';
import { readText, writeText, checkedTarget, within } from './file-operations.js';
import { createEditTool, createReadTool } from '@earendil-works/pi-coding-agent';
import { readdir, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const authority = z.strictObject({ cwd: z.string(), roots: z.array(z.string()), protectedPaths: z.array(z.string()) });
const message = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('read'), authority, path: z.string(), offset: z.number().int().positive().optional(), limit: z.number().int().positive().optional() }),
  z.strictObject({ operation: z.literal('write'), authority, path: z.string(), content: z.string() }),
  z.strictObject({ operation: z.literal('edit'), authority, path: z.string(), edits: z.array(z.strictObject({ oldText: z.string(), newText: z.string() })).min(1) }),
  z.strictObject({ operation: z.literal('ls'), authority, path: z.string().optional(), limit: z.number().int().positive().max(10000).optional() }),
  z.strictObject({ operation: z.literal('find'), authority, path: z.string().optional(), pattern: z.string(), limit: z.number().int().positive().max(10000).optional(), rg: z.string() }),
  z.strictObject({ operation: z.literal('grep'), authority, path: z.string().optional(), pattern: z.string(), glob: z.string().optional(), ignoreCase: z.boolean().optional(), literal: z.boolean().optional(),
    context: z.number().int().nonnegative().max(100).optional(), limit: z.number().int().positive().max(10000).optional(), rg: z.string() }),
]);
try {
  let input = '', bytes = 0;
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error('LIMIT_EXCEEDED'); input += chunk.toString(); }
  const request = message.parse(JSON.parse(input));
  if (request.operation === 'read') {
    const tool = createReadTool(request.authority.cwd, { operations: {
      access: async path => { await checkedTarget(request.authority, path, false); }, readFile: async path => Buffer.from(await readText(request.authority, path)),
      detectImageMimeType: async () => null,
    } });
    console.log(JSON.stringify(await tool.execute('fixed-helper', { path: request.path, ...(request.offset === undefined ? {} : { offset: request.offset }), ...(request.limit === undefined ? {} : { limit: request.limit }) })));
  }
  else if (request.operation === 'write') { await writeText(request.authority, request.path, request.content); console.log(JSON.stringify({ written: true })); }
  else if (request.operation === 'edit') {
    let snapshot: string | undefined;
    const tool = createEditTool(request.authority.cwd, { operations: {
      access: async path => { await readText(request.authority, path); },
      readFile: async path => { snapshot = await readText(request.authority, path); return Buffer.from(snapshot); },
      writeFile: async (path, content) => { if (snapshot === undefined) throw new Error('FILE_CHANGED'); await writeText(request.authority, path, content, snapshot); },
    } });
    console.log(JSON.stringify(await tool.execute('fixed-helper', { path: request.path, edits: request.edits })));
  } else if (request.operation === 'ls') {
    const path = await checkedTarget(request.authority, request.path ?? '.', false);
    const entries = (await readdir(path)).sort().filter(name => !request.authority.protectedPaths.some(protectedPath => within(protectedPath, join(path, name))));
    const limit = request.limit ?? 500;
    console.log(JSON.stringify({ text: entries.slice(0, limit).join('\n') + (entries.length > limit ? '\n[truncated]' : '') }));
  } else {
    const path = await checkedTarget(request.authority, request.path ?? '.', false);
    const argv = ['--no-config', '--no-require-git', '--hidden', '--glob', '!.git'];
    if (request.operation === 'find') argv.push('--files', '--glob', request.pattern);
    else {
      argv.push('--line-number', '--with-filename', '--color', 'never', '--max-count', String(request.limit ?? 100), '-e', request.pattern);
      if (request.ignoreCase) argv.push('--ignore-case'); if (request.literal) argv.push('--fixed-strings');
      if (request.glob) argv.push('--glob', request.glob); if (request.context) argv.push('--context', String(request.context));
    }
    argv.push('--', path);
    // The executable is supplied by the trusted parent, never found through workspace PATH.
    if (!request.rg.startsWith('/') || !(await lstat(request.rg)).isFile()) throw new Error('SANDBOX_UNAVAILABLE');
    const child = spawn(request.rg, argv, { cwd: request.authority.cwd, stdio: ['ignore','pipe','pipe'], shell: false });
    let stdout = '', stderr = '', truncated = false;
    child.stdout.on('data', bytes => { const combined = Buffer.concat([Buffer.from(stdout), bytes]); stdout = combined.subarray(0,16000).toString(); if (combined.length > 16000) { truncated = true; child.kill('SIGTERM'); } });
    child.stderr.on('data', bytes => { stderr = Buffer.concat([Buffer.from(stderr), bytes]).subarray(0,4096).toString(); });
    const code = await new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('close', done); });
    const lines = stdout.split('\n').filter(Boolean), limit = request.limit ?? 100;
    console.log(JSON.stringify({ text: lines.slice(0, limit).join('\n') + ((lines.length > limit || truncated) ? '\n[truncated]' : '') + (stderr ? '\n' + stderr : ''), exit_code: code }));
  }
} catch (error) { console.log(JSON.stringify({ error: error instanceof Error ? error.message : 'INTERNAL_ERROR' })); process.exitCode = 1; }
