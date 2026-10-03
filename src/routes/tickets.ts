import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { createTicketSchema, searchQuerySchema } from '../schemas';
import { rankBySimilarity } from '../search';
import { insertTicket } from '../tickets';

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

    // Only store the ticket here. The worker does the slow LLM work later.
    const ticket = insertTicket(db, tenantId, parsed.data);
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
    res.json({ query: q, results: rankBySimilarity(db, tenantId, queryVector, limit) });
  });

  return router;
}
