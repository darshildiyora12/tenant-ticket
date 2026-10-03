import { z } from 'zod';

/**
 * Body of POST /tickets. Zod drops unknown keys, so tenantId, status, priority
 * and anything else the client sends is ignored.
 */
export const createTicketSchema = z.object({
  subject: z.string().trim().min(3).max(150),
  body: z.string().trim().min(10).max(5000),
  customerEmail: z.string().trim().toLowerCase().pipe(z.email()),
  channel: z.enum(['email', 'web', 'chat']).default('web'),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

/** Query string of GET /tickets/search. Query values arrive as strings, so limit is coerced. */
export const searchQuerySchema = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

/** What the LLM must return. Every reply is checked against this before anything is stored. */
export const triageResultSchema = z.object({
  category: z.enum(['billing', 'technical', 'account', 'feature_request', 'other']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  summary: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1),
});

export type TriageResult = z.infer<typeof triageResultSchema>;
