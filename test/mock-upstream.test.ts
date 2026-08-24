/** The mock upstream is test infrastructure; these tests keep it honest. */
import { describe, expect, it } from 'vitest';
import { startMockUpstream } from './helpers/mock-upstream.ts';

describe('startMockUpstream', () => {
  it('serves the configured model list', async () => {
    const upstream = await startMockUpstream({ models: ['a-model', 'b-model'] });
    try {
      const response = await fetch(`${upstream.baseUrl}/models`);
      const body = (await response.json()) as { object: string; data: { id: string }[] };

      expect(response.status).toBe(200);
      expect(body.object).toBe('list');
      expect(body.data.map((m) => m.id)).toEqual(['a-model', 'b-model']);
    } finally {
      await upstream.close();
    }
  });

  it('answers chat completions and records what it received', async () => {
    const upstream = await startMockUpstream({ content: 'hello from mock' });
    try {
      const response = await fetch(`${upstream.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: JSON.stringify({ model: 'mock-model', messages: [{ role: 'user', content: 'hi' }] }),
      });
      const body = (await response.json()) as {
        model: string;
        choices: { message: { content: string } }[];
      };

      expect(response.status).toBe(200);
      expect(body.model).toBe('mock-model');
      expect(body.choices[0]?.message.content).toBe('hello from mock');

      const recorded = upstream.requests.at(-1);
      expect(recorded?.url).toBe('/v1/chat/completions');
      expect(recorded?.authorization).toBe('Bearer t');
      expect(recorded?.body).toMatchObject({ model: 'mock-model' });
    } finally {
      await upstream.close();
    }
  });
});
