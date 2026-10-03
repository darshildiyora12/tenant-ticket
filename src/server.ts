import { createApp } from './app';
import { loadConfig } from './config';
import { openDb } from './db';

const config = loadConfig();
const db = openDb(config.dbPath);
const app = createApp({ db });

const server = app.listen(config.port, () => {
  console.log(`Ticket triage API listening on http://localhost:${config.port}`);
});

function shutdown(): void {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
