import { readFile } from 'node:fs/promises';
import pg from 'pg';
import type { Account } from '../src/lib/types';
import { commitError, commitPayload, ConflictMarker } from './payload';
import { ConflictError, TakenError, type Changes, type Loaded, type Repo, type Session } from './repo';

/**
 * Postgres through the same SQL functions as Supabase (supabase/schema.sql),
 * for the Node server with DATABASE_URL. Photos go in a table of their own.
 */
export class PgRepo implements Repo {
  private readonly pool: pg.Pool;
  private ready: Promise<void> | null = null;

  constructor(
    connectionString: string,
    private readonly schemaFile: string,
  ) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
  }

  /** Creates the tables and functions (the same SQL you paste into Supabase). */
  init(): Promise<void> {
    this.ready ??= (async () => {
      await this.pool.query(await readFile(this.schemaFile, 'utf8'));
      await this.pool.query('create table if not exists kazi_node_photos (task_id text primary key, bytes bytea not null)');
    })();
    return this.ready;
  }

  private async one<T>(sql: string, params: unknown[]): Promise<T | null> {
    await this.init();
    const res = await this.pool.query(sql, params);
    return (res.rows[0] ? Object.values(res.rows[0])[0] : null) as T | null;
  }

  async load(actorId: string, opts: { code?: string } = {}): Promise<Loaded> {
    return (await this.one<Loaded>('select kazi_load($1, $2)', [actorId, opts.code ?? null]))!;
  }

  async commit(changes: Changes): Promise<void> {
    try {
      await this.one('select kazi_commit($1::jsonb)', [JSON.stringify(commitPayload(changes))]);
    } catch (e) {
      const mapped = commitError(e instanceof Error ? e.message : String(e));
      if (mapped instanceof ConflictMarker) throw mapped.kind === 'taken' ? new TakenError() : new ConflictError();
      throw e;
    }
  }

  async findAccount(emailKey: string): Promise<Account | null> {
    return this.one<Account>('select kazi_find_account($1)', [emailKey]);
  }

  async getSession(tokenKey: string): Promise<Session | null> {
    return this.one<Session>('select kazi_session_get($1)', [tokenKey]);
  }

  async putSession(tokenKey: string, s: Session): Promise<void> {
    await this.one('select kazi_session_put($1, $2, $3, $4)', [tokenKey, s.accountId, s.createdAt, s.lastUsed]);
  }

  async deleteSession(tokenKey: string): Promise<void> {
    await this.one('select kazi_session_delete($1)', [tokenKey]);
  }

  async getPhoto(taskId: string): Promise<Uint8Array | null> {
    const b = await this.one<Buffer>('select bytes from kazi_node_photos where task_id = $1', [taskId]);
    return b ? new Uint8Array(b) : null;
  }

  async putPhoto(taskId: string, bytes: Uint8Array): Promise<void> {
    await this.one('insert into kazi_node_photos (task_id, bytes) values ($1, $2) on conflict (task_id) do update set bytes = excluded.bytes', [
      taskId,
      Buffer.from(bytes),
    ]);
  }

  async deletePhoto(taskId: string): Promise<void> {
    await this.one('delete from kazi_node_photos where task_id = $1', [taskId]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
