import { z } from 'zod';
import type { LLMProvider } from './providers/types';
import { triageResultSchema, type TriageResult } from './schemas';

export type TriageOutcome =
  | { status: 'triaged'; result: TriageResult; attempts: number }
  | { status: 'needs_review'; reason: string; attempts: number };

type ParsedReply = { ok: true; value: TriageResult } | { ok: false; error: string };

/** The raw reply is untrusted text: it must be JSON and it must match the schema. */
export function parseTriage(raw: string): ParsedReply {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'The reply is not valid JSON.' };
  }
  const result = triageResultSchema.safeParse(json);
  if (!result.success) return { ok: false, error: z.prettifyError(result.error) };
  return { ok: true, value: result.data };
}

export function buildRepairPrompt(previousReply: string, problem: string): string {
  return [
    'Your previous reply could not be used.',
    `Previous reply: ${previousReply}`,
    `Problem: ${problem}`,
    'Reply again with only a JSON object with these fields:',
    '{"category": "billing|technical|account|feature_request|other", "priority": "low|medium|high|urgent", "summary": "1-200 characters", "confidence": 0-1}',
  ].join('\n');
}

export interface TriageOptions {
  /** Below this confidence a valid reply still goes to a human. */
  confidenceThreshold: number;
}

/**
 * Classifies one ticket. An invalid reply gets exactly one retry with a repair
 * prompt; after that the ticket goes to needs_review instead of storing bad data.
 */
export async function triageTicket(
  llm: LLMProvider,
  ticket: { subject: string; body: string },
  options: TriageOptions,
): Promise<TriageOutcome> {
  let attempts = 1;
  const firstReply = await llm.classify(ticket.subject, ticket.body);
  let parsed = parseTriage(firstReply);

  if (!parsed.ok) {
    attempts = 2;
    const repairPrompt = buildRepairPrompt(firstReply, parsed.error);
    const secondReply = await llm.classify(ticket.subject, ticket.body, { repairPrompt });
    parsed = parseTriage(secondReply);
    if (!parsed.ok) return { status: 'needs_review', reason: 'schema_invalid_after_repair', attempts };
  }

  if (parsed.value.confidence < options.confidenceThreshold) {
    return { status: 'needs_review', reason: 'low_confidence', attempts };
  }
  return { status: 'triaged', result: parsed.value, attempts };
}
