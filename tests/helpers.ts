import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { openDb } from '../src/db';
import { MockEmbedder } from '../src/providers/mockEmbedder';
import { MockLLM } from '../src/providers/mockLLM';
import type { LLMProvider } from '../src/providers/types';
import { TriageWorker } from '../src/worker';

export const ACME = 'key_acme';
export const BETA = 'key_beta';

/**
 * A full service on an in-memory database. The MockLLM has no delay, and the
 * worker is not started: a test calls worker.drain() when it wants the queue
 * processed, so nothing depends on timing.
 */
export function createTestContext(options: { llm?: LLMProvider; config?: Partial<Config> } = {}) {
  const config: Config = { ...loadConfig({}), llmTimeoutMs: 100, ...options.config };
  const db = openDb(':memory:');
  const embedder = new MockEmbedder();
  const llm = options.llm ?? new MockLLM({ minDelayMs: 0, maxDelayMs: 0, slowDelayMs: 2000 });
  const worker = new TriageWorker({ db, llm, embedder, config });
  const app = createApp({ db, embedder });

  return {
    db,
    app,
    worker,
    config,
    llm,
    embedder,
    submit: (apiKey: string, ticket: object, idempotencyKey?: string) => {
      const req = request(app).post('/tickets').set('x-api-key', apiKey);
      if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
      return req.send(ticket);
    },
    getTicket: (apiKey: string, id: string) => request(app).get(`/tickets/${id}`).set('x-api-key', apiKey),
    search: (apiKey: string, query: Record<string, string | number>) =>
      request(app).get('/tickets/search').set('x-api-key', apiKey).query(query),
  };
}

export type TestContext = ReturnType<typeof createTestContext>;

/** Submits a ticket, lets the worker process the queue, and returns the ticket as the API shows it. */
export async function submitAndTriage(ctx: TestContext, apiKey: string, ticket: object) {
  const created = await ctx.submit(apiKey, ticket);
  await ctx.worker.drain();
  const fetched = await ctx.getTicket(apiKey, created.body.id);
  return fetched.body;
}
