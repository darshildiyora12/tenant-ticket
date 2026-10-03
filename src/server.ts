import { existsSync } from 'node:fs';
import { createApp } from './app';
import { loadConfig } from './config';
import { openDb } from './db';
import { createProviders } from './providers';
import { TriageWorker } from './worker';

// Settings can come from an optional .env file (see .env.example).
if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const db = openDb(config.dbPath);
const { llm, embedder } = createProviders(config.aiProvider);

const worker = new TriageWorker({ db, llm, embedder, config });
const app = createApp({ db, embedder, onTicketQueued: () => worker.wake() });

worker.start();
const server = app.listen(config.port, () => {
  console.log(`Ticket triage API listening on http://localhost:${config.port} (AI_PROVIDER=${config.aiProvider})`);
});

function shutdown(): void {
  worker.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
