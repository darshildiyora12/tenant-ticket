import type { RequestHandler } from 'express';
import type { DB } from './db';

/**
 * Maps the x-api-key header to a tenant and stores it in res.locals.tenantId.
 * The tenant only ever comes from the key, never from the request body.
 */
export function requireTenant(db: DB): RequestHandler {
  const findTenant = db.prepare('SELECT id FROM tenants WHERE api_key = ?');

  return (req, res, next) => {
    const apiKey = req.header('x-api-key');
    const tenant = apiKey ? (findTenant.get(apiKey) as { id: string } | undefined) : undefined;
    if (!tenant) {
      res.status(401).json({ error: 'unauthorized', message: 'Missing or unknown x-api-key' });
      return;
    }
    res.locals.tenantId = tenant.id;
    next();
  };
}
