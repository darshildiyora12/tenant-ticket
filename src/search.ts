import type { DB } from './db';
import { cosine, fromBlob, round4 } from './vector';

export interface ScoredTicket {
  id: string;
  subject: string;
  status: string;
  category: string | null;
  score: number;
}

interface EmbeddedRow {
  id: string;
  subject: string;
  status: string;
  category: string | null;
  embedding: Buffer;
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
  limit: number,
): ScoredTicket[] {
  const rows = db
    .prepare(
      `SELECT id, subject, status, category, embedding FROM tickets
       WHERE tenant_id = ? AND embedding IS NOT NULL
       ORDER BY created_at, rowid`,
    )
    .all(tenantId) as EmbeddedRow[];

  return rows
    .map((row) => ({
      id: row.id,
      subject: row.subject,
      status: row.status,
      category: row.category,
      score: cosine(query, fromBlob(row.embedding)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((ticket) => ({ ...ticket, score: round4(ticket.score) }));
}
