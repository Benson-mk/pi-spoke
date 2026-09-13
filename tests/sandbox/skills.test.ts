import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { httpProvider } from '../fixtures/http-provider.js';
import { parseConfig } from '../../src/config.js';
import { createApplication } from '../../src/app.js';

test('P3: two optional skills remain unread; selected external resources are sandbox-readable and immutable', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ps-expert-')), cwd = join(root, 'p'), skills = join(root, 'skills'); await mkdir(cwd);
  for (const name of ['alpha','beta']) {
    await mkdir(join(skills, name), { recursive: true });
    await writeFile(join(skills, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} expertise\n---\nPRIVATE_BODY_${name}\n`);
  }
  const file = join(skills, 'alpha', 'SKILL.md'), original = await readFile(file, 'utf8');
  const provider = await httpProvider((_request, index) => {
    if (index === 2) return { tool: { name: 'read', arguments: { path: file } } };
    if (index === 3) return { tool: { name: 'write', arguments: { path: file, content: 'unauthorized improvement' } } };
    return { text: 'done without mandatory skill use' };
  });
  const models = join(root, 'models.json'); await writeFile(models, JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: provider.url, apiKey: 'fake',
    models: [{ id: 'model', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 4096 }] } } }));
  const config = parseConfig({ version: 2, state_dir: join(root, 's'), scratch_dir: join(root, 't'), workspace_roots: [cwd], allowed_tools: ['read','write'],
    permissions: { file_write_roots: [cwd] }, skill_roots: [{ id: 'approved', path: skills }],
    pi: { auth_path: join(root, 'auth'), models_path: models }, sandbox: { backend: 'srt', required: true, tool_network: 'none' } });
  const app = await createApplication(config, join(root, 'config.json'), 'test');
  try {
    const input = { request_key: 'optional', task: 'decide independently', cwd, tools: ['read'], model: { provider: 'fixture', id: 'model' }, suggested_skills: ['approved:alpha','approved:beta'] };
    const first = await app.service.spawn(input); await app.service.drain();
    expect(app.store.getRun(first.run_id)?.state).toBe('completed'); expect(app.store.invocations(first.run_id)).toEqual([]);
    expect(JSON.stringify(provider.requests[0])).toContain('alpha expertise'); expect(JSON.stringify(provider.requests[0])).not.toContain('PRIVATE_BODY_');
    const second = await app.service.send({ kind: 'continue', request_key: 'clear', session_id: first.session_id, expected_last_run_id: first.run_id, message: 'continue', suggested_skills: [] });
    await app.service.drain(); expect(app.store.getRun(second.run_id)?.state).toBe('completed');
    expect(JSON.stringify(provider.requests[1])).not.toContain('alpha expertise');
    const third = await app.service.spawn({ ...input, request_key: 'read', tools: ['read','write'], permissions: { file_write_roots: [cwd] } });
    await app.service.drain(); expect(app.store.getRun(third.run_id)?.state).toBe('completed');
    expect(JSON.stringify(provider.requests[3])).toContain('PRIVATE_BODY_alpha');
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(app.store.invocations(third.run_id)).toHaveLength(2);
    await writeFile(file, original + 'changed');
    await expect(app.service.send({ kind: 'continue', request_key: 'changed', session_id: third.session_id, expected_last_run_id: third.run_id, message: 'again' })).rejects.toMatchObject({ code: 'RESOURCE_CHANGED' });
  } finally { await app.close(); await provider.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
