import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createAgentSession, ModelRuntime, SessionManager, loadSkillsFromDir, createWriteToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage, type Context } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { isolatedResources } from '../../src/pi/resources.js';
import { confirmIdentity, requireModel } from '../../src/pi/identity.js';

const fixtures: string[] = [];
afterEach(async () => { for (const path of fixtures.splice(0)) await rm(path, { recursive: true, force: true }); });

test('P0: real Pi tools, asynchronous contact, literal steering, native save/reopen and resource isolation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-spoke-contract-')); fixtures.push(root);
  const cwd = join(root, 'project'), agentDir = join(root, 'agent');
  for (const path of [cwd, agentDir, join(cwd, '.pi'), join(agentDir, 'skills', 'ambient')]) await mkdir(path, { recursive: true });
  for (const path of [join(agentDir, 'AGENTS.md'), join(cwd, 'AGENTS.md'), join(agentDir, 'SYSTEM.md'), join(cwd, '.pi', 'APPEND_SYSTEM.md')]) await writeFile(path, 'AMBIENT_POISON');
  await writeFile(join(agentDir, 'skills', 'ambient', 'SKILL.md'), '---\nname: ambient\ndescription: AMBIENT_POISON\n---\nBODY_POISON');
  for (const name of ['one', 'two']) {
    await mkdir(join(root, 'selected', name), { recursive: true });
    await writeFile(join(root, 'selected', name, 'SKILL.md'), `---\nname: ${name}\ndescription: selected ${name}\n---\nBODY_POISON`);
  }
  const skills = loadSkillsFromDir({ dir: join(root, 'selected'), source: 'explicit' }).skills;
  expect(skills).toHaveLength(2);
  const runtime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const requests: Context[] = [];
  let calls = 0;
  runtime.registerProvider('local-fixture', {
    api: 'openai-completions', apiKey: 'fake', baseUrl: 'http://127.0.0.1:1',
    models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      requests.push(JSON.parse(JSON.stringify(context)));
      const stream = createAssistantMessageEventStream();
      const turn = calls++;
      const message: AssistantMessage = {
        role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        content: turn === 0 ? [{ type: 'toolCall', id: 'w1', name: 'write', arguments: { path: 'guarded.txt', content: 'data only' } }]
          : turn === 1 ? [{ type: 'toolCall', id: 'q1', name: 'contact_main', arguments: { message: 'Need context' } }] : [{ type: 'text', text: 'done' }],
        stopReason: turn < 2 ? 'toolUse' : 'stop',
      };
      queueMicrotask(() => { stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message }); stream.end(message); });
      return stream;
    },
  });
  const model = runtime.getModel('local-fixture', 'fixture')!;
  expect(model).toBeDefined();
  expect(runtime.getModel('local-fixture', 'missing')).toBeUndefined();
  expect(() => requireModel(runtime, { provider: 'local-fixture', id: 'missing' })).toThrow('MODEL_UNAVAILABLE');
  let answer!: (value: string) => void;
  let opened!: () => void;
  const questionOpened = new Promise<void>(resolve => { opened = resolve; });
  const contact: ToolDefinition = {
    name: 'contact_main', label: 'Contact main', description: 'Ask main', parameters: Type.Object({ message: Type.String() }),
    async execute() { opened(); const text = await new Promise<string>(resolve => { answer = resolve; }); return { content: [{ type: 'text', text }], details: {} }; },
  };
  const resources = await isolatedResources(cwd, agentDir, skills);
  const guardedWrites: { path: string; content: string }[] = [];
  const writer = createWriteToolDefinition(cwd, { operations: {
    mkdir: async () => {},
    writeFile: async (path, content) => { guardedWrites.push({ path, content }); },
  } });
  const manager = SessionManager.create(cwd, join(root, 'sessions'));
  const { session } = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, model, tools: ['contact_main', 'read', 'write'],
    customTools: [contact, writer as unknown as ToolDefinition, { name: 'read', label: 'Guarded read', description: 'Fixture guard', parameters: Type.Object({ path: Type.String() }), execute: async () => { throw new Error('Fixture read must not execute'); } }],
    resourceLoader: resources.loader, settingsManager: resources.settingsManager, sessionManager: manager, thinkingLevel: 'high' });
  // Upstream clamps: production must reject this mismatch before inference.
  expect(session.thinkingLevel).toBe('off');
  expect(() => confirmIdentity(session, { provider: 'local-fixture', id: 'fixture' }, 'high')).toThrow('UNSUPPORTED_THINKING');
  expect(() => confirmIdentity(session, { provider: 'other', id: 'fixture' })).toThrow('MODEL_CONFIGURATION_MISMATCH');
  expect(calls).toBe(0);
  expect(session.getActiveToolNames().sort()).toEqual(['contact_main', 'read', 'write']);
  const prompt = session.prompt('/skill:one literal task', { expandPromptTemplates: false });
  await Promise.race([questionOpened, prompt.then(() => { throw new Error('Prompt ended before question: ' + JSON.stringify(session.messages)); })]);
  expect(session.isIdle).toBe(false);
  expect(guardedWrites).toEqual([{ path: join(cwd, 'guarded.txt'), content: 'data only' }]);
  await expect(readFile(join(cwd, 'guarded.txt'))).rejects.toThrow();
  await session.prompt('/skill:two literal steering', { streamingBehavior: 'steer', expandPromptTemplates: false });
  answer('correlated answer');
  await prompt;
  expect(session.isIdle).toBe(true);
  expect(JSON.stringify(requests)).not.toMatch(/AMBIENT_POISON|BODY_POISON/);
  expect(requests[0]?.systemPrompt).toContain('selected one');
  expect(requests[0]?.systemPrompt).toContain('selected two');
  expect(JSON.stringify(requests)).toContain('/skill:two literal steering');
  expect(JSON.stringify(requests)).toContain('correlated answer');
  const file = manager.getSessionFile()!;
  expect(await readFile(file, 'utf8')).toContain('correlated answer');
  session.dispose();
  const empty = await isolatedResources(cwd, agentDir);
  const reopened = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, model, tools: [], resourceLoader: empty.loader,
    settingsManager: empty.settingsManager, sessionManager: SessionManager.open(file) });
  await reopened.session.prompt('continue explicitly', { expandPromptTemplates: false });
  expect(requests.at(-1)?.systemPrompt).not.toContain('selected one');
  expect(JSON.stringify(requests.at(-1))).toContain('correlated answer');
  expect(reopened.session.isIdle).toBe(true);
  reopened.session.dispose();
}, 30000);
