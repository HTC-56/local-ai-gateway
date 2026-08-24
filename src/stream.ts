/**
 * SSE streaming pass-through (SPEC.md feature 4).
 *
 * The gateway does not parse, re-frame or buffer a token stream. Once an
 * upstream has answered with headers, its bytes are written to the client in
 * the order they arrive and nothing else happens to them — "chunk-for-chunk"
 * in the spec means literally that.
 *
 * Failover therefore applies at request START only. The moment the first byte
 * of a stream is on the wire the gateway is committed to that backend: there
 * is no mid-stream splice, because splicing would mean inventing tokens the
 * second backend never produced. A backend that dies mid-stream ends the
 * client's stream early, and the client retries. This is a documented
 * limitation (README "Limitations", SPEC.md non-goals), not an oversight.
 */
import type { FastifyReply } from 'fastify';
import type { ServerResponse } from 'node:http';

/** What a stream answer is served as when the upstream does not say. */
export const SSE_CONTENT_TYPE = 'text/event-stream; charset=utf-8';

export type StreamPipeResult = {
  /** Upstream chunks forwarded, unmodified. */
  chunks: number;
  /** Bytes forwarded. */
  bytes: number;
  /** True when the client hung up or the upstream cut the stream short. */
  aborted: boolean;
};

/** True when this upstream answer is an SSE stream rather than a JSON body. */
export function isEventStream(response: Response): boolean {
  const type = response.headers.get('content-type');
  return type !== null && type.toLowerCase().includes('text/event-stream');
}

/**
 * Write one chunk, respecting backpressure. Resolves false when the socket is
 * gone, which is the signal to stop reading the upstream.
 */
async function writeChunk(raw: ServerResponse, chunk: Uint8Array): Promise<boolean> {
  if (raw.writableEnded || raw.destroyed) return false;
  if (raw.write(chunk)) return true;

  await new Promise<void>((resolve) => {
    const settle = (): void => {
      raw.off('drain', settle);
      raw.off('close', settle);
      raw.off('error', settle);
      resolve();
    };
    raw.once('drain', settle);
    raw.once('close', settle);
    raw.once('error', settle);
  });

  return !raw.writableEnded && !raw.destroyed;
}

/**
 * Forward an upstream streaming answer to the client byte for byte.
 *
 * Takes over the reply (`reply.hijack()`), so the caller must not send
 * anything else on it afterwards — return `reply` from the route handler.
 *
 * The upstream's own `content-type` is preserved when it has one, so an
 * upstream that answers a `stream: true` request with a JSON error still
 * reaches the client labelled as JSON.
 *
 * Never throws. A stream that dies half-way is reported as `aborted`; the
 * client keeps the bytes it already received.
 */
export async function pipeSseResponse(
  reply: FastifyReply,
  response: Response,
): Promise<StreamPipeResult> {
  const raw = reply.raw;
  const result: StreamPipeResult = { chunks: 0, bytes: 0, aborted: false };

  raw.statusCode = response.status;
  raw.setHeader('content-type', response.headers.get('content-type') ?? SSE_CONTENT_TYPE);
  raw.setHeader('cache-control', 'no-cache, no-transform');
  // Reverse proxies buffer proxied bodies by default, which turns a token
  // stream into one late blob. This is the header that asks them not to.
  raw.setHeader('x-accel-buffering', 'no');
  reply.hijack();

  const body = response.body;
  if (body === null) {
    raw.end();
    return result;
  }

  const reader = body.getReader();
  let clientGone = false;
  const onClose = (): void => {
    clientGone = true;
    void reader.cancel().catch(() => {});
  };
  raw.once('close', onClose);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      if (!(await writeChunk(raw, value))) {
        result.aborted = true;
        break;
      }
      result.chunks += 1;
      result.bytes += value.byteLength;
    }
  } catch {
    // Upstream cut the stream. Nothing to say to the client but goodbye.
    result.aborted = true;
  } finally {
    raw.off('close', onClose);
    if (!raw.writableEnded) raw.end();
  }

  if (clientGone) result.aborted = true;
  return result;
}
