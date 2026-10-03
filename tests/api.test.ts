import { describe, expect, it } from 'vitest';
import { claimNextQueued } from '../src/tickets';
import { createTestContext, ACME, BETA } from './helpers';
import { SAMPLES, payload, sample } from './samples';

describe('POST /tickets', () => {
  it('returns 202 with a queued ticket, before any LLM work', async () => {
    const ctx = createTestContext();
    const created = await ctx.submit(ACME, payload(sample(1)));

    expect(created.status).toBe(202);
    expect(created.body).toEqual({ id: expect.any(String), status: 'queued' });
    const fetched = (await ctx.getTicket(ACME, created.body.id)).body;
    expect(fetched.status).toBe('queued');
    expect(fetched.triage).toBeNull();
    expect(fetched.llmAttempts).toBe(0);
  });

  it('rejects invalid input with 400 and per-field errors', async () => {
    const ctx = createTestContext();
    const res = await ctx.submit(ACME, { subject: ' a ', body: 'too short', customerEmail: 'nope', channel: 'fax' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(Object.keys(res.body.fields).sort()).toEqual(['body', 'channel', 'customerEmail', 'subject']);
  });

  it('trims text, lowercases the email and defaults the channel to web', async () => {
    const ctx = createTestContext();
    const created = await ctx.submit(ACME, {
      subject: '  Charged twice  ',
      body: '  I was billed $49 twice this month.  ',
      customerEmail: ' Ana@Acme.IO ',
    });
    const ticket = (await ctx.getTicket(ACME, created.body.id)).body;

    expect(ticket.subject).toBe('Charged twice');
    expect(ticket.body).toBe('I was billed $49 twice this month.');
    expect(ticket.customerEmail).toBe('ana@acme.io');
    expect(ticket.channel).toBe('web');
  });

  it('never returns the embedding or the tenant id', async () => {
    const ctx = createTestContext();
    const created = await ctx.submit(ACME, payload(sample(1)));
    await ctx.worker.drain();
    const ticket = (await ctx.getTicket(ACME, created.body.id)).body;

    expect(ticket).not.toHaveProperty('embedding');
    expect(ticket).not.toHaveProperty('tenantId');
  });
});

describe('Idempotency-Key', () => {
  it('returns the original ticket and creates no second job', async () => {
    const ctx = createTestContext();
    const first = await ctx.submit(ACME, payload(sample(1)), 'key-123');
    const repeat = await ctx.submit(ACME, payload(sample(1)), 'key-123');

    expect(repeat.status).toBe(202);
    expect(repeat.body.id).toBe(first.body.id);
    const count = ctx.db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('scopes the key to the tenant', async () => {
    const ctx = createTestContext();
    const acme = await ctx.submit(ACME, payload(sample(1)), 'shared-key');
    const beta = await ctx.submit(BETA, payload(sample(11)), 'shared-key');

    expect(beta.body.id).not.toBe(acme.body.id);
  });
});

describe('worker', () => {
  it('classifies every sample ticket as the task expects', async () => {
    const ctx = createTestContext();
    const ids: string[] = [];
    for (const s of SAMPLES) ids.push((await ctx.submit(s.apiKey, payload(s))).body.id);
    await ctx.worker.drain();

    for (const [index, s] of SAMPLES.entries()) {
      const ticket = (await ctx.getTicket(s.apiKey, ids[index])).body;
      expect(ticket.status, `sample #${s.n}`).toBe('triaged');
      expect(ticket.triage.category, `sample #${s.n}`).toBe(s.expected.category);
      expect(ticket.triage.priority, `sample #${s.n}`).toBe(s.expected.priority);
    }
  });

  it('picks up a ticket left in processing by a crashed worker', async () => {
    const ctx = createTestContext();
    const created = await ctx.submit(ACME, payload(sample(1)));
    // Simulate the crash: the ticket was claimed, then the process died.
    expect(claimNextQueued(ctx.db)?.id).toBe(created.body.id);
    expect((await ctx.getTicket(ACME, created.body.id)).body.status).toBe('processing');

    // A fresh worker starts, as it would after a restart.
    ctx.worker.start();
    await ctx.worker.drain();
    ctx.worker.stop();

    expect((await ctx.getTicket(ACME, created.body.id)).body.status).toBe('triaged');
  });
});

describe('GET /tickets/search', () => {
  it('ranks the expected sample tickets first', async () => {
    const ctx = createTestContext();
    const numberById = new Map<string, number>();
    for (const s of SAMPLES) numberById.set((await ctx.submit(s.apiKey, payload(s))).body.id, s.n);
    await ctx.worker.drain();

    const top = async (q: string, limit: number): Promise<number[]> => {
      const res = await ctx.search(ACME, { q, limit });
      return res.body.results.map((r: { id: string }) => numberById.get(r.id));
    };

    expect((await top('refund double charge', 4)).sort()).toEqual([1, 5, 6, 7]);
    expect((await top('android login crash', 1))[0]).toBe(2);
    expect((await top('csv export timeout', 1))[0]).toBe(8);
  });

  it('returns the documented shape, sorted by score with 4 decimals', async () => {
    const ctx = createTestContext();
    for (const n of [1, 2, 6]) await ctx.submit(ACME, payload(sample(n)));
    await ctx.worker.drain();

    const res = await ctx.search(ACME, { q: 'refund double charge' });
    expect(res.status).toBe(200);
    expect(res.body.query).toBe('refund double charge');
    expect(Object.keys(res.body.results[0]).sort()).toEqual(['category', 'id', 'score', 'status', 'subject']);

    const scores: number[] = res.body.results.map((r: { score: number }) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    for (const score of scores) expect(score).toBe(Math.round(score * 10_000) / 10_000);
  });

  it('validates q and limit', async () => {
    const ctx = createTestContext();

    expect((await ctx.search(ACME, { q: 'a' })).status).toBe(400);
    expect((await ctx.search(ACME, { q: 'refund', limit: 21 })).status).toBe(400);
    expect((await ctx.search(ACME, { q: 'refund', limit: 0 })).status).toBe(400);
    expect((await ctx.search(ACME, { q: 'refund' })).status).toBe(200);
  });
});
