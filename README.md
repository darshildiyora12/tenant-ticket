# AI Support Ticket Triage

Backend for a multi-tenant support-ticket triage service. `POST /tickets` stores a ticket and answers at once with `202`. A background worker then embeds the ticket, checks whether it is a duplicate, and classifies it with an LLM. Every LLM reply is validated before anything is stored, so a slow or broken model never corrupts data or blocks the API.

All Must, Should and Stretch items from the task are implemented.

## Install, run, test

Requires Node.js 22 or newer. No other service is needed: the database is a SQLite file created on first start.

```bash
npm install
npm start          # API on http://localhost:3000, worker in the same process
npm test           # 38 automated tests, about 2 seconds
npm run demo       # with the server running: submits the 11 sample tickets and prints the results
npm run typecheck
```

`npm run demo` gives the results the task expects on a fresh database. To start fresh, stop the server and delete the `data/` folder.

Settings are environment variables (or a `.env` file, see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `data/triage.db` | SQLite file |
| `AI_PROVIDER` | `mock` | Selects both the LLM and the embedding provider |
| `DUPLICATE_THRESHOLD` | `0.9` | Cosine similarity at or above this marks a duplicate |
| `LLM_TIMEOUT_MS` | `5000` | Longest wait for one LLM call |
| `LLM_MAX_CONCURRENCY` | `3` | Most LLM calls in flight at once |

## curl examples

Tenants: `key_acme` (tenant A) and `key_beta` (tenant B). On Windows PowerShell use `curl.exe` and keep the JSON in a file (`-d "@ticket.json"`), because PowerShell changes the quotes.

```bash
# Submit a ticket -> 202 {"id":"...","status":"queued"}
curl -X POST http://localhost:3000/tickets \
  -H "x-api-key: key_acme" -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-123" \
  -d '{"subject":"Charged twice","body":"I was billed $49 twice this month for the same plan. Please refund one charge.","customerEmail":"ana@acme.io"}'

# Read it (status moves queued -> processing -> triaged or needs_review)
curl http://localhost:3000/tickets/<id> -H "x-api-key: key_acme"

# Semantic search inside the caller's tenant
curl "http://localhost:3000/tickets/search?q=refund%20double%20charge&limit=5" -H "x-api-key: key_acme"

# The 3 most similar triaged tickets
curl http://localhost:3000/tickets/<id>/similar -H "x-api-key: key_acme"

# Another tenant's ticket -> 404, no key -> 401
curl http://localhost:3000/tickets/<id> -H "x-api-key: key_beta"
curl http://localhost:3000/tickets/<id>

# A failure path: ends in needs_review with triageError "schema_invalid_after_repair"
curl -X POST http://localhost:3000/tickets \
  -H "x-api-key: key_acme" -H "Content-Type: application/json" \
  -d '{"subject":"Broken reply","body":"This ticket makes the mock return bad output. [[ALWAYS_BAD]]","customerEmail":"qa@acme.io"}'
```

## How it works

```
POST /tickets -> validate (Zod) -> INSERT status=queued -> 202
                                         |
worker (same process) claims the oldest queued row: queued -> processing
  1. embed subject + "\n\n" + body, run the duplicate rule, store both in one UPDATE
  2. LLM classify -> JSON.parse -> Zod schema
       invalid         -> one retry with a repair prompt -> still invalid -> needs_review
       confidence<0.6  -> needs_review (low_confidence)
       over 5 seconds  -> needs_review (timeout)
       valid           -> triaged
```

- **The tickets table is the queue.** A queued ticket is a row, so nothing is lost on a crash. The claim is one `UPDATE ... RETURNING` statement, so a ticket cannot be claimed twice.
- **Crash recovery.** On startup every ticket still in `processing` goes back to `queued`. While running, a ticket in `processing` for more than 60 seconds (`processingStartedAt`) is requeued too.
- **Tenant isolation.** The tenant comes only from `x-api-key`. Every query behind an API request filters on `tenant_id`, and so does the duplicate rule, so another tenant's ticket is "not found" (404) and never appears in search or as a duplicate.
- **Order and concurrency.** Embedding and the duplicate check run one ticket at a time, oldest first, so a ticket always sees every earlier ticket. Only the LLM stage runs in parallel, at most 3 tickets at once.
- **Providers.** `LLMProvider` and `EmbeddingProvider` are interfaces (`src/providers/types.ts`). `AI_PROVIDER` picks the implementation of both in `src/providers/index.ts`; a real model is one new class and one new `case`.

Code map: `src/routes/tickets.ts` (HTTP), `src/worker.ts` (queue loop), `src/triage.ts` (validate, repair, timeout), `src/duplicates.ts`, `src/search.ts`, `src/tickets.ts` (all ticket SQL), `src/providers/` (mocks).

## Assumptions

- A `needs_review` ticket has `triage: null`, also for `low_confidence`, because the spec says the triage fields are null until triage succeeds.
- `[[MALFORMED]]`: "the first call" is the call without a repair prompt, so every such ticket is triaged after exactly one repair (`llmAttempts: 2`).
- A timeout or a provider error is not retried. The ticket goes to `needs_review` with `triageError` `timeout` or `llm_error`.
- `limit` above 20 (or below 1) is a `400`, not silently cut to 20. `q` is validated and embedded as sent.
- Search returns the top `limit` tickets by score even when a score is 0. It does not hide weak matches.
- A repeated `Idempotency-Key` returns `202` with the original ticket id and its current status. The new request body is validated but not compared with the original.
- When the best duplicate match is itself a duplicate, `duplicateOf` is its original and `duplicateScore` is the similarity to that original.
- The mock's keyword rules match substrings, case-insensitive ("charges" matches `charge`); that is what makes the sample table come out as expected.
- One server process runs the worker. Startup recovery relies on that.
- Sample #9 (prompt injection): ticket text is only ever passed as data. Whatever the model replies must still fit the enum schema, and a ticket cannot change its own tenant, status or stored fields.

## Trade-offs

- **Vector storage.** Each vector is a 1 KB BLOB of 32-bit floats in the ticket row. Search loads one tenant's vectors and computes cosine in JavaScript. It is exact and needs no extra service, but it is O(n) per query, so it suits thousands of tickets per tenant, not millions.
- **At 1 million tickets** I would move the vectors to an approximate-nearest-neighbour index (pgvector with HNSW, or sqlite-vec), filtered or partitioned by tenant, and ask it for the top k instead of scanning. The duplicate check can stay as it is: an index on (tenant, customer, created_at) already narrows it to a few rows.
- **Queue.** A table plus an in-process worker is simple and crash-safe but is one process. At scale I would run separate worker processes on Postgres (`FOR UPDATE SKIP LOCKED`) or a real queue, and add retries with backoff for provider errors.
- **Mock embedding quality.** Summing character codes into 256 buckets makes unrelated words collide ("export" and "dark" share a bucket), so some unrelated tickets get a non-zero score. `embeddingModel` is stored per ticket so vectors can be rebuilt when the model changes.
- **Not production-ready:** API keys are stored in plain text, and there is no rate limiting or pagination.

## How AI tools were used

I used Claude Code (Anthropic's coding agent). It read the task PDF and proposed a plan, which I approved before any code was written. It then wrote the code, the tests and this README one requirement at a time, in the order of the Must list, with one commit per step. Along the way it ran the type checker and the test suite, ran all sample tickets against the real server, and killed the server mid-ticket to confirm crash recovery.
