import type { Config } from './config';
import type { DB } from './db';
import { findDuplicate } from './duplicates';
import type { EmbeddingProvider, LLMProvider } from './providers/types';
import {
  claimNextQueued,
  markNeedsReview,
  markTriaged,
  requeueStuck,
  saveEmbedding,
  ticketText,
  type TicketRow,
} from './tickets';
import { triageTicket } from './triage';
import { fromBlob, toBlob } from './vector';

export interface WorkerDeps {
  db: DB;
  llm: LLMProvider;
  embedder: EmbeddingProvider;
  config: Config;
}

/**
 * Background worker. The tickets table is the queue, so queued work survives a
 * restart and no extra queue service is needed.
 */
export class TriageWorker {
  private timer?: NodeJS.Timeout;
  private currentPass?: Promise<void>;

  constructor(private readonly deps: WorkerDeps) {}

  start(): void {
    // Crash recovery. This process is the only worker, so any ticket still in
    // "processing" at startup was abandoned by a previous run.
    const recovered = requeueStuck(this.deps.db);
    if (recovered > 0) console.log(`[worker] requeued ${recovered} ticket(s) left in processing`);

    this.timer = setInterval(() => this.wake(), this.deps.config.workerPollMs);
    this.wake();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Ask the worker to look at the queue now instead of at the next poll. */
  wake(): void {
    void this.runPass();
  }

  /** Process everything that is queued and wait until it is finished (tests use this). */
  async drain(): Promise<void> {
    await this.runPass();
  }

  /** Only one pass runs at a time; callers during a pass share it. */
  private runPass(): Promise<void> {
    this.currentPass ??= this.processQueue()
      .catch((err) => console.error('[worker] pass failed', err))
      .finally(() => {
        this.currentPass = undefined;
      });
    return this.currentPass;
  }

  private async processQueue(): Promise<void> {
    const { db, config } = this.deps;
    requeueStuck(db, new Date(Date.now() - config.stuckAfterMs).toISOString());

    for (;;) {
      const ticket = claimNextQueued(db); // queued -> processing
      if (!ticket) return;
      await this.process(ticket);
    }
  }

  private async process(ticket: TicketRow): Promise<void> {
    const { db, llm, embedder, config } = this.deps;
    try {
      // Embed before triage, so the ticket has a vector even if triage fails.
      // A ticket requeued after a crash may already have one.
      if (!ticket.embedding) {
        const blob = toBlob(await embedder.embed(ticketText(ticket)));
        // Compare the vector exactly as it is stored (32-bit floats), so
        // identical text scores exactly 1.
        const duplicate = findDuplicate(db, ticket, fromBlob(blob), config.duplicateThreshold);
        saveEmbedding(db, ticket.id, blob, embedder.model, duplicate);
      }

      const outcome = await triageTicket(llm, ticket, {
        confidenceThreshold: config.confidenceThreshold,
        timeoutMs: config.llmTimeoutMs,
      });
      if (outcome.status === 'triaged') {
        markTriaged(db, ticket.id, outcome.result, outcome.attempts);
      } else {
        markNeedsReview(db, ticket.id, outcome.reason, outcome.attempts);
      }
    } catch (err) {
      console.error(`[worker] ticket ${ticket.id} failed`, err);
      markNeedsReview(db, ticket.id, 'worker_error', 0);
    }
  }
}
