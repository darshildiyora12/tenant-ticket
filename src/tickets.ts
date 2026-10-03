import { randomUUID } from 'node:crypto';
import type { DB } from './db';
import type { DuplicateMatch } from './duplicates';
import type { CreateTicketInput, TriageResult } from './schemas';

export type TicketStatus = 'queued' | 'processing' | 'triaged' | 'needs_review';

/** One row of the tickets table, exactly as stored. */
export interface TicketRow {
  id: string;
  tenant_id: string;
  idempotency_key: string | null;
  subject: string;
  body: string;
  customer_email: string;
  channel: string;
  status: TicketStatus;
  category: string | null;
  priority: string | null;
  summary: string | null;
  confidence: number | null;
  triage_error: string | null;
  llm_attempts: number;
  embedding: Buffer | null;
  embedding_model: string | null;
  duplicate_of: string | null;
  duplicate_score: number | null;
  processing_started_at: string | null;
  created_at: string;
  updated_at: string;
}

const now = () => new Date().toISOString();

export function insertTicket(
  db: DB,
  tenantId: string,
  input: CreateTicketInput,
): { id: string; status: TicketStatus } {
  const id = randomUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO tickets (id, tenant_id, subject, body, customer_email, channel, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(id, tenantId, input.subject, input.body, input.customerEmail, input.channel, timestamp, timestamp);
  return { id, status: 'queued' };
}

// ---- Worker queries ----

/**
 * Takes the oldest queued ticket and marks it as processing in one statement,
 * so two workers can never claim the same ticket.
 */
export function claimNextQueued(db: DB): TicketRow | undefined {
  const timestamp = now();
  return db
    .prepare(
      `UPDATE tickets SET status = 'processing', processing_started_at = ?, updated_at = ?
       WHERE id = (SELECT id FROM tickets WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1)
       RETURNING *`,
    )
    .get(timestamp, timestamp) as TicketRow | undefined;
}

/**
 * Puts tickets stuck in "processing" back in the queue. Without a cutoff it
 * requeues all of them (startup); with one, only those that started before it.
 */
export function requeueStuck(db: DB, startedBefore?: string): number {
  const cutoff = startedBefore ?? '9999-12-31';
  const result = db
    .prepare(
      `UPDATE tickets SET status = 'queued', updated_at = ?
       WHERE status = 'processing' AND processing_started_at < ?`,
    )
    .run(now(), cutoff);
  return result.changes;
}

/** The text that gets embedded: subject and body only, exactly as stored. */
export function ticketText(ticket: Pick<TicketRow, 'subject' | 'body'>): string {
  return `${ticket.subject}\n\n${ticket.body}`;
}

/**
 * Stores the vector and the duplicate result in one statement, so "has an
 * embedding" always means "the duplicate rule has run" (it runs once per ticket).
 */
export function saveEmbedding(
  db: DB,
  id: string,
  embedding: Buffer,
  model: string,
  duplicate: DuplicateMatch | null,
): void {
  db.prepare(
    `UPDATE tickets
     SET embedding = ?, embedding_model = ?, duplicate_of = ?, duplicate_score = ?, updated_at = ?
     WHERE id = ?`,
  ).run(embedding, model, duplicate?.duplicateOf ?? null, duplicate?.duplicateScore ?? null, now(), id);
}

export function markTriaged(db: DB, id: string, result: TriageResult, attempts: number): void {
  db.prepare(
    `UPDATE tickets
     SET status = 'triaged', category = ?, priority = ?, summary = ?, confidence = ?,
         triage_error = NULL, llm_attempts = llm_attempts + ?, updated_at = ?
     WHERE id = ?`,
  ).run(result.category, result.priority, result.summary, result.confidence, attempts, now(), id);
}

export function markNeedsReview(db: DB, id: string, reason: string, attempts: number): void {
  db.prepare(
    `UPDATE tickets
     SET status = 'needs_review', triage_error = ?, llm_attempts = llm_attempts + ?, updated_at = ?
     WHERE id = ?`,
  ).run(reason, attempts, now(), id);
}
