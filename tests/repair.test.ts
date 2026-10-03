import { describe, expect, it } from 'vitest';
import type { ClassifyOptions, LLMProvider } from '../src/providers/types';
import { createTestContext, submitAndTriage, ACME } from './helpers';
import { payload, sample } from './samples';

const ticketWith = (marker: string) => ({
  subject: 'Settings issue',
  body: `Something is off with my account settings. ${marker}`,
  customerEmail: 'tom@acme.io',
});

describe('LLM output validation and repair', () => {
  it('triages a [[MALFORMED]] ticket after exactly one repair (sample #10)', async () => {
    const ctx = createTestContext();
    const ticket = await submitAndTriage(ctx, ACME, payload(sample(10)));

    expect(ticket.status).toBe('triaged');
    expect(ticket.llmAttempts).toBe(2);
    expect(ticket.triageError).toBeNull();
    expect(ticket.triage).toEqual({
      category: 'account',
      priority: 'low',
      summary: 'Settings issue',
      confidence: 0.85,
    });
  });

  it('sends a repair prompt on the retry only', async () => {
    const calls: ClassifyOptions[] = [];
    const llm: LLMProvider = {
      name: 'recording-llm',
      async classify(_subject, _body, options = {}) {
        calls.push(options);
        return calls.length === 1
          ? 'not json at all'
          : JSON.stringify({ category: 'other', priority: 'low', summary: 'ok', confidence: 0.9 });
      },
    };
    const ctx = createTestContext({ llm });
    const ticket = await submitAndTriage(ctx, ACME, ticketWith(''));

    expect(ticket.status).toBe('triaged');
    expect(calls).toHaveLength(2);
    expect(calls[0].repairPrompt).toBeUndefined();
    expect(calls[1].repairPrompt).toContain('not json at all');
  });

  it('sends an [[ALWAYS_BAD]] ticket to needs_review and stores no triage data', async () => {
    const ctx = createTestContext();
    const ticket = await submitAndTriage(ctx, ACME, ticketWith('[[ALWAYS_BAD]]'));

    expect(ticket.status).toBe('needs_review');
    expect(ticket.triageError).toBe('schema_invalid_after_repair');
    expect(ticket.llmAttempts).toBe(2);
    expect(ticket.triage).toBeNull();
  });

  it('sends a [[LOW_CONF]] ticket to needs_review without a retry', async () => {
    const ctx = createTestContext();
    const ticket = await submitAndTriage(ctx, ACME, ticketWith('[[LOW_CONF]]'));

    expect(ticket.status).toBe('needs_review');
    expect(ticket.triageError).toBe('low_confidence');
    expect(ticket.llmAttempts).toBe(1);
    expect(ticket.triage).toBeNull();
  });

  it('times out a [[SLOW]] ticket, which still keeps its embedding', async () => {
    const ctx = createTestContext({ config: { llmTimeoutMs: 50 } });
    const ticket = await submitAndTriage(ctx, ACME, ticketWith('[[SLOW]]'));

    expect(ticket.status).toBe('needs_review');
    expect(ticket.triageError).toBe('timeout');
    expect(ticket.llmAttempts).toBe(1);

    const row = ctx.db
      .prepare('SELECT embedding, embedding_model FROM tickets WHERE id = ?')
      .get(ticket.id) as { embedding: Buffer | null; embedding_model: string | null };
    expect(row.embedding).not.toBeNull();
    expect(row.embedding_model).toBe('mock-embed-v1');
  });
});
