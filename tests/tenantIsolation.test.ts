import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestContext, ACME, BETA } from './helpers';
import { payload, sample } from './samples';

describe('tenant auth and isolation', () => {
  it('returns 401 for a missing or unknown API key', async () => {
    const ctx = createTestContext();

    const missing = await request(ctx.app).post('/tickets').send(payload(sample(1)));
    const unknown = await ctx.submit('key_nobody', payload(sample(1)));
    const search = await request(ctx.app).get('/tickets/search').query({ q: 'refund' });

    expect(missing.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(search.status).toBe(401);
  });

  it("returns 404 for another tenant's ticket", async () => {
    const ctx = createTestContext();
    const acmeTicket = await ctx.submit(ACME, payload(sample(1)));
    const betaTicket = await ctx.submit(BETA, payload(sample(11)));
    await ctx.worker.drain();

    expect((await ctx.getTicket(ACME, acmeTicket.body.id)).status).toBe(200);
    expect((await ctx.getTicket(BETA, acmeTicket.body.id)).status).toBe(404);
    expect((await ctx.getTicket(ACME, betaTicket.body.id)).status).toBe(404);
    expect((await ctx.getTicket(BETA, betaTicket.body.id)).status).toBe(200);
  });

  it('ignores tenantId, status and priority sent in the request body', async () => {
    const ctx = createTestContext();
    const created = await ctx.submit(ACME, {
      ...payload(sample(1)),
      tenantId: 'beta',
      status: 'triaged',
      priority: 'urgent',
    });

    expect(created.body.status).toBe('queued');
    expect((await ctx.getTicket(ACME, created.body.id)).status).toBe(200);
    expect((await ctx.getTicket(BETA, created.body.id)).status).toBe(404);
  });

  it("never shows another tenant's tickets in search results", async () => {
    const ctx = createTestContext();
    const acmeIds: string[] = [];
    for (const n of [1, 6, 7]) acmeIds.push((await ctx.submit(ACME, payload(sample(n)))).body.id);
    const betaId = (await ctx.submit(BETA, payload(sample(11)))).body.id;
    await ctx.worker.drain();

    const acmeResults = (await ctx.search(ACME, { q: 'refund double charge', limit: 20 })).body.results;
    const betaResults = (await ctx.search(BETA, { q: 'refund double charge', limit: 20 })).body.results;

    expect(acmeResults.map((r: { id: string }) => r.id).sort()).toEqual([...acmeIds].sort());
    expect(betaResults.map((r: { id: string }) => r.id)).toEqual([betaId]);
  });

  it("does not treat another tenant's identical ticket as a duplicate", async () => {
    const ctx = createTestContext();
    await ctx.submit(ACME, { ...payload(sample(1)), customerEmail: 'zoe@beta.co' });
    const betaTicket = await ctx.submit(BETA, payload(sample(11)));
    await ctx.worker.drain();

    const fetched = await ctx.getTicket(BETA, betaTicket.body.id);
    expect(fetched.body.duplicateOf).toBeNull();
  });
});
