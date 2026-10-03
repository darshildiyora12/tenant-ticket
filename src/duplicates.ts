import type { DB } from './db';
import type { TicketRow } from './tickets';
import { cosine, fromBlob } from './vector';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface DuplicateMatch {
  duplicateOf: string;
  duplicateScore: number;
}

interface Candidate {
  id: string;
  embedding: Buffer;
  duplicate_of: string | null;
}

/**
 * The duplicate rule. Candidates are earlier tickets from the same tenant and
 * the same customer, created in the 7 days before this ticket, that already
 * have an embedding. The best one counts as a match at or above the threshold.
 */
export function findDuplicate(
  db: DB,
  ticket: TicketRow,
  vector: ArrayLike<number>,
  threshold: number,
): DuplicateMatch | null {
  const windowStart = new Date(Date.parse(ticket.created_at) - SEVEN_DAYS_MS).toISOString();
  const candidates = db
    .prepare(
      `SELECT id, embedding, duplicate_of FROM tickets
       WHERE tenant_id = ? AND customer_email = ? AND id != ?
         AND embedding IS NOT NULL
         AND created_at >= ? AND created_at <= ?
       ORDER BY created_at, rowid`,
    )
    .all(ticket.tenant_id, ticket.customer_email, ticket.id, windowStart, ticket.created_at) as Candidate[];

  let best: { candidate: Candidate; score: number } | null = null;
  for (const candidate of candidates) {
    const score = cosine(vector, fromBlob(candidate.embedding));
    // ">" (not ">=") keeps the oldest ticket when two candidates score the same.
    if (!best || score > best.score) best = { candidate, score };
  }
  if (!best || best.score < threshold) return null;

  // No chains: if the match is itself a duplicate, point to its original and
  // report the similarity to that original.
  if (best.candidate.duplicate_of) {
    const original = db
      .prepare('SELECT id, embedding FROM tickets WHERE id = ? AND tenant_id = ?')
      .get(best.candidate.duplicate_of, ticket.tenant_id) as { id: string; embedding: Buffer | null } | undefined;
    if (original?.embedding) {
      return { duplicateOf: original.id, duplicateScore: cosine(vector, fromBlob(original.embedding)) };
    }
  }
  return { duplicateOf: best.candidate.id, duplicateScore: best.score };
}
