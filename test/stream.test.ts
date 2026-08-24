/**
 * `src/stream.ts` — the SSE pass-through, tested on its own.
 *
 * Mirrors `test/egress.test.ts`: exercise the module directly, no gateway.
 * A bare Fastify route stands in for the chat route so the helper is driven
 * through a real `FastifyReply`, and `app.inject` collects what a client
 * would have received.
 */
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { isEventStream, pipeSseResponse, SSE_CONTENT_TYPE, type StreamPipeResult } from '../src/stream.ts';

/** An upstream answer whose body arrives in the given pieces, one at a time. */
function streamingResponse(
  pieces: string[],
  init: ResponseInit = { headers: { 'content-type': 'text/event-stream' } },
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = pieces.shift();
      if (next === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next));
    },
  });
  return new Response(body, init);
}

/** Drive `pipeSseResponse` through one request and report both sides. */
async function pipeThrough(
  response: Response,
): Promise<{ status: number; headers: Record<string, unknown>; payload: string; result: StreamPipeResult }> {
  const app = Fastify({ logger: false });
  let result: StreamPipeResult | undefined;

  app.get('/s', async (_request, reply) => {
    result = await pipeSseResponse(reply, response);
    return reply;
  });

  try {
    const injected = await app.inject({ method: 'GET', url: '/s' });
    if (result === undefined) throw new Error('pipeSseResponse never resolved');
    return {
      status: injected.statusCode,
      headers: injected.headers as Record<string, unknown>,
      payload: injected.payload,
      result,
    };
  } finally {
    await app.close();
  }
}

describe('isEventStream', () => {
  it('recognises an SSE answer and rejects a JSON one', () => {
    expect(isEventStream(new Response('', { headers: { 'content-type': 'text/event-stream' } }))).toBe(true);
    expect(
      isEventStream(new Response('', { headers: { 'content-type': 'TEXT/EVENT-STREAM; charset=utf-8' } })),
    ).toBe(true);
    expect(isEventStream(new Response('{}', { headers: { 'content-type': 'application/json' } }))).toBe(false);
    expect(isEventStream(new Response(null, { status: 204 }))).toBe(false);
  });
});

describe('pipeSseResponse', () => {
  it('forwards every chunk unmodified, in order', async () => {
    const frames = ['data: one\n\n', 'data: two\n\n', 'data: [DONE]\n\n'];
    const piped = await pipeThrough(streamingResponse([...frames]));

    expect(piped.status).toBe(200);
    expect(piped.payload).toBe(frames.join(''));
    expect(piped.result.chunks).toBe(3);
    expect(piped.result.bytes).toBe(Buffer.byteLength(frames.join('')));
    expect(piped.result.aborted).toBe(false);
  });

  it('sets the streaming headers a proxy in the middle needs to see', async () => {
    const piped = await pipeThrough(streamingResponse(['data: x\n\n']));

    expect(String(piped.headers['content-type'])).toContain('text/event-stream');
    expect(String(piped.headers['cache-control'])).toContain('no-cache');
    expect(piped.headers['x-accel-buffering']).toBe('no');
  });

  it('keeps the upstream status and content type when the answer is not a stream', async () => {
    const piped = await pipeThrough(
      streamingResponse(['{"error":"nope"}'], {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    );

    expect(piped.status).toBe(400);
    expect(String(piped.headers['content-type'])).toContain('application/json');
    expect(piped.payload).toBe('{"error":"nope"}');
  });

  it('falls back to the SSE content type when the upstream sends none', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: x\n\n'));
        controller.close();
      },
    });
    const response = new Response(body);
    response.headers.delete('content-type');

    const piped = await pipeThrough(response);
    expect(String(piped.headers['content-type'])).toBe(SSE_CONTENT_TYPE);
  });

  it('ends the response cleanly when the upstream has no body', async () => {
    const piped = await pipeThrough(new Response(null, { status: 204 }));

    expect(piped.result).toEqual({ chunks: 0, bytes: 0, aborted: false });
    expect(piped.payload).toBe('');
  });

  it('reports a mid-stream upstream failure as aborted and keeps the bytes already sent', async () => {
    const encoder = new TextEncoder();
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(encoder.encode('data: half\n\n'));
          return;
        }
        controller.error(new Error('upstream died'));
      },
    });

    const piped = await pipeThrough(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));

    expect(piped.payload).toBe('data: half\n\n');
    expect(piped.result.chunks).toBe(1);
    expect(piped.result.aborted).toBe(true);
  });
});
