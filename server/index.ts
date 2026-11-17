/**
 * Kazikwanza sync server: accounts, tasks, photos and messages shared between
 * phones, plus the web app itself.
 *
 *   PORT              port to listen on (default 8080)
 *   DATABASE_URL      Postgres connection string; without it, data goes in DATA_DIR
 *   DATA_DIR          folder for the data file and photos (default ./data)
 *   STATIC_DIR        built web app to serve (default ./dist)
 *   ALLOWED_ORIGINS   extra comma-separated origins that may call the API
 *   DEFAULT_TIME_ZONE zone for accounts that haven't sent theirs (default Africa/Nairobi)
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createKaziServer } from './app';
import { FileStorage, PostgresStorage, type Storage } from './storage';

const port = Number(process.env.PORT ?? 8080);
const staticDir = resolve(process.env.STATIC_DIR ?? 'dist');
const storage: Storage = process.env.DATABASE_URL
  ? new PostgresStorage(process.env.DATABASE_URL)
  : new FileStorage(resolve(process.env.DATA_DIR ?? 'data'));

const kazi = await createKaziServer({
  storage,
  staticDir: existsSync(staticDir) ? staticDir : undefined,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  defaultTimeZone: process.env.DEFAULT_TIME_ZONE,
}).catch((e: unknown) => {
  console.error(`Kazikwanza could not load its data, so it is not starting: ${e instanceof Error ? e.message : String(e)}`);
  if (process.env.DATABASE_URL) console.error('Check that DATABASE_URL is correct and the database is reachable.');
  process.exit(1);
});
const { server, flush } = kazi;

server.listen(port, () => {
  console.log(`Kazikwanza server on port ${port} (${process.env.DATABASE_URL ? 'Postgres' : 'file'} storage)`);
});

async function shutdown() {
  server.close();
  await flush().catch((e) => console.error(e));
  await storage.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
