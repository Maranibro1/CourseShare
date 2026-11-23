/**
 * Kazikwanza server for self-hosting (the alternative to Supabase): the API,
 * live updates and the web app in one process.
 *
 *   PORT              port to listen on (default 8080)
 *   DATABASE_URL      Postgres connection string; tables are created from supabase/schema.sql.
 *                     Without it, data is kept in DATA_DIR.
 *   DATA_DIR          folder for the data file and photos (default ./data)
 *   STATIC_DIR        built web app to serve (default ./dist)
 *   ALLOWED_ORIGINS   extra comma-separated origins that may call the API
 *   DEFAULT_TIME_ZONE zone for accounts that haven't sent theirs (default Africa/Nairobi)
 */
import { claudeChecker } from './claude';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createKaziServer, fileRepo } from './node';
import { PgRepo } from './pg-repo';
import type { Repo } from './repo';

const port = Number(process.env.PORT ?? 8080);
const staticDir = resolve(process.env.STATIC_DIR ?? 'dist');

let repo: Repo;
try {
  if (process.env.DATABASE_URL) {
    const pg = new PgRepo(process.env.DATABASE_URL, resolve(process.env.SCHEMA_FILE ?? 'supabase/schema.sql'));
    await pg.init();
    repo = pg;
  } else {
    repo = await fileRepo(resolve(process.env.DATA_DIR ?? 'data'));
  }
} catch (e) {
  console.error(`Kazikwanza could not load its data, so it is not starting: ${e instanceof Error ? e.message : String(e)}`);
  if (process.env.DATABASE_URL) console.error('Check that DATABASE_URL is correct and the database is reachable.');
  process.exit(1);
}

const { server } = createKaziServer({
  repo,
  staticDir: existsSync(staticDir) ? staticDir : undefined,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  defaultTimeZone: process.env.DEFAULT_TIME_ZONE,
  claude: claudeChecker(process.env.ANTHROPIC_API_KEY),
});

server.listen(port, () => {
  console.log(
    `Kazikwanza server on port ${port} (${process.env.DATABASE_URL ? 'Postgres' : 'file'} storage, Claude checks ${process.env.ANTHROPIC_API_KEY ? 'on' : 'off'})`,
  );
});

function shutdown() {
  server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
