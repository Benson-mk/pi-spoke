import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, link } from 'node:fs/promises';
import { tmpdir, platform, arch, release } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { checkWritableTopology } from '../../src/security/topology.js';

const roots: string[] = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

async function fixture() {
  const root = await realpath(await mkdtemp('/private/tmp/ps-')); roots.push(root);
  const cwd = join(root, 'project'), scratch = join(root, 'scratch'), home = join(root, 'home');
  for (const path of [cwd, scratch, home]) await mkdir(path, { mode: 0o700 });
  const source = join(cwd, 'source.txt'), outside = join(root, 'outside.txt');
  await writeFile(source, 'source canary'); await writeFile(outside, 'outside canary');
  async function run(command: string, writeAllow: string[] = [], readDeny: string[] = [], readAllow: string[] = [], writeDeny: string[] = [], stdin = '') {
    const child = spawn(process.execPath, [resolve('dist/sandbox/p0-launcher.js')], {
      cwd, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, TMPDIR: scratch,
        CLAUDE_CODE_TMPDIR: scratch, LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.stdin.end(JSON.stringify({ cwd, scratch, command, writeAllow, writeDeny, readDeny, readAllow, stdin }));
    await new Promise<void>((done, reject) => { child.once('error', reject); child.once('close', () => done()); });
    if (!stdout.trim()) throw new Error(`Sandbox launcher failed: ${stderr}`);
    const result = JSON.parse(stdout.trim());
    console.log(JSON.stringify({ platform: platform(), arch: arch(), os: release(), ...result,
      lockHash: hash(await readFile('package-lock.json')), sourceHash: hash(await readFile(source)), outsideHash: hash(await readFile(outside)) }));
    expect(result.error, stderr).toBeUndefined();
    return result;
  }
  return { root, cwd, scratch, source, outside, run };
}

test('P0 S04–S08/S11/S12: real source protection with permitted scratch and separate writer envelope', async () => {
  const f = await fixture();
  const unrelated = await realpath(await mkdtemp('/private/tmp/pi-spoke-unrelated-')); roots.push(unrelated);
  const canary = join(unrelated, 'canary'); await writeFile(canary, 'temporary canary');
  const probe = `const fs=require('node:fs'); const results={};
    for(const [name,fn] of Object.entries({unlink:()=>fs.unlinkSync(${JSON.stringify(f.source)}),
      truncate:()=>fs.writeFileSync(${JSON.stringify(f.source)},'bad'),
      outside:()=>fs.writeFileSync(${JSON.stringify(f.outside)},'bad'),
      unrelated:()=>fs.writeFileSync(${JSON.stringify(canary)},'bad'),
      scratch:()=>{fs.writeFileSync(${JSON.stringify(join(f.scratch, 'ok'))},'ok');fs.unlinkSync(${JSON.stringify(join(f.scratch, 'ok'))});}})) {
      try { fn(); results[name]='allowed'; } catch(e) {results[name]=e.code;} }
    console.log(JSON.stringify(results));`;
  const result = await f.run(`${quote(process.execPath)} -e ${quote(probe)}`);
  expect(result.code, result.stderr).toBe(0);
  const operations = JSON.parse(result.stdout);
  expect(operations.scratch).toBe('allowed');
  for (const key of ['unlink', 'truncate', 'outside', 'unrelated']) expect(platform() === 'linux' ? ['EROFS','EPERM','EACCES'] : ['EPERM','EACCES']).toContain(operations[key]);
  expect(await readFile(f.source, 'utf8')).toBe('source canary');
  expect(await readFile(canary, 'utf8')).toBe('temporary canary');
  const shell = await f.run(`/bin/rm ${quote(f.source)}; printf bad > ${quote(f.source)}`);
  expect(shell.code).not.toBe(0); expect(await readFile(f.source, 'utf8')).toBe('source canary');
  const writer = await f.run(`${quote(process.execPath)} ${quote(resolve('dist/helpers/file-tool-entry.js'))}`, [f.cwd], [], [], [], JSON.stringify({
    operation: 'write', authority: { cwd: f.cwd, roots: [f.cwd], protectedPaths: [] }, path: f.source, content: 'authorized',
  }));
  expect(writer.code, writer.stderr).toBe(0); expect(await readFile(f.source, 'utf8')).toBe('authorized');
  const edit = await f.run(`${quote(process.execPath)} ${quote(resolve('dist/helpers/file-tool-entry.js'))}`, [f.cwd], [], [], [], JSON.stringify({
    operation: 'edit', authority: { cwd: f.cwd, roots: [f.cwd], protectedPaths: [] }, path: f.source, edits: [{ oldText: 'authorized', newText: 'edited' }],
  }));
  expect(edit.code, edit.stderr).toBe(0); expect(await readFile(f.source, 'utf8')).toBe('edited');
  expect(JSON.parse(edit.stdout).details.diff).toContain('edited');
}, 60000);

test('P0 S20: investigate writable hard-link alias to read-only source', async () => {
  const f = await fixture();
  const dynamic = await f.run(`${quote(process.execPath)} -e ${quote(`const fs=require('node:fs');try{fs.linkSync(${JSON.stringify(f.source)},${JSON.stringify(join(f.scratch, 'new-alias'))});fs.writeFileSync(${JSON.stringify(join(f.scratch, 'new-alias'))},'dynamic-alias')}catch(e){console.log(e.code)}`)}`);
  console.log(JSON.stringify({ case: 'S20-dynamic', result: dynamic, after: await readFile(f.source, 'utf8') }));
  expect(await readFile(f.source, 'utf8')).toBe('source canary');
  expect(dynamic.stdout.trim()).toBe(platform() === 'linux' ? 'EXDEV' : 'EPERM');
  await link(f.source, join(f.scratch, 'alias'));
  await expect(checkWritableTopology(f.scratch)).rejects.toThrow('UNSAFE_PATH');
  expect(await readFile(f.source, 'utf8')).toBe('source canary');
}, 30000);

test('P0 S14/S23: missing protected targets and nested read denies survive workspace reopening', async () => {
  const f = await fixture();
  const secret = join(f.cwd, 'secrets'); await mkdir(secret); await writeFile(join(secret, 'key'), 'fake credential');
  const missing = join(f.cwd, '.agents');
  const program = `const fs=require('node:fs');const result={};for(const [name,fn] of Object.entries({
    source:()=>fs.readFileSync(${JSON.stringify(f.source)},'utf8'),
    secret:()=>fs.readFileSync(${JSON.stringify(join(secret, 'key'))},'utf8'),
    renameSecret:()=>fs.renameSync(${JSON.stringify(secret)},${JSON.stringify(join(f.cwd, 'renamed'))}),
    missing:()=>fs.mkdirSync(${JSON.stringify(missing)}),
    ordinary:()=>fs.writeFileSync(${JSON.stringify(join(f.cwd, 'ordinary'))},'ok')
  })){try{result[name]=fn()??'allowed'}catch(e){result[name]=e.code}}console.log(JSON.stringify(result));`;
  const result = await f.run(`${quote(process.execPath)} -e ${quote(program)}`, [f.cwd], [f.root, secret], [f.cwd, f.scratch], [missing]);
  expect(result.code, result.stderr).toBe(0);
  const ops = JSON.parse(result.stdout);
  expect(ops.source).toBe('source canary'); expect(ops.ordinary).toBe('allowed');
  if (platform() === 'linux') {
    expect(ops.secret).toBe('ENOENT'); expect(ops.renameSecret).toBe('EBUSY'); expect(ops.missing).toBe('EEXIST');
    expect(await readFile(join(secret, 'key'), 'utf8')).toBe('fake credential');
  } else for (const key of ['secret', 'renameSecret', 'missing']) expect(['EPERM', 'EACCES']).toContain(ops[key]);
}, 30000);

test('P0 S25/S26: actual loopback IPv4/IPv6, listener and Unix socket denial', async () => {
  const f = await fixture();
  let connections = 0;
  const tcp = createServer(socket => { connections++; socket.destroy(); });
  const unix = createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(resolve => tcp.listen(0, '127.0.0.1', resolve));
  const socket = join(f.root, 'test.sock');
  await new Promise<void>(resolve => unix.listen(socket, resolve));
  try {
    const address = tcp.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
    const program = `const net=require('node:net'); const results={};
      const connect=(name,options)=>new Promise(resolve=>{const s=net.createConnection(options);s.on('connect',()=>{results[name]='CONNECTED';s.destroy();resolve()});s.on('error',e=>{results[name]=e.code;resolve()});s.setTimeout(1000,()=>{results[name]='TIMEOUT';s.destroy();resolve()})});
      Promise.all([connect('ipv4',{host:'127.0.0.1',port:${address.port}}),connect('ipv6',{host:'::1',port:${address.port}}),connect('unix',{path:${JSON.stringify(socket)}}),
        new Promise(resolve=>{const s=net.createServer();s.on('error',e=>{results.listen=e.code;resolve()});s.listen(0,'127.0.0.1',()=>{results.listen='ALLOWED';s.close(resolve)})})])
      .then(()=>console.log(JSON.stringify(results)));`;
    const result = await f.run(`${quote(process.execPath)} -e ${quote(program)}`);
    expect(result.code, result.stderr).toBe(0);
    const ops = JSON.parse(result.stdout);
    for (const key of ['ipv4', 'ipv6', 'unix', 'listen']) expect(['EPERM', 'EACCES']).toContain(ops[key]);
    expect(connections).toBe(0);
  } finally { await Promise.all([new Promise<void>(r => tcp.close(() => r())), new Promise<void>(r => unix.close(() => r()))]); }
}, 30000);

test('P0 S28: concurrent launcher policies do not leak writer authority', async () => {
  const f = await fixture();
  const [writer, shell] = await Promise.all([
    f.run(`printf authorized > ${quote(f.source)}`, [f.cwd]),
    f.run(`printf bad > ${quote(f.source)}`),
  ]);
  expect(writer.code).toBe(0); expect(shell.code).not.toBe(0);
  expect(writer.policyHash).not.toBe(shell.policyHash);
  expect(writer.launcherPid).not.toBe(shell.launcherPid);
  expect(await readFile(f.source, 'utf8')).toBe('authorized');
}, 30000);

test('P0 S27/S29: hostile wrapper text cannot write on the host; ordinary failures stay ordinary', async () => {
  const f = await fixture();
  const commands = [
    `printf bad > ${quote(f.outside)}`,
    `echo "$(printf bad > ${quote(f.outside)})"`,
    `echo '\''; printf bad > ${quote(f.outside)}; #`,
    `${quote(process.execPath)} -e ${quote(`require('node:fs').writeFileSync(${JSON.stringify(f.outside)},'bad')`)}`,
  ];
  for (const command of commands) {
    await f.run(command);
    expect(await readFile(f.outside, 'utf8')).toBe('outside canary');
  }
  const ordinary = await f.run('exit 37');
  expect(ordinary.code).toBe(37);
  expect(ordinary.stderr).toBe('');
}, 30000);
