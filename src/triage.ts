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

export async function triageTicket(
  llm: LLMProvider,
  ticket: { subject: string; body: string },
): Promise<TriageOutcome> {
  const raw = await llm.classify(ticket.subject, ticket.body);
  const parsed = parseTriage(raw);
  if (!parsed.ok) return { status: 'needs_review', reason: 'schema_invalid', attempts: 1 };
  return { status: 'triaged', result: parsed.value, attempts: 1 };
}
