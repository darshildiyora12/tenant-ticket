export interface Config {
  port: number;
  dbPath: string;
  /** Selects both the LLM and the embedding provider. */
  aiProvider: string;
  /** A valid LLM reply below this confidence goes to needs_review. */
  confidenceThreshold: number;
  /** Cosine similarity at or above this marks a ticket as a duplicate. */
  duplicateThreshold: number;
  /** Longest time to wait for one LLM call before the ticket goes to needs_review. */
  llmTimeoutMs: number;
  /** How often the worker looks for queued tickets. */
  workerPollMs: number;
  /** A ticket in "processing" for longer than this is treated as abandoned and requeued. */
  stuckAfterMs: number;
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: num(env.PORT, 3000),
    dbPath: env.DB_PATH ?? 'data/triage.db',
    aiProvider: env.AI_PROVIDER ?? 'mock',
    confidenceThreshold: 0.6,
    duplicateThreshold: num(env.DUPLICATE_THRESHOLD, 0.9),
    llmTimeoutMs: num(env.LLM_TIMEOUT_MS, 5000),
    workerPollMs: num(env.WORKER_POLL_MS, 500),
    stuckAfterMs: num(env.STUCK_AFTER_MS, 60_000),
  };
}
