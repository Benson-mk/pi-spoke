import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Api } from '../api.js';
import { catalogSchema, spawnSchema, sendSchema, observeSchema, cancelSchema, sessionsSchema } from '../contracts.js';
import { SpokeError } from '../core/errors.js';

const definitions = [
  ['catalog', catalogSchema, 'Discover explicit Pi models, optional approved skill metadata, or sandboxed tool capabilities and permission ceilings. No inference.'],
  ['spawn', spawnSchema, 'Start an independent Pi worker with an explicit model and self-contained task. Skills are optional. Write roots are independent explicit grants. Returns a durable receipt before readiness; no automatic replay.'],
  ['observe', observeSchema, 'Read status, correlated questions, durable events, or paged output. Waiting is bounded to 25 seconds and never resumes or instructs a worker.'],
  ['send', sendSchema, 'Steer a running worker, reply to the exact pending question, or explicitly continue a saved session using expected_last_run_id. Text never enlarges permissions. Reuse request keys only for identical requests.'],
  ['cancel', cancelSchema, 'Stop one run without rollback or session deletion. Repeated cancellation is safe. Unconfirmed cleanup stays interrupted; siblings continue.'],
  ['sessions', sessionsSchema, 'List this instance’s saved sessions and current continuation eligibility without starting workers.'],
] as const;

export function mcpServer(api: Api) {
  const server = new Server({ name: 'pi-spoke', version: '0.1.0' }, { capabilities: { tools: {} },
    instructions: 'Delegation is optional. Choose the model explicitly; suggest zero or more skills. File and shell write grants are independent. Observe without adding turns. Reply to correlated questions. Never infer successful cleanup or replay uncertain work. The main agent remains responsible for verification and integration.' });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions.map(([name, schema, description]) => ({
    name: 'spoke_' + name, description,
    inputSchema: { ...z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }), type: 'object' } as Tool['inputSchema'],
    annotations: { readOnlyHint: ['catalog','observe','sessions'].includes(name), destructiveHint: ['spawn','send','cancel'].includes(name), idempotentHint: true, openWorldHint: ['spawn','send'].includes(name) },
  })) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const entry = definitions.find(([name]) => 'spoke_' + name === request.params.name);
      if (!entry) throw new SpokeError('INVALID_ARGUMENT', 'Unknown tool');
      const data = await api[entry[0]](request.params.arguments ?? {});
      const serialized = JSON.stringify(data);
      return { structuredContent: data, content: [{ type: 'text', text: serialized.length <= 1024 ? serialized : JSON.stringify({ protocol_version: 1, tool: request.params.name, summary: 'Result is in structuredContent.', ...('state' in data ? { state: data.state } : {}), ...('run_id' in data ? { run_id: data.run_id } : {}) }) }] };
    } catch (error) {
      const safe = error instanceof SpokeError ? error : new SpokeError('INTERNAL_ERROR');
      const data = { protocol_version: 1, error: { code: safe.code, message: safe.message, safe_to_retry_same_request: safe.safeToRetrySameRequest } };
      return { isError: true, structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  });
  return server;
}
