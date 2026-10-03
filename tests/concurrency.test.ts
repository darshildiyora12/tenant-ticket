import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import type { LLMProvider } from '../src/providers/types';
import { createTestContext, ACME } from './helpers';

/** An LLM that records how many calls were running at the same time. */
function countingLLM() {
  const stats = { inFlight: 0, maxInFlight: 0, calls: 0 };
  const llm: LLMProvider = {
    name: 'counting-llm',
    async classify(subject) {
      stats.calls++;
      stats.inFlight++;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      await sleep(20);
      stats.inFlight--;
      return JSON.stringify({ category: 'other', priority: 'low', summary: subject, confidence: 0.9 });
    },
  };
  return { llm, stats };
}

async function submitTickets(ctx: ReturnType<typeof createTestContext>, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await ctx.submit(ACME, {
      subject: `Question number ${i}`,
      body: `This is the body of question number ${i}.`,
      customerEmail: `user${i}@acme.io`,
    });
  }
}

describe('LLM concurrency limit', () => {
  it('runs at most 3 LLM calls at once and still finishes every ticket', async () => {
    const { llm, stats } = countingLLM();
    const ctx = createTestContext({ llm });
    await submitTickets(ctx, 10);
    await ctx.worker.drain();

    expect(stats.maxInFlight).toBe(3);
    expect(stats.calls).toBe(10);
    const triaged = ctx.db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status = 'triaged'").get() as { n: number };
    expect(triaged.n).toBe(10);
  });

  it('follows LLM_MAX_CONCURRENCY', async () => {
    const { llm, stats } = countingLLM();
    const ctx = createTestContext({ llm, config: { llmMaxConcurrency: 1 } });
    await submitTickets(ctx, 4);
    await ctx.worker.drain();

    expect(stats.maxInFlight).toBe(1);
    expect(stats.calls).toBe(4);
  });
});
