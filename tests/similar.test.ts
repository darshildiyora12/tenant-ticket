import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ClassifyOptions, LLMProvider } from '../src/providers/types';
import { MockLLM } from '../src/providers/mockLLM';
import { createTestContext, ACME, BETA } from './helpers';
import { payload, sample } from './samples';

describe('GET /tickets/:id/similar', () => {
  it('returns the 3 most similar triaged tickets of the same tenant, without the ticket itself', async () => {
    const ctx = createTestContext();
    const ids = new Map<number, string>();
    for (const n of [1, 2, 3, 6, 7]) ids.set(n, (await ctx.submit(ACME, payload(sample(n)))).body.id);
    const needsReview = await ctx.submit(ACME, {
      subject: 'Charged twice',
      body: `${sample(1).body} [[ALWAYS_BAD]]`,
      customerEmail: 'eve@acme.io',
    });
    await ctx.submit(BETA, payload(sample(11)));
    await ctx.worker.drain();

    const res = await request(ctx.app).get(`/tickets/${ids.get(1)}/similar`).set('x-api-key', ACME);
    const resultIds: string[] = res.body.results.map((r: { id: string }) => r.id);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ids.get(1));
    expect(resultIds).toHaveLength(3);
    expect(resultIds[0]).toBe(ids.get(7)); // identical text from another customer
    expect(resultIds).toContain(ids.get(6));
    expect(resultIds).not.toContain(ids.get(1));
    expect(resultIds).not.toContain(needsReview.body.id); // only triaged tickets
    expect(res.body.results[0].score).toBe(1);
  });

  it("returns 404 for another tenant's ticket", async () => {
    const ctx = createTestContext();
    const created = await ctx.submit(ACME, payload(sample(1)));
    await ctx.worker.drain();

    const res = await request(ctx.app).get(`/tickets/${created.body.id}/similar`).set('x-api-key', BETA);
    expect(res.status).toBe(404);
  });

  it('passes similar triaged tickets to the LLM as examples', async () => {
    const mock = new MockLLM({ minDelayMs: 0, maxDelayMs: 0 });
    const seen: ClassifyOptions[] = [];
    const llm: LLMProvider = {
      name: 'recording-llm',
      classify(subject, body, options = {}) {
        seen.push(options);
        return mock.classify(subject, body, options);
      },
    };
    const ctx = createTestContext({ llm });

    await ctx.submit(ACME, payload(sample(1)));
    await ctx.worker.drain();
    await ctx.submit(ACME, payload(sample(7)));
    await ctx.worker.drain();

    expect(seen[0].examples).toEqual([]);
    expect(seen[1].examples).toEqual([{ subject: 'Charged twice', category: 'billing', priority: 'high' }]);
  });
});
