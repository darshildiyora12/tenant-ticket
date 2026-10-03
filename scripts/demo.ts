/**
 * Submits the 11 sample tickets (plus the three failure markers) to a running
 * server, waits for the worker, and prints the results and the sample searches.
 *
 *   npm start        (in one terminal, ideally on a fresh database)
 *   npm run demo     (in another)
 */
import { SAMPLES, payload, type SampleTicket } from '../tests/samples';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

const failureTicket = (n: number, marker: string): SampleTicket => ({
  n,
  apiKey: 'key_acme',
  customerEmail: 'qa@acme.io',
  subject: `Failure path ${marker}`,
  body: `This ticket checks one failure path of the worker. ${marker}`,
  expected: { category: '-', priority: '-' },
});

const TICKETS: SampleTicket[] = [
  ...SAMPLES,
  failureTicket(12, '[[ALWAYS_BAD]]'),
  failureTicket(13, '[[LOW_CONF]]'),
  failureTicket(14, '[[SLOW]]'),
];

async function api(method: string, path: string, apiKey: string, body?: object) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. Submit everything. Each POST should return at once, long before the LLM is done.
const numberById = new Map<string, number>();
const submitted: Array<{ ticket: SampleTicket; id: string }> = [];
const submitStart = Date.now();
for (const ticket of TICKETS) {
  const res = await api('POST', '/tickets', ticket.apiKey, payload(ticket));
  if (res.status !== 202) throw new Error(`POST #${ticket.n} failed: ${res.status} ${JSON.stringify(res.body)}`);
  numberById.set(res.body.id, ticket.n);
  submitted.push({ ticket, id: res.body.id });
}
console.log(`Submitted ${TICKETS.length} tickets in ${Date.now() - submitStart} ms. Waiting for the worker...`);

// 2. Poll until no ticket is queued or processing.
const fetchAll = () => Promise.all(submitted.map(({ ticket, id }) => api('GET', `/tickets/${id}`, ticket.apiKey)));
const waitStart = Date.now();
let results = await fetchAll();
while (results.some((r) => r.body.status === 'queued' || r.body.status === 'processing')) {
  if (Date.now() - waitStart > 120_000) throw new Error('Timed out waiting for the worker');
  await sleep(1000);
  results = await fetchAll();
}
console.log(`All tickets processed after ${((Date.now() - waitStart) / 1000).toFixed(1)} s.\n`);

// 3. Results next to what the task expects.
console.table(
  results.map((r, index) => {
    const { ticket } = submitted[index];
    const t = r.body;
    return {
      '#': ticket.n,
      customer: t.customerEmail,
      subject: t.subject,
      status: t.status,
      category: t.triage?.category ?? null,
      priority: t.triage?.priority ?? null,
      expected: `${ticket.expected.category}, ${ticket.expected.priority}`,
      attempts: t.llmAttempts,
      triageError: t.triageError,
      duplicateOf: t.duplicateOf ? `#${numberById.get(t.duplicateOf) ?? 'earlier run'}` : null,
      score: t.duplicateScore,
    };
  }),
);

// 4. The sample search queries, as tenant A.
for (const q of ['refund double charge', 'android login crash', 'csv export timeout']) {
  const res = await api('GET', `/tickets/search?q=${encodeURIComponent(q)}&limit=5`, 'key_acme');
  console.log(`\nSearch (tenant A): "${q}"`);
  console.table(
    res.body.results.map((r: any) => ({
      '#': numberById.get(r.id) ?? 'earlier run',
      subject: r.subject,
      status: r.status,
      category: r.category,
      score: r.score,
    })),
  );
}

// 5. Tenant isolation: tenant A must not see ticket #11, which belongs to tenant B.
const ticket11 = submitted.find(({ ticket }) => ticket.n === 11)!;
const asTenantA = await api('GET', `/tickets/${ticket11.id}`, 'key_acme');
const asTenantB = await api('GET', `/tickets/${ticket11.id}`, 'key_beta');
console.log(`\nTicket #11 read by tenant A: ${asTenantA.status} (expected 404)`);
console.log(`Ticket #11 read by tenant B: ${asTenantB.status} (expected 200)`);
