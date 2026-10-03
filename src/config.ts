export interface Config {
  port: number;
  dbPath: string;
  /** Selects both the LLM and the embedding provider. */
  aiProvider: string;
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
    workerPollMs: num(env.WORKER_POLL_MS, 500),
    stuckAfterMs: num(env.STUCK_AFTER_MS, 60_000),
  };
}
