import { mkdtemp, mkdir, realpath, writeFile, readFile, rm, readdir, readlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';
import { expect, test, vi } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { spawnSchema } from '../../src/contracts.js';
import { resolvePolicy } from '../../src/security/policy.js';
import { Sandbox } from '../../src/sandbox/backend.js';

test('S32 characterization: detached descendant stays contained; wrapper exit is never reported as verified cleanup', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-desc-')), cwd = join(root, 'p'); await mkdir(cwd);
  const source = join(cwd, 'source'); await writeFile(source, 'canary');
  const config = parseConfig({ version: 2, state_dir: join(root, 's'), scratch_dir: join(root, 't'), workspace_roots: [cwd], allowed_tools: ['bash'],
    pi: { auth_path: join(root, 'auth.json') }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const input = spawnSchema.parse({ request_key: 'descendant', task: 'fixture', cwd, tools: ['bash'], model: { provider: 'fixture', id: 'fixture' } });
  const policy = await resolvePolicy(config, input, join(root, 'config.json'), resolve('.'));
  const sandbox = new Sandbox(config, resolve('.')), runId = 'run_' + randomUUID();
  const scratch = await sandbox.createScratch(runId), marker = join(scratch, 'finished');
  const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
  // Finite detached child: it exits by itself. No host process lookup or broad kill is used.
  const started = join(scratch, 'started');
  const descendant = `${platform() === 'linux' ? `require('node:fs').writeFileSync(${JSON.stringify(started)},require('node:fs').readlinkSync('/proc/self/ns/pid'));` : ''}setTimeout(()=>{const fs=require('node:fs');let denied=false;try{fs.writeFileSync(${JSON.stringify(source)},'bad')}catch(e){denied=['EPERM','EACCES','EROFS'].includes(e.code)}fs.writeFileSync(${JSON.stringify(marker)},String(denied));},200);`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore'}).unref();${platform() === 'linux' ? `const fs=require('node:fs');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(started)}))clearInterval(timer)},5);setTimeout(()=>process.exit(2),5000).unref();` : ''}`;
  try {
    const result = await sandbox.tool(runId, policy, scratch, 'bash', { command: `${quote(process.execPath)} -e ${quote(parent)}` });
    expect(result.cleanup).toBe('unconfirmed');
    if (platform() === 'linux') {
      const namespace = await readFile(started, 'utf8');
      expect(namespace).toMatch(/^pid:\[\d+\]$/);
      await vi.waitFor(async () => {
        const namespaces = await Promise.all((await readdir('/proc')).filter(name => /^\d+$/.test(name)).map(pid => readlink(`/proc/${pid}/ns/pid`).catch(() => null)));
        expect(namespaces).not.toContain(namespace);
      }, { timeout: 5000 });
    } else await vi.waitFor(async () => expect(await readFile(marker, 'utf8')).toBe('true'), { timeout: 5000 });
    expect(await readFile(source, 'utf8')).toBe('canary');
  } finally { await sandbox.cancel(runId); await rm(root, { recursive: true, force: true }); }
}, 15000);
