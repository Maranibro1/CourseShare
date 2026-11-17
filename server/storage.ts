import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import type { AppData } from '../src/lib/types';

export interface Session {
  accountId: string;
  createdAt: number;
  lastUsed: number;
}

/** Everything the server keeps, apart from photos. */
export interface ServerState {
  app: AppData;
  /** Sign-in sessions, keyed by the hash of their token. */
  sessions: Record<string, Session>;
}

export interface Storage {
  load(): Promise<ServerState | null>;
  save(state: ServerState): Promise<void>;
  getPhoto(taskId: string): Promise<Buffer | null>;
  putPhoto(taskId: string, bytes: Buffer): Promise<void>;
  deletePhoto(taskId: string): Promise<void>;
  close(): Promise<void>;
}

/** Task ids become file names, so only allow safe characters. */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('bad id');
  return id;
}

/** A JSON file plus a folder of photos. Good for one server with a persistent disk. */
export class FileStorage implements Storage {
  private readonly file: string;
  private readonly photos: string;

  constructor(dir: string) {
    this.file = join(dir, 'state.json');
    this.photos = join(dir, 'photos');
  }

  async load(): Promise<ServerState | null> {
    await mkdir(this.photos, { recursive: true });
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as ServerState;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async save(state: ServerState): Promise<void> {
    // Write a temporary file and rename it over the old one, so a crash never leaves half a file.
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(state));
    await rename(tmp, this.file);
  }

  async getPhoto(taskId: string): Promise<Buffer | null> {
    try {
      return await readFile(join(this.photos, safeId(taskId)));
    } catch {
      return null;
    }
  }

  async putPhoto(taskId: string, bytes: Buffer): Promise<void> {
    const path = join(this.photos, safeId(taskId));
    await writeFile(`${path}.tmp`, bytes);
    await rename(`${path}.tmp`, path);
  }

  async deletePhoto(taskId: string): Promise<void> {
    await unlink(join(this.photos, safeId(taskId))).catch(() => undefined);
  }

  async close(): Promise<void> {}
}

/** Postgres (for example a free Neon database), for hosts whose disks are wiped on restart. */
export class PostgresStorage implements Storage {
  private readonly pool: pg.Pool;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
  }

  private init(): Promise<void> {
    this.ready ??= (async () => {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS kazikwanza_state (
          id integer PRIMARY KEY,
          data jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS kazikwanza_photos (
          task_id text PRIMARY KEY,
          bytes bytea NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
    })();
    return this.ready;
  }

  async load(): Promise<ServerState | null> {
    await this.init();
    const res = await this.pool.query<{ data: ServerState }>('SELECT data FROM kazikwanza_state WHERE id = 1');
    return res.rows[0]?.data ?? null;
  }

  async save(state: ServerState): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO kazikwanza_state (id, data, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [JSON.stringify(state)],
    );
  }

  async getPhoto(taskId: string): Promise<Buffer | null> {
    await this.init();
    const res = await this.pool.query<{ bytes: Buffer }>('SELECT bytes FROM kazikwanza_photos WHERE task_id = $1', [safeId(taskId)]);
    return res.rows[0]?.bytes ?? null;
  }

  async putPhoto(taskId: string, bytes: Buffer): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO kazikwanza_photos (task_id, bytes) VALUES ($1, $2)
       ON CONFLICT (task_id) DO UPDATE SET bytes = EXCLUDED.bytes, created_at = now()`,
      [safeId(taskId), bytes],
    );
  }

  async deletePhoto(taskId: string): Promise<void> {
    await this.init();
    await this.pool.query('DELETE FROM kazikwanza_photos WHERE task_id = $1', [safeId(taskId)]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
