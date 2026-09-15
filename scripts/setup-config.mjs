// JSON and filesystem operations for setup.sh. Inputs are data, never shell code.
import { chmod, copyFile, cp, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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

async function snapshot(path, mustBeNew = false) {
  try {
    const stat = await lstat(path);
    requireValue(!mustBeNew, `Refusing to replace existing provider files: ${path}. Choose reuse or a different folder.`);
    requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, `Output must be an ordinary file: ${path}`);
    return hash(await readFile(path));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function defaults(configDir) {
  const text = await contents(join(configDir, 'config.json'));
  const config = text === null ? {} : parseJSON(text, 'Operator configuration');
  requireValue(!text || config.version === 2, 'Existing configuration requires explicit migration to version 2.');
  return {
    PS_CONFIG_DIR: configDir, PS_WORKSPACE: config.workspace_roots?.[0] ?? '',
    PS_STATE_DIR: config.state_dir ?? join(process.env.HOME, '.local/share/pi-spoke/state'),
    PS_SCRATCH_DIR: config.scratch_dir ?? join(process.env.HOME, '.ps-tmp'),
    PS_AUTH_MODE: text || await contents(join(configDir, 'auth.json')) !== null ? 'reuse' : 'new',
    PS_AUTH_PATH: config.pi?.auth_path ?? join(configDir, 'auth.json'),
    PS_MODELS_PATH: config.pi?.models_path ?? (await contents(join(configDir, 'models.json')) !== null ? join(configDir, 'models.json') : ''),
    PS_PROVIDER: config.allowed_models?.[0]?.provider ?? '', PS_MODEL: config.allowed_models?.[0]?.id ?? '',
    PS_DESCRIPTION: config.allowed_models?.[0]?.description ?? '',
    PS_PERMISSION_MODE: text ? 'keep' : 'read', PS_FILE_ROOT: '',
    PS_WALL_MS: String(config.limits?.max_run_wall_time_ms ?? 180000),
    PS_TURNS: String(config.limits?.max_run_turns ?? 12), PS_ACTIVE: String(config.limits?.max_active_runs ?? 3),
    PS_API: 'openai-completions', PS_BASE_URL: '', PS_CONTEXT: '128000', PS_OUTPUT: '16384',
    PS_REASONING: 'no', PS_VISION: 'no', PS_INSTANCE: 'codex',
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
  requireValue(['new', 'reuse'].includes(v.PS_AUTH_MODE), 'Choose new or reuse for provider setup.');
  requireValue(/^[a-zA-Z0-9_-]{1,64}$/.test(v.PS_INSTANCE), 'Instance must contain 1–64 letters, digits, underscores, or hyphens.');
  requireValue(['keep', 'read', 'edit'].includes(v.PS_PERMISSION_MODE), 'Choose keep, read, or edit for permissions.');
  requireValue(v.PS_PROVIDER && v.PS_MODEL, 'Provider and model ID are required.');
  const authPath = await canonical(v.PS_AUTH_MODE === 'new' ? join(configDir, 'auth.json') : v.PS_AUTH_PATH);
  const modelsPath = v.PS_AUTH_MODE === 'new' ? join(configDir, 'models.json') : v.PS_MODELS_PATH ? await canonical(v.PS_MODELS_PATH) : null;
  const selected = { provider: v.PS_PROVIDER, id: v.PS_MODEL, ...(v.PS_DESCRIPTION ? { description: v.PS_DESCRIPTION } : {}) };
  const config = parseConfig({
    ...(old ?? { version: 2, sandbox: { backend: 'srt', required: true, tool_network: 'none' } }),
    state_dir: await canonical(v.PS_STATE_DIR), scratch_dir: await canonical(v.PS_SCRATCH_DIR),
    workspace_roots: [...new Set([...(old?.workspace_roots ?? []), workspace])],
    pi: { auth_path: authPath, ...(modelsPath ? { models_path: modelsPath } : {}) },
    allowed_models: [...(old?.allowed_models ?? []).filter(m => m.provider !== selected.provider || m.id !== selected.id), selected],
    limits: { ...old?.limits, max_run_wall_time_ms: Number(v.PS_WALL_MS), max_run_turns: Number(v.PS_TURNS), max_active_runs: Number(v.PS_ACTIVE) },
  });
  if (v.PS_PERMISSION_MODE !== 'keep') {
    config.allowed_tools = ['read', 'grep', 'find', 'ls', ...(v.PS_PERMISSION_MODE === 'edit' ? ['edit', 'write'] : [])];
    config.permissions = { file_write_roots: v.PS_PERMISSION_MODE === 'edit' ? [await directory(v.PS_FILE_ROOT)] : [], shell_write_roots: [] };
  }
  requireValue(!config.permissions.shell_write_roots.length, 'Project shell-write grants are unsupported; select read or edit permissions.');
  // Apply the same admission rules used for runs, without launching tools or inference.
  for (const root of config.workspace_roots) {
    const canonicalRoot = await directory(root);
    for (const privatePath of [configDir, authPath, modelsPath].filter(Boolean)) {
      requireValue(!overlaps(canonicalRoot, privatePath), 'Configuration and provider files must be outside worker workspaces.');
    }
    const writeRoots = config.permissions.file_write_roots.filter(p => inside(canonicalRoot, p));
    const input = spawnSchema.parse({ request_key: 'setup-validation', task: 'Validate configuration without running a worker.',
      cwd: canonicalRoot, model: { provider: selected.provider, id: selected.id },
      tools: config.allowed_tools.filter(t => t !== 'bash' && (!['edit', 'write'].includes(t) || writeRoots.length)),
      permissions: { file_write_roots: writeRoots, shell_write_roots: [] } });
    await resolvePolicy(config, input, configPath, runtime);
  }
  for (const root of config.permissions.file_write_roots) {
    requireValue(config.workspace_roots.some(w => inside(w, root)), 'Every file-write root must be inside a configured workspace.');
  }
  for (const path of [config.state_dir, config.scratch_dir]) {
    requireValue(!overlaps(configDir, path) && !overlaps(runtime, path), 'Configuration, runtime, state, and scratch directories must be separate.');
  }
  const files = [];
  const addFile = async (path, value, mustBeNew = false) => {
    files.push({ path, text: value, before: await snapshot(path, mustBeNew) });
  };
  if (v.PS_AUTH_MODE === 'new') {
    requireValue(v.PS_KEY && !/[\x00-\x1f\x7f]/.test(v.PS_KEY), 'Enter a single-line API key.');
    // Pi interprets !commands and $variables in credentials; accept literal keys only here.
    requireValue(!v.PS_KEY.startsWith('!') && !v.PS_KEY.includes('$'), 'Enter a literal API key; use existing Pi files for credential commands or environment references.');
    requireValue(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'].includes(v.PS_API), 'Unsupported provider API type.');
    let url;
    try { url = new URL(v.PS_BASE_URL); } catch { throw new Error('Enter a valid provider base URL.'); }
    requireValue(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, 'Base URL must be HTTP(S), without credentials, query, or fragment.');
    const context = Number(v.PS_CONTEXT), output = Number(v.PS_OUTPUT);
    requireValue(Number.isSafeInteger(context) && context > 0 && Number.isSafeInteger(output) && output > 0 && output <= context, 'Token limits must be positive integers; output cannot exceed context.');
    const auth = { [selected.provider]: { type: 'api_key', key: v.PS_KEY } };
    const models = { providers: { [selected.provider]: { baseUrl: url.href.replace(/\/$/, ''), api: v.PS_API, authHeader: true,
      models: [{ id: selected.id, reasoning: v.PS_REASONING === 'yes', input: v.PS_VISION === 'yes' ? ['text', 'image'] : ['text'], contextWindow: context, maxTokens: output }] } } };
    await addFile(authPath, json(auth), true);
    await addFile(modelsPath, json(models), true);
  } else {
    const auth = parseJSON(await readFile(authPath, 'utf8'), 'Pi credentials');
    requireValue(auth && typeof auth === 'object' && !Array.isArray(auth), 'Pi credentials must be a JSON object.');
    if (modelsPath) requireValue((await lstat(modelsPath)).isFile(), 'The selected models file must exist.');
  }
  // Use the selected installation's Pi parser, including JSONC support, without refreshing providers.
  const { ModelRuntime } = await import(pathToFileURL(join(runtime, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js')));
  const { InMemoryCredentialStore } = await import(pathToFileURL(join(runtime, 'node_modules/@earendil-works/pi-ai/dist/index.js')));
  const modelFile = v.PS_AUTH_MODE === 'new' ? join(stagingDir, 'models.json') : modelsPath;
  if (v.PS_AUTH_MODE === 'new') await writeFile(modelFile, files.find(f => f.path === modelsPath).text, { mode: 0o600 });
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: modelFile, modelsStorePath: join(stagingDir, 'model-cache.json'), allowModelNetwork: false, refreshOnCreate: false });
  requireValue(!models.getError(), 'Pi could not load the model configuration; inspect its syntax and provider settings.');
  requireValue(models.getModels().some(m => m.provider === selected.provider && m.id === selected.id), 'The exact provider/model pair was not found. Check models.json or the installed Pi catalog.');
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
  const transport = new StdioClientTransport({ command: plan.node,
    args: [join(plan.runtime, 'dist/cli.js'), 'serve', '--config', join(dirname(plan.files.at(-1).path), 'config.json'), '--instance', plan.instance], stderr: 'pipe' });
  // Drain output without printing provider configuration or runtime errors containing paths/secrets.
  transport.stderr?.resume();
  try {
    await client.connect(transport, { timeout: 20000 });
    const { tools } = await client.listTools({}, { timeout: 10000 });
    const expected = ['spoke_catalog', 'spoke_spawn', 'spoke_observe', 'spoke_send', 'spoke_cancel', 'spoke_sessions'];
    requireValue(expected.every(name => tools.some(tool => tool.name === name)), 'The MCP server did not expose all six pi-spoke tools.');
    return expected;
  } finally { await client.close(); await transport.close(); }
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
    console.log('Operator configuration to save:\n' + json(plan.config));
    console.log('Files (credentials are hidden):');
    for (const file of plan.files) console.log(`  ${file.before === null ? 'Create' : 'Back up and replace'} ${file.path}`);
    console.log('Create if missing: ' + plan.directories.join(', '));
    console.log('Codex connection snippet:\n' + plan.files.at(-1).text);
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
