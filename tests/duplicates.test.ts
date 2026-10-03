import { describe, expect, it } from 'vitest';
import { createTestContext, ACME } from './helpers';
import { payload, sample } from './samples';

describe('duplicate detection', () => {
  it('marks an identical ticket from the same customer as a duplicate (sample #5 of #1)', async () => {
    const ctx = createTestContext();
    const first = await ctx.submit(ACME, payload(sample(1)));
    const second = await ctx.submit(ACME, payload(sample(5)));
    await ctx.worker.drain();

    const original = (await ctx.getTicket(ACME, first.body.id)).body;
    const duplicate = (await ctx.getTicket(ACME, second.body.id)).body;

    expect(original.duplicateOf).toBeNull();
    expect(original.duplicateScore).toBeNull();
    expect(duplicate.duplicateOf).toBe(first.body.id);
    expect(duplicate.duplicateScore).toBe(1);
    // A duplicate is still triaged as normal.
    expect(duplicate.status).toBe('triaged');
    expect(duplicate.triage.category).toBe('billing');
  });

  it('does not match a different customer with the same text (sample #7)', async () => {
    const ctx = createTestContext();
    await ctx.submit(ACME, payload(sample(1)));
    const other = await ctx.submit(ACME, payload(sample(7)));
    await ctx.worker.drain();

    expect((await ctx.getTicket(ACME, other.body.id)).body.duplicateOf).toBeNull();
  });

  it('does not match different wording below the threshold (sample #6)', async () => {
    const ctx = createTestContext();
    await ctx.submit(ACME, payload(sample(1)));
    const reworded = await ctx.submit(ACME, payload(sample(6)));
    await ctx.worker.drain();

    const ticket = (await ctx.getTicket(ACME, reworded.body.id)).body;
    expect(ticket.duplicateOf).toBeNull();
    expect(ticket.duplicateScore).toBeNull();
  });

  it('points a third copy to the original, so chains never form', async () => {
    const ctx = createTestContext();
    const first = await ctx.submit(ACME, payload(sample(1)));
    const second = await ctx.submit(ACME, payload(sample(1)));
    const third = await ctx.submit(ACME, payload(sample(1)));
    await ctx.worker.drain();

    expect((await ctx.getTicket(ACME, second.body.id)).body.duplicateOf).toBe(first.body.id);
    expect((await ctx.getTicket(ACME, third.body.id)).body.duplicateOf).toBe(first.body.id);
  });

  it('ignores tickets created more than 7 days earlier', async () => {
    const ctx = createTestContext();
    const old = await ctx.submit(ACME, payload(sample(1)));
    await ctx.worker.drain();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    ctx.db.prepare('UPDATE tickets SET created_at = ? WHERE id = ?').run(eightDaysAgo, old.body.id);

    const fresh = await ctx.submit(ACME, payload(sample(1)));
    await ctx.worker.drain();

    expect((await ctx.getTicket(ACME, fresh.body.id)).body.duplicateOf).toBeNull();
  });

  it('uses DUPLICATE_THRESHOLD from the config', async () => {
    const ctx = createTestContext({ config: { duplicateThreshold: 0.3 } });
    const first = await ctx.submit(ACME, payload(sample(1)));
    const reworded = await ctx.submit(ACME, payload(sample(6)));
    await ctx.worker.drain();

    const ticket = (await ctx.getTicket(ACME, reworded.body.id)).body;
    expect(ticket.duplicateOf).toBe(first.body.id);
    expect(ticket.duplicateScore).toBeGreaterThanOrEqual(0.3);
    expect(ticket.duplicateScore).toBeLessThan(0.9);
  });
});
