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
  /** Longest time to wait for one LLM call. */
  timeoutMs: number;
}

export class LLMTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`LLM call timed out after ${timeoutMs} ms`);
  }
}

/** Races the LLM call against a timer, so a slow model cannot block the worker. */
async function withTimeout(
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<string>,
): Promise<string> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new LLMTimeoutError(timeoutMs));
      controller.abort(); // also tells the provider to stop working on this call
    }, timeoutMs);
  });
  try {
    return await Promise.race([call(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
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
  let attempts = 0;
  const classify = (repairPrompt?: string): Promise<string> => {
    attempts++;
    return withTimeout(options.timeoutMs, (signal) =>
      llm.classify(ticket.subject, ticket.body, { repairPrompt, signal }),
    );
  };

  try {
    const firstReply = await classify();
    let parsed = parseTriage(firstReply);

    if (!parsed.ok) {
      const secondReply = await classify(buildRepairPrompt(firstReply, parsed.error));
      parsed = parseTriage(secondReply);
      if (!parsed.ok) return { status: 'needs_review', reason: 'schema_invalid_after_repair', attempts };
    }

    if (parsed.value.confidence < options.confidenceThreshold) {
      return { status: 'needs_review', reason: 'low_confidence', attempts };
    }
    return { status: 'triaged', result: parsed.value, attempts };
  } catch (err) {
    // A timeout or a provider failure is not retried: the ticket goes to a human.
    if (err instanceof LLMTimeoutError) return { status: 'needs_review', reason: 'timeout', attempts };
    console.error('[triage] LLM call failed', err);
    return { status: 'needs_review', reason: 'llm_error', attempts };
  }
}
