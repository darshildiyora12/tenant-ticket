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
