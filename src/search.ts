import type { DB } from './db';
import { cosine, fromBlob, round4 } from './vector';

export interface ScoredTicket {
  id: string;
  subject: string;
  status: string;
  category: string | null;
  priority: string | null;
  score: number;
}

interface EmbeddedRow {
  id: string;
  subject: string;
  status: string;
  category: string | null;
  priority: string | null;
  embedding: Buffer;
}

export interface RankOptions {
  limit: number;
  /** Only tickets whose triage succeeded. */
  onlyTriaged?: boolean;
  /** Leave this ticket out (a ticket is always most similar to itself). */
  excludeId?: string;
}

/**
 * Scores every embedded ticket of ONE tenant against the query vector and
 * returns the best matches. A brute-force scan: fine for thousands of tickets,
 * see the README for what changes at a million.
 */
export function rankBySimilarity(
  db: DB,
  tenantId: string,
  query: ArrayLike<number>,
  options: RankOptions,
): ScoredTicket[] {
  const rows = db
    .prepare(
      `SELECT id, subject, status, category, priority, embedding FROM tickets
       WHERE tenant_id = ? AND embedding IS NOT NULL
         ${options.onlyTriaged ? "AND status = 'triaged'" : ''}
       ORDER BY created_at, rowid`,
    )
    .all(tenantId) as EmbeddedRow[];

  return rows
    .filter((row) => row.id !== options.excludeId)
    .map((row) => ({
      id: row.id,
      subject: row.subject,
      status: row.status,
      category: row.category,
      priority: row.priority,
      score: cosine(query, fromBlob(row.embedding)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit)
    .map((ticket) => ({ ...ticket, score: round4(ticket.score) }));
}

/** One entry of "results" in the search and similar responses. */
export function toSearchResult(ticket: ScoredTicket) {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    category: ticket.category,
    score: ticket.score,
  };
}

/** How many similar tickets GET /tickets/:id/similar returns and the LLM gets as examples. */
export const SIMILAR_LIMIT = 3;

/** The most similar already-triaged tickets of the same tenant. */
export function similarTriaged(
  db: DB,
  tenantId: string,
  ticketId: string,
  vector: ArrayLike<number>,
): ScoredTicket[] {
  return rankBySimilarity(db, tenantId, vector, {
    limit: SIMILAR_LIMIT,
    onlyTriaged: true,
    excludeId: ticketId,
  });
}
