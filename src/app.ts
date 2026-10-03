import express, { type ErrorRequestHandler } from 'express';
import { requireTenant } from './auth';
import type { DB } from './db';
import type { EmbeddingProvider } from './providers/types';
import { ticketRoutes } from './routes/tickets';

export interface AppDeps {
  db: DB;
  /** Search embeds the query with the same provider the worker uses for tickets. */
  embedder: EmbeddingProvider;
  /** Called after a ticket is stored, so the worker can start without waiting for its next poll. */
  onTicketQueued?: () => void;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
};

export function createApp(deps: AppDeps): express.Express {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Auth runs first, so a request without a valid key never reaches a handler.
  app.use('/tickets', requireTenant(deps.db), express.json(), ticketRoutes(deps));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  app.use(errorHandler);
  return app;
}
