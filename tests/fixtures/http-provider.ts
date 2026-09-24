import { createServer } from 'node:http';
export type FakeRequest = { messages: { role: string; content?: unknown; tool_calls?: unknown[] }[]; model: string };
export async function httpProvider(reply: (request: FakeRequest, index: number) => { text?: string; tool?: { name: string; arguments: object }; delay?: number; finishReason?: 'stop' | 'length'; status?: number; errorBody?: string }) {
  const requests: FakeRequest[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const bytes of req) body += bytes;
    const request = JSON.parse(body) as FakeRequest; const response = reply(request, requests.length); requests.push(request);
    if (response.delay) await new Promise<void>(resolve => { const timer = setTimeout(resolve, response.delay); res.once('close', () => { clearTimeout(timer); resolve(); }); });
    if (res.destroyed) return;
    if (response.status) { res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: response.errorBody ?? 'synthetic provider failure' } })); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const chunk = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'fixture-' + requests.length,
      object: 'chat.completion.chunk', created: 1, model: request.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    chunk({ role: 'assistant' });
    if (response.tool) chunk({ tool_calls: [{ index: 0, id: 'call-' + requests.length, type: 'function',
      function: { name: response.tool.name, arguments: JSON.stringify(response.tool.arguments) } }] });
    else chunk({ content: response.text ?? 'done' });
    chunk({}, response.tool ? 'tool_calls' : response.finishReason ?? 'stop'); res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No fake listener');
  return { url: `http://127.0.0.1:${address.port}/v1`, requests,
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
