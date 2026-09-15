// JSON and filesystem operations for setup.sh. Inputs are data, never shell code.
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (parent, child) => { const rel = relative(parent, child); return !rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)); };
const overlaps = (a, b) => inside(a, b) || inside(b, a);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

async function contents(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function parseJSON(text, label) {
  try { return JSON.parse(text); }
  catch { throw new Error(`${label} is not valid JSON; its contents have been withheld.`); }
}

async function canonical(path) {
  requireValue(typeof path === 'string' && isAbsolute(path) && !/[\x00-\x1f\x7f*?\[\]]/.test(path), 'Paths must be absolute, single-line literal paths.');
  try { return await realpath(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return join(await canonical(dirname(path)), path.slice(dirname(path).length + (dirname(path) === '/' ? 0 : 1)));
  }
}

async function directory(path) {
  const result = await canonical(path);
  requireValue((await lstat(result)).isDirectory(), `Expected an existing directory: ${result}`);
  return result;
}

async function snapshot(path) {
  try {
    const stat = await lstat(path);
    requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, `Output must be an ordinary file: ${path}`);
    return hash(await readFile(path));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function detectPi(agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME, '.pi/agent')) {
  if (agentDir === '~' || agentDir.startsWith('~/')) agentDir = join(process.env.HOME, agentDir.slice(2));
  const directory = await canonical(resolve(agentDir));
  const authPath = await canonical(join(directory, 'auth.json'));
  const modelsPath = await canonical(join(directory, 'models.json'));
  const isFile = async path => {
    try { return (await lstat(path)).isFile(); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  const [hasAuth, hasModels] = await Promise.all([isFile(authPath), isFile(modelsPath)]);
  if (!hasAuth && !hasModels) return null;
  return { directory, auth_path: authPath, ...(hasModels ? { models_path: modelsPath } : {}) };
}

export async function defaults(configDir, agentDir) {
  const text = await contents(join(configDir, 'config.json'));
  const config = text === null ? {} : parseJSON(text, 'Operator configuration');
  requireValue(!text || config.version === 2, 'Existing configuration requires explicit migration to version 2.');
  const pi = await detectPi(agentDir);
  return {
    PS_CONFIG_DIR: configDir, PS_WORKSPACE: config.workspace_roots?.[0] ?? '',
    PS_STATE_DIR: config.state_dir ?? join(process.env.HOME, '.local/share/pi-spoke/state'),
    PS_SCRATCH_DIR: config.scratch_dir ?? join(process.env.HOME, '.ps-tmp'),
    PS_INSTANCE: 'codex',
    PS_PI_DIR: pi?.directory ?? '', PS_LOAD_PI: 'no',
  };
}

export function readAnswers(text) {
  const values = Object.create(null);
  for (const line of text.split('\n').filter(Boolean)) {
    const equal = line.indexOf('=');
    requireValue(equal > 0 && /^PS_[A-Z_]+$/.test(line.slice(0, equal)), 'Invalid wizard answer file.');
    values[line.slice(0, equal)] = line.slice(equal + 1);
  }
  return values;
}

export async function prepare(values, stagingDir) {
  const v = values;
  const configDir = await canonical(v.PS_CONFIG_DIR), configPath = join(configDir, 'config.json');
  const runtime = await directory(v.PS_RUNTIME), node = await canonical(v.PS_NODE);
  requireValue((await lstat(join(runtime, 'dist/cli.js'))).isFile(), 'Build the selected installation before setup: npm run build');
  const { parseConfig } = await import(pathToFileURL(join(runtime, 'dist/config.js')));
  const { resolvePolicy } = await import(pathToFileURL(join(runtime, 'dist/security/policy.js')));
  const { spawnSchema } = await import(pathToFileURL(join(runtime, 'dist/contracts.js')));
  const oldText = await contents(configPath), old = oldText === null ? null : parseConfig(parseJSON(oldText, 'Operator configuration'));
  const workspace = await directory(v.PS_WORKSPACE);
  requireValue(/^[a-zA-Z0-9_-]{1,64}$/.test(v.PS_INSTANCE), 'Instance must contain 1–64 letters, digits, underscores, or hyphens.');
  const config = parseConfig({
    ...(old ?? { version: 2, sandbox: { backend: 'srt', required: true, tool_network: 'none' },
      pi: { auth_path: join(configDir, 'auth.json'), models_path: join(configDir, 'models.json') },
      allowed_models: [], limits: { max_run_wall_time_ms: 180000, max_run_turns: 12, max_active_runs: 3 } }),
    state_dir: await canonical(v.PS_STATE_DIR), scratch_dir: await canonical(v.PS_SCRATCH_DIR),
    workspace_roots: [...new Set([...(old?.workspace_roots ?? []), workspace])],
  });
  if (v.PS_LOAD_PI === 'yes') {
    const pi = await detectPi(v.PS_PI_DIR);
    requireValue(pi, 'The selected Pi configuration is no longer available. Run setup again.');
    config.pi = { auth_path: pi.auth_path, ...(pi.models_path ? { models_path: pi.models_path } : {}) };
    // Explicit import makes the Pi catalog available; workspace/tool authority is retained.
    delete config.allowed_models;
  }
  const authPath = await canonical(config.pi.auth_path);
  const modelsPath = config.pi.models_path ? await canonical(config.pi.models_path) : null;
  requireValue(!config.permissions.shell_write_roots.length, 'Project shell-write grants are unsupported; update config.json before setup.');
  // Validate filesystem policy independently of model setup. This temporary model
  // reference never enters the saved configuration and no worker is launched.
  const filesystemConfig = { ...config, allowed_models: undefined };
  for (const root of config.workspace_roots) {
    const canonicalRoot = await directory(root);
    for (const privatePath of [configDir, authPath, modelsPath].filter(Boolean)) {
      requireValue(!overlaps(canonicalRoot, privatePath), 'Configuration and provider files must be outside worker workspaces.');
    }
    const writeRoots = config.permissions.file_write_roots.filter(p => inside(canonicalRoot, p));
    const input = spawnSchema.parse({ request_key: 'setup-validation', task: 'Validate configuration without running a worker.',
      cwd: canonicalRoot, model: { provider: 'setup-validation', id: 'not-used' },
      tools: config.allowed_tools.filter(t => t !== 'bash' && (!['edit', 'write'].includes(t) || writeRoots.length)),
      permissions: { file_write_roots: writeRoots, shell_write_roots: [] } });
    await resolvePolicy(filesystemConfig, input, configPath, runtime);
  }
  for (const root of config.permissions.file_write_roots) {
    requireValue(config.workspace_roots.some(w => inside(w, root)), 'Every file-write root must be inside a configured workspace.');
  }
  for (const path of [config.state_dir, config.scratch_dir]) {
    requireValue(!overlaps(configDir, path) && !overlaps(runtime, path), 'Configuration, runtime, state, and scratch directories must be separate.');
  }
  const files = [];
  const addFile = async (path, value) => {
    files.push({ path, text: value, before: await snapshot(path) });
  };
  await addFile(configPath, json(config));
  const snippet = '[mcp_servers.pi_spoke]\n' + `command = ${JSON.stringify(node)}\n` +
    `args = ${JSON.stringify([join(runtime, 'dist/cli.js'), 'serve', '--config', configPath, '--instance', v.PS_INSTANCE])}\nstartup_timeout_sec = 20\ntool_timeout_sec = 45\n`;
  await addFile(join(configDir, 'codex.toml'), snippet);
  const plan = { files, directories: [configDir, config.state_dir, config.scratch_dir], config, node, runtime, instance: v.PS_INSTANCE };
  await writeFile(join(stagingDir, 'plan.json'), json(plan), { mode: 0o600 });
  return plan;
}

export async function save(plan, report = () => {}) {
  // Check every reviewed output before writing anything; concurrent edits require a new review.
  for (const file of plan.files) requireValue(await snapshot(file.path) === file.before, `File changed since review: ${file.path}. Run the wizard again.`);
  for (const path of plan.directories) await mkdir(path, { recursive: true, mode: 0o700 });
  const backups = [];
  for (const file of plan.files) {
    await mkdir(dirname(file.path), { recursive: true, mode: 0o700 });
    if (file.before !== null) {
      const backup = file.path + '.backup-' + randomUUID();
      await copyFile(file.path, backup, constants.COPYFILE_EXCL);
      await chmod(backup, 0o600);
      backups.push(backup);
      report('Backup: ' + backup);
    }
    const temp = file.path + '.tmp-' + randomUUID();
    try {
      await writeFile(temp, file.text, { mode: 0o600, flag: 'wx' });
      await rename(temp, file.path);
      report('Saved: ' + file.path);
    } finally { await rm(temp, { force: true }); }
  }
  return backups;
}

export async function copyInstallation(source, destination) {
  source = await directory(source);
  destination = await canonical(destination);
  requireValue(!overlaps(source, destination), 'Install into a separate directory outside this source checkout.');
  await mkdir(destination, { mode: 0o700 }); // Existing installations are never overwritten.
  for (const name of ['src', 'scripts', 'docs', 'examples', 'skills', 'package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'CONTEXT.md', 'LICENSE']) {
    await cp(join(source, name), join(destination, name), { recursive: true, errorOnExist: true, force: false });
  }
}

export async function checkMcp(plan) {
  const sdk = join(plan.runtime, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client');
  const { Client } = await import(pathToFileURL(join(sdk, 'index.js')));
  const { StdioClientTransport } = await import(pathToFileURL(join(sdk, 'stdio.js')));
  const client = new Client({ name: 'pi-spoke-setup', version: '0.1.0' });
  const checkDir = await mkdtemp(join(tmpdir(), 'ps-mcp-check-'));
  const checkConfig = join(checkDir, 'config.json');
  // Use disposable state and empty credentials, so checking MCP neither creates
  // provider files nor locks an existing instance. Model setup belongs in README.
  await writeFile(join(checkDir, 'auth.json'), '{}\n', { mode: 0o600 });
  await writeFile(checkConfig, json({ ...plan.config, state_dir: join(checkDir, 'state'),
    pi: { auth_path: join(checkDir, 'auth.json') } }), { mode: 0o600 });
  const transport = new StdioClientTransport({ command: plan.node,
    args: [join(plan.runtime, 'dist/cli.js'), 'serve', '--config', checkConfig, '--instance', 'setup'], stderr: 'pipe' });
  // Drain output without printing provider configuration or runtime errors containing paths/secrets.
  transport.stderr?.resume();
  try {
    await client.connect(transport, { timeout: 20000 });
    const { tools } = await client.listTools({}, { timeout: 10000 });
    const expected = ['spoke_catalog', 'spoke_spawn', 'spoke_observe', 'spoke_send', 'spoke_cancel', 'spoke_sessions'];
    requireValue(expected.every(name => tools.some(tool => tool.name === name)), 'The MCP server did not expose all six pi-spoke tools.');
    return expected;
  } finally {
    try { await client.close(); } finally {
      try { await transport.close(); } finally { await rm(checkDir, { recursive: true, force: true }); }
    }
  }
}

async function main() {
  const [command, input, stagingDir] = process.argv.slice(2);
  if (command === 'defaults') {
    const values = await defaults(input);
    const lines = Object.entries(values).map(([key, value]) => {
      requireValue(!/[\r\n\x00]/.test(value), 'Existing configuration has multiline values; edit it manually.');
      return `${key}=${value}`;
    });
    await writeFile(stagingDir, lines.join('\n') + '\n', { mode: 0o600 });
  } else if (command === 'prepare') {
    const plan = await prepare(readAnswers(await readFile(input, 'utf8')), stagingDir);
    console.log('Workspace: ' + plan.config.workspace_roots.join(', '));
    console.log('Tools: ' + plan.config.allowed_tools.join(', '));
    console.log('File-write roots: ' + (plan.config.permissions.file_write_roots.join(', ') || 'none'));
    console.log(`Limits: ${plan.config.limits.max_run_wall_time_ms / 1000}s, ${plan.config.limits.max_run_turns} turns, ${plan.config.limits.max_active_runs} concurrent runs`);
    if (plan.config.allowed_models === undefined) console.log('Models: Pi catalog (no pi-spoke model allowlist)');
    else console.log(`Models: ${plan.config.allowed_models.length} allowed; configure manually in README.md`);
    console.log('Pi files: ' + [plan.config.pi.auth_path, plan.config.pi.models_path].filter(Boolean).join(', '));
    console.log('Files:');
    for (const file of plan.files) console.log(`  ${file.before === null ? 'Create' : 'Back up and replace'} ${file.path}`);
    console.log('Create if missing: ' + plan.directories.join(', '));
  } else if (command === 'save') {
    const plan = parseJSON(await readFile(input, 'utf8'), 'Wizard plan');
    await save(plan, message => console.log(message));
  } else if (command === 'install') {
    await copyInstallation(input, stagingDir);
  } else if (command === 'check') {
    const plan = parseJSON(await readFile(input, 'utf8'), 'Wizard plan');
    console.log('MCP handshake passed: ' + (await checkMcp(plan)).join(', '));
  } else throw new Error('Unknown setup helper command.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Setup failed: ' + error.message); process.exitCode = 1; });
}
