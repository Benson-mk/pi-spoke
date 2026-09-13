/** Disposable P0 compatibility probe. Not an application execution endpoint. */
import { SandboxManager, getDefaultWritePaths } from '@anthropic-ai/sandbox-runtime';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const input = z.strictObject({
  cwd: z.string(), scratch: z.string(), command: z.string().max(65536),
  readDeny: z.array(z.string()), readAllow: z.array(z.string()),
  writeAllow: z.array(z.string()), writeDeny: z.array(z.string()),
  stdin: z.string().max(1024 * 1024).optional(),
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
  const wrapped = await SandboxManager.wrapWithSandboxArgv(probe.command, '/bin/bash', undefined, undefined, probe.cwd);
  if (wrapped.argv[0] !== '/bin/bash' || wrapped.argv[1] !== '-c' ||
    !wrapped.argv[2]?.includes('sandbox-exec')) {
    throw new Error('SANDBOX_POLICY_UNSUPPORTED: P0 wrapper shape has not been validated on this platform');
  }
  const child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
    cwd: probe.cwd, shell: false, env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(probe.stdin ?? '');
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; if (stdout.length > 65536) child.kill('SIGKILL'); });
  child.stderr.on('data', b => { stderr += b; if (stderr.length > 65536) child.kill('SIGKILL'); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  clearTimeout(timer);
  console.log(JSON.stringify({ code, stdout, stderr, policyHash, defaultWritePaths: getDefaultWritePaths(),
    wrapper: wrapped.argv[0], launcherPid: process.pid, cleanup: 'wrapper-exited-descendants-unverified' }));
} catch (error) {
  console.log(JSON.stringify({ error: String(error), policyHash }));
  process.exitCode = 1;
} finally {
  await SandboxManager.reset();
}
