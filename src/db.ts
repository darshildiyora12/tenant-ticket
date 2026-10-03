import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS tickets (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id),
  idempotency_key       TEXT,
  subject               TEXT NOT NULL,
  body                  TEXT NOT NULL,
  customer_email        TEXT NOT NULL,
  channel               TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'queued',
  category              TEXT,
  priority              TEXT,
  summary               TEXT,
  confidence            REAL,
  triage_error          TEXT,
  llm_attempts          INTEGER NOT NULL DEFAULT 0,
  embedding             BLOB,
  embedding_model       TEXT,
  duplicate_of          TEXT REFERENCES tickets(id),
  duplicate_score       REAL,
  processing_started_at TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

-- The tickets table is also the job queue: the worker takes the oldest queued row.
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets(status, created_at);
-- Duplicate candidates: same tenant, same customer, recent.
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(tenant_id, customer_email, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_idempotency
  ON tickets(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
`;

const SEED_TENANTS = [
  { id: 'acme', name: 'Acme (tenant A)', apiKey: 'key_acme' },
  { id: 'beta', name: 'Beta (tenant B)', apiKey: 'key_beta' },
];

export function openDb(dbPath: string): DB {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const insertTenant = db.prepare('INSERT OR IGNORE INTO tenants (id, name, api_key) VALUES (?, ?, ?)');
  for (const tenant of SEED_TENANTS) insertTenant.run(tenant.id, tenant.name, tenant.apiKey);
  return db;
}
