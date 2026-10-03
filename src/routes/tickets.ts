import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { createTicketSchema, searchQuerySchema } from '../schemas';
import { rankBySimilarity, similarTriaged, toSearchResult } from '../search';
import { findByIdempotencyKey, getTicket, insertTicket, toApiTicket } from '../tickets';
import { fromBlob } from '../vector';

/** 400 with one list of messages per invalid field. */
function sendValidationError(res: Response, error: z.ZodError): void {
  const { fieldErrors, formErrors } = z.flattenError(error);
  res.status(400).json({ error: 'validation_error', fields: fieldErrors, formErrors });
}

export function ticketRoutes(deps: AppDeps): Router {
  const { db, embedder } = deps;
  const router = Router();

  router.post('/', (req, res) => {
    const tenantId: string = res.locals.tenantId;
    const parsed = createTicketSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // A repeat with the same Idempotency-Key returns the original ticket and
    // queues nothing new. better-sqlite3 is synchronous, so no other request
    // can run between this lookup and the insert; the unique index is the backstop.
    const idempotencyKey = req.header('idempotency-key')?.trim() || null;
    if (idempotencyKey) {
      const existing = findByIdempotencyKey(db, tenantId, idempotencyKey);
      if (existing) {
        res.status(202).json({ id: existing.id, status: existing.status });
        return;
      }
    }

    // Only store the ticket here. The worker does the slow LLM work later.
    const ticket = insertTicket(db, tenantId, parsed.data, idempotencyKey);
    res.status(202).json(ticket);
    deps.onTicketQueued?.();
  });

  // Registered before any "/:id" route, otherwise "search" would be read as an id.
  router.get('/search', async (req, res) => {
    const tenantId: string = res.locals.tenantId;
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { q, limit } = parsed.data;
    const queryVector = await embedder.embed(q);
    const results = rankBySimilarity(db, tenantId, queryVector, { limit }).map(toSearchResult);
    res.json({ query: q, results });
  });

  router.get('/:id/similar', (req, res) => {
    const tenantId: string = res.locals.tenantId;
    const ticket = getTicket(db, tenantId, req.params.id);
    if (!ticket) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    // A ticket the worker has not embedded yet has nothing to compare with.
    const results = ticket.embedding
      ? similarTriaged(db, tenantId, ticket.id, fromBlob(ticket.embedding)).map(toSearchResult)
      : [];
    res.json({ id: ticket.id, results });
  });

  router.get('/:id', (req, res) => {
    const tenantId: string = res.locals.tenantId;
    const ticket = getTicket(db, tenantId, req.params.id);
    if (!ticket) {
      // Same answer for "does not exist" and "belongs to another tenant".
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(toApiTicket(ticket));
  });

  return router;
}
