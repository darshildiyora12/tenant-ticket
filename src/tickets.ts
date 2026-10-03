import { randomUUID } from 'node:crypto';
import type { DB } from './db';
import type { CreateTicketInput } from './schemas';

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
