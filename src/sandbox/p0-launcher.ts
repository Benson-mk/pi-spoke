/** Isolated sandbox manager: one policy and one subprocess per invocation. */
import { SandboxManager, getDefaultWritePaths } from '@anthropic-ai/sandbox-runtime';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { processIdentity } from './process-identity.js';

const input = z.strictObject({
  cwd: z.string(), scratch: z.string(), command: z.string().max(65536),
  readDeny: z.array(z.string()), readAllow: z.array(z.string()),
  writeAllow: z.array(z.string()), writeDeny: z.array(z.string()),
  stdin: z.string().max(1024 * 1024).optional(),
  timeout_ms: z.number().int().positive().default(15000),
});
let bytes = 0, text = '';
for await (const chunk of process.stdin) {
  bytes += chunk.length;
  if (bytes > 1024 * 1024) throw new Error('INVALID_ARGUMENT: probe payload exceeds limit');
  text += chunk.toString();
}
const probe = input.parse(JSON.parse(text));
const config = {
  network: { allowedDomains: [], deniedDomains: ['*'], strictAllowlist: true,
    allowUnixSockets: [], allowAllUnixSockets: false, allowLocalBinding: false, allowMachLookup: [] },
  filesystem: { disabled: false, denyRead: probe.readDeny, allowRead: probe.readAllow,
    allowWrite: [probe.scratch, ...probe.writeAllow],
    denyWrite: [...getDefaultWritePaths().filter(p => !p.startsWith('/dev/')), ...probe.writeDeny], allowGitConfig: false },
  enableWeakerNestedSandbox: false, enableWeakerNetworkIsolation: false,
  allowAppleEvents: false, allowPty: false, ignoreViolations: {},
};
const policyHash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
try {
  const dependencies = await SandboxManager.checkDependenciesAsync();
  if (dependencies.errors.length) throw new Error('SANDBOX_UNAVAILABLE: ' + dependencies.errors.join('; '));
  await SandboxManager.initialize(config, undefined, false);
  const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
  const command = platform() === 'linux' ? `${quote(join(dirname(fileURLToPath(import.meta.url)), 'native/deny-network'))} /bin/bash -c ${quote(probe.command)}` : probe.command;
  const wrapped = await SandboxManager.wrapWithSandboxArgv(command, '/bin/bash', undefined, undefined, probe.cwd);
  if (wrapped.argv[0] !== '/bin/bash' || wrapped.argv[1] !== '-c' ||
    !(platform() === 'darwin' ? wrapped.argv[2]?.includes('sandbox-exec') : platform() === 'linux' && wrapped.argv[2]?.includes('bwrap') && wrapped.argv[2]?.includes('--unshare-net') && wrapped.argv[2]?.includes('apply-seccomp'))) {
    throw new Error('SANDBOX_POLICY_UNSUPPORTED: P0 wrapper shape has not been validated on this platform');
  }
  const child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
    cwd: probe.cwd, shell: false, detached: true,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, TMPDIR: probe.scratch,
      CLAUDE_CODE_TMPDIR: probe.scratch, LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stop = () => { if (child.exitCode === null && child.signalCode === null && child.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  } };
  process.once('disconnect', stop); process.once('SIGTERM', stop);
  let stdout = '', stderr = '';
  child.stdin.on('error', () => {}); // A short-lived helper may close stdin before identity enrichment.
  child.stdout.on('data', b => { stdout += b; if (Buffer.byteLength(stdout) > 65536) { stdout = Buffer.from(stdout).subarray(0, 65536).toString(); stop(); } });
  child.stderr.on('data', b => { stderr += b; if (Buffer.byteLength(stderr) > 65536) { stderr = Buffer.from(stderr).subarray(0, 65536).toString(); stop(); } });
  const timer = setTimeout(stop, probe.timeout_ms);
  const closed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  void closed.catch(() => {});
  if (child.pid) {
    process.send?.({ kind: 'launched', identity: { pid: child.pid, birth: null, group: child.pid }, observedAt: Date.now(), policyHash });
    process.send?.({ kind: 'launched', identity: await processIdentity(child.pid), observedAt: Date.now(), policyHash });
  }
  child.stdin.end(probe.stdin ?? '');
  const code = await closed;
  clearTimeout(timer);
  process.removeListener('disconnect', stop); process.removeListener('SIGTERM', stop);
  let groupAbsent = false;
  if (child.pid) try { process.kill(-child.pid, 0); } catch (error) { groupAbsent = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  console.log(JSON.stringify({ code, stdout, stderr, policyHash, defaultWritePaths: getDefaultWritePaths(),
    wrapper: wrapped.argv[0], launcherPid: process.pid, cleanup: groupAbsent ? 'group-absent' : 'unconfirmed' }));
} catch (error) {
  console.log(JSON.stringify({ error: String(error), policyHash }));
  process.exitCode = 1;
} finally {
  await SandboxManager.reset();
  if (process.connected) process.disconnect();
}
