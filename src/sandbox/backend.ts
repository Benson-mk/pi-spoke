import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, lstat, writeFile, rm } from 'node:fs/promises';
import { homedir, platform, arch, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { OperatorConfig } from '../config.js';
import type { ResolvedPolicy } from '../security/policy.js';
import { checkWritableTopology } from '../security/topology.js';
import { fail, SpokeError } from '../core/errors.js';
import { within } from '../helpers/file-operations.js';
import { verifyQualification } from './qualification.js';
import { ripgrepSha256 } from './qualification-pins.js';

const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
const here = dirname(fileURLToPath(import.meta.url));
const outcomeSchema = z.strictObject({ code: z.number().nullable(), stdout: z.string(), stderr: z.string(), policyHash: z.string(),
  defaultWritePaths: z.array(z.string()), wrapper: z.string(), launcherPid: z.number(), cleanup: z.string() });
type Outcome = z.infer<typeof outcomeSchema>;
export class Sandbox {
  private readonly active = new Map<string, Set<ChildProcess>>();
  private readonly cancelled = new Set<string>();
  constructor(private readonly config: OperatorConfig, private readonly runtimeRoot: string) {}
  async createScratch(runId: string): Promise<string> {
    if (!/^run_[a-f0-9-]+$/.test(runId)) fail('INVALID_ARGUMENT');
    await mkdir(this.config.scratch_dir, { recursive: true, mode: 0o700 });
    const root = await realpath(this.config.scratch_dir);
    if ((await lstat(root)).isSymbolicLink()) fail('UNSAFE_PATH');
    const scratch = await mkdtemp(join(root, 'run-')); await mkdir(join(scratch, 'home'), { mode: 0o700 }); return scratch;
  }
  private async invoke(runId: string, policy: ResolvedPolicy, scratch: string, command: string, stdin: string, writer: boolean, timeout_ms = 15000): Promise<Outcome> {
    if (this.cancelled.has(runId)) fail('RUN_NOT_ACTIVE');
    if (platform() !== 'darwin') fail('SANDBOX_UNAVAILABLE', 'This build has only qualified the macOS adapter baseline');
    await verifyQualification(this.runtimeRoot).catch(error => { if (error instanceof SpokeError) throw error; fail('SANDBOX_UNAVAILABLE', 'Compatibility identity cannot be verified'); });
    await checkWritableTopology(scratch);
    for (const identity of [policy.cwdIdentity, policy.workspaceIdentity, ...policy.rootIdentities]) {
      const current = await lstat(identity.path);
      if (current.dev !== identity.dev || current.ino !== identity.ino) fail('POLICY_CHANGED');
    }
    const root = await realpath(this.config.scratch_dir);
    if (!within(root, scratch) || scratch === root) fail('UNSAFE_PATH');
    const payload = { cwd: policy.cwd, scratch, command, stdin, timeout_ms,
      writeAllow: writer ? policy.file_write_roots : policy.shell_write_roots,
      writeDeny: policy.protected_write_paths,
      readDeny: [homedir(), root, ...policy.protected_read_paths],
      readAllow: [policy.workspace, scratch, this.runtimeRoot, ...(policy.resources?.skills.map(skill => skill.baseDir) ?? []), ...this.config.sandbox.additional_toolchain_read_paths],
    };
    if (Buffer.byteLength(JSON.stringify(payload)) > 1024 * 1024) fail('LIMIT_EXCEEDED');
    if (this.cancelled.has(runId)) fail('RUN_NOT_ACTIVE');
    const child = fork(join(this.runtimeRoot, 'dist/sandbox/p0-launcher.js'), [], { cwd: policy.cwd, execPath: process.execPath,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: join(scratch, 'home'), TMPDIR: scratch, CLAUDE_CODE_TMPDIR: scratch, LANG: 'C.UTF-8' },
      stdio: ['pipe','pipe','pipe','ipc'], detached: true, serialization: 'json' });
    const active = this.active.get(runId) ?? new Set(); active.add(child); this.active.set(runId, active);
    let stdout = '', stderr = '', overflow = false;
    child.stdout!.on('data', bytes => { stdout += bytes; if (Buffer.byteLength(stdout) > 1024 * 1024) { overflow = true; child.kill('SIGTERM'); } });
    child.stderr!.on('data', bytes => { stderr += bytes; if (Buffer.byteLength(stderr) > 65536) { overflow = true; child.kill('SIGTERM'); } });
    child.stdin!.on('error', () => {}); child.stdin!.end(JSON.stringify(payload));
    const timer = setTimeout(() => child.kill('SIGTERM'), this.config.limits.max_sandbox_startup_seconds * 1000);
    child.on('message', value => { if (value && typeof value === 'object' && 'kind' in value && value.kind === 'launched') clearTimeout(timer); });
    try {
      const code = await new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('close', done); });
      if (overflow) fail('LIMIT_EXCEEDED', 'Tool output exceeded the bounded invocation envelope');
      let value; try { value = JSON.parse(stdout); } catch { fail('SANDBOX_SETUP_FAILED', 'Sandbox launcher did not return a valid result'); }
      if (code !== 0 || value.error) fail('SANDBOX_SETUP_FAILED', 'Sandbox initialization or execution infrastructure failed');
      return outcomeSchema.parse(value);
    } finally { clearTimeout(timer); active.delete(child); if (!active.size) this.active.delete(runId); }
  }
  async preflight(runId: string, policy: ResolvedPolicy, scratch: string) {
    if (platform() !== 'darwin') fail('SANDBOX_UNAVAILABLE', 'This build has only qualified the macOS adapter baseline');
    const binary = await realpath('/usr/bin/sandbox-exec').catch(() => fail('SANDBOX_UNAVAILABLE', 'Seatbelt executable is unavailable'));
    const sha256 = createHash('sha256').update(await readFile(binary)).digest('hex');
    const fixture = await mkdtemp(join(this.config.scratch_dir, 'probe-')), outside = join(fixture, 'outside');
    await writeFile(outside, 'outside canary', { mode: 0o600 });
    const program = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(join(scratch, 'canary'))},'ok');fs.unlinkSync(${JSON.stringify(join(scratch, 'canary'))});
      let denied=false;try{fs.writeFileSync(${JSON.stringify(outside)},'bad')}catch(e){denied=['EPERM','EACCES'].includes(e.code)}if(!denied)throw Error('write boundary absent');
      const s=require('node:net').createServer();s.on('error',e=>{if(!['EPERM','EACCES'].includes(e.code))throw e;console.log('sandbox-ready')});s.listen(0,'127.0.0.1',()=>{s.close();throw Error('network boundary absent')});`;
    try {
      const result = await this.invoke(runId, policy, scratch, `${quote(process.execPath)} -e ${quote(program)}`, '', false);
      if (result.code !== 0 || result.stdout.trim() !== 'sandbox-ready' || await readFile(outside, 'utf8') !== 'outside canary') fail('SANDBOX_UNAVAILABLE');
    } finally { await rm(fixture, { recursive: true, force: true }); }
    return { name: 'srt', version: '0.0.76', platform: platform(), architecture: arch(), os: release(), enforcement: 'seatbelt',
      binary, binary_sha256: sha256, preflight_id: createHash('sha256').update(runId + sha256 + policy.policy_hash).digest('hex') };
  }
  async tool(runId: string, policy: ResolvedPolicy, scratch: string, name: string, args: unknown) {
    if (!policy.tools.includes(name as typeof policy.tools[number])) fail('TOOL_NOT_ALLOWED');
    if (name === 'bash') {
      const parsed = z.strictObject({ command: z.string().min(1).max(65536), timeout: z.number().positive().optional() }).parse(args);
      const timeout = parsed.timeout ?? this.config.limits.max_shell_command_seconds;
      if (timeout > this.config.limits.max_shell_command_seconds) fail('LIMIT_EXCEEDED');
      const result = await this.invoke(runId, policy, scratch, parsed.command, '', false, Math.ceil(timeout * 1000));
      return { result: { content: [{ type: 'text', text: result.stdout + result.stderr + (result.code ? `\nCommand exited with code ${result.code}` : '') }],
        details: { exit_code: result.code, policy_hash: result.policyHash } }, cleanup: 'unconfirmed' as const, evidence: result };
    }
    const input = z.record(z.string(), z.unknown()).parse(args);
    const operation = name;
    const authority = { cwd: policy.cwd, roots: name === 'write' || name === 'edit' ? policy.file_write_roots : [policy.workspace, ...(policy.resources?.skills.map(skill => skill.baseDir) ?? [])],
      protectedPaths: name === 'write' || name === 'edit' ? policy.protected_write_paths : policy.protected_read_paths };
    let rg: string | undefined;
    if (name === 'grep' || name === 'find') {
      for (const candidate of ['/opt/homebrew/bin/rg', '/usr/bin/rg']) { try { rg = await realpath(candidate); break; } catch {} }
      if (!rg) fail('SANDBOX_UNAVAILABLE', 'A trusted ripgrep installation is required');
      if (createHash('sha256').update(await readFile(rg)).digest('hex') !== ripgrepSha256) fail('SANDBOX_UNAVAILABLE', 'Ripgrep compatibility identity changed; requalification is required');
    }
    const payload = { ...input, operation, authority, ...(rg ? { rg } : {}) };
    const result = await this.invoke(runId, policy, scratch, `${quote(process.execPath)} ${quote(join(this.runtimeRoot, 'dist/helpers/file-tool-entry.js'))}`, JSON.stringify(payload), name === 'edit' || name === 'write');
    let response; try { response = JSON.parse(result.stdout); } catch { fail('SANDBOX_SETUP_FAILED', 'File helper result is invalid'); }
    if (response.error) return { result: { content: [{ type: 'text', text: response.error }], details: { error: true }, isError: true }, cleanup: 'confirmed' as const, evidence: result };
    return { result: response.content ? response : { content: [{ type: 'text', text: response.text ?? 'File written.' }], details: {} }, cleanup: 'confirmed' as const, evidence: result };
  }
  async cancel(runId: string): Promise<'confirmed' | 'unconfirmed'> {
    this.cancelled.add(runId);
    const active = this.active.get(runId); if (!active?.size) return 'confirmed';
    await Promise.all([...active].map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>(done => { const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 2000);
        child.once('close', () => { clearTimeout(timer); done(); }); });
    }));
    return 'unconfirmed';
  }
}
