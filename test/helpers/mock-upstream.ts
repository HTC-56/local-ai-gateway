/**
 * An in-process OpenAI-compatible upstream for the integration tests.
 *
 * Deterministic, CI-safe, no GPU, no model (SPEC.md gates). Start one per
 * test, point a backend's `baseUrl` at `upstream.baseUrl`, and assert against
 * `upstream.requests` afterwards.
 *
 *   const upstream = await startMockUpstream({ models: ['mock-model'] });
 *   try { ... } finally { await upstream.close(); }
 */
import Fastify from 'fastify';

export type RecordedRequest = {
  method: string;
  url: string;
  authorization: string | null;
  body: unknown;
};

export type ChatRequestBody = {
  model?: string;
  messages?: unknown;
  stream?: boolean;
  [key: string]: unknown;
};

export type MockUpstreamOptions = {
  /** Model ids served by `GET /v1/models`. Default `['mock-model']`. */
  models?: string[];
  /** Status for `POST /v1/chat/completions`. Default 200. */
  chatStatus?: number;
  /** Assistant text in the default reply. Default `'mock reply'`. */
  content?: string;
  /** Full control over the chat reply body; overrides `content`. */
  chatBody?: (body: ChatRequestBody) => unknown;
};

export type MockUpstream = {
  /** e.g. `http://127.0.0.1:54321` */
  origin: string;
  /** e.g. `http://127.0.0.1:54321/v1` — what a backend's `baseUrl` should be. */
  baseUrl: string;
  /** Every request this upstream received, in order. */
  requests: RecordedRequest[];
  close(): Promise<void>;
};

function defaultChatBody(body: ChatRequestBody, content: string): unknown {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: 1700000000,
    model: body.model ?? 'mock-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

export async function startMockUpstream(
  options: MockUpstreamOptions = {},
): Promise<MockUpstream> {
  const models = options.models ?? ['mock-model'];
  const chatStatus = options.chatStatus ?? 200;
  const content = options.content ?? 'mock reply';
  const requests: RecordedRequest[] = [];

  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (request) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
      body: null,
    });
  });

  app.get('/v1/models', async () => ({
    object: 'list',
    data: models.map((id) => ({
      id,
      object: 'model',
      created: 1700000000,
      owned_by: 'mock',
    })),
  }));

  app.post('/v1/chat/completions', async (request, reply) => {
    const body = (request.body ?? {}) as ChatRequestBody;
    const last = requests.at(-1);
    if (last) last.body = body;
    return reply
      .status(chatStatus)
      .send(options.chatBody ? options.chatBody(body) : defaultChatBody(body, content));
  });

  await app.listen({ host: '127.0.0.1', port: 0 });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    await app.close();
    throw new Error('mock upstream did not bind a TCP port');
  }
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    baseUrl: `${origin}/v1`,
    requests,
    close: () => app.close(),
  };
}
