import type { Account } from '../src/lib/types';
import { photoType } from './core';
import { commitError, commitPayload, ConflictMarker } from './payload';
import { ConflictError, TakenError, type Changes, type Loaded, type Repo, type Session } from './repo';

const BUCKET = 'kazi-proofs';

/**
 * Supabase over plain HTTPS: the database functions through PostgREST
 * (/rest/v1/rpc), photos in Storage, live-update pings through Realtime.
 * Used inside the Edge Function with the service role key.
 */
export class SupabaseRepo implements Repo {
  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { apikey: this.serviceKey, ...extra };
    // Older keys are JWTs and also go in Authorization; the newer sb_secret_ keys only go in apikey.
    if (this.serviceKey.split('.').length === 3) h.Authorization = `Bearer ${this.serviceKey}`;
    return h;
  }

  private async rpc<T>(fn: string, params: Record<string, unknown>): Promise<T | null> {
    const res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify(params),
    });
    const text = await res.text();
    if (!res.ok) {
      const message = (() => {
        try {
          return (JSON.parse(text) as { message?: string }).message ?? text;
        } catch {
          return text;
        }
      })();
      const mapped = commitError(message);
      if (mapped instanceof ConflictMarker) throw mapped.kind === 'taken' ? new TakenError() : new ConflictError();
      throw new Error(`Supabase ${fn} failed (${res.status}): ${message}`);
    }
    return text ? (JSON.parse(text) as T | null) : null;
  }

  async load(actorId: string, opts: { code?: string } = {}): Promise<Loaded> {
    return (await this.rpc<Loaded>('kazi_load', { p_actor: actorId, p_code: opts.code ?? null }))!;
  }

  async commit(changes: Changes): Promise<void> {
    await this.rpc('kazi_commit', { p: commitPayload(changes) });
  }

  findAccount(emailKey: string): Promise<Account | null> {
    return this.rpc<Account>('kazi_find_account', { p_email_key: emailKey });
  }

  getSession(tokenKey: string): Promise<Session | null> {
    return this.rpc<Session>('kazi_session_get', { p_key: tokenKey });
  }

  async putSession(tokenKey: string, s: Session): Promise<void> {
    await this.rpc('kazi_session_put', { p_key: tokenKey, p_account: s.accountId, p_created: s.createdAt, p_last: s.lastUsed });
  }

  async deleteSession(tokenKey: string): Promise<void> {
    await this.rpc('kazi_session_delete', { p_key: tokenKey });
  }

  async getPhoto(taskId: string): Promise<Uint8Array | null> {
    const res = await fetch(`${this.url}/storage/v1/object/${BUCKET}/${encodeURIComponent(taskId)}`, { headers: this.headers() });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  async putPhoto(taskId: string, bytes: Uint8Array): Promise<void> {
    const res = await fetch(`${this.url}/storage/v1/object/${BUCKET}/${encodeURIComponent(taskId)}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': photoType(bytes) ?? 'application/octet-stream', 'x-upsert': 'true' }),
      body: bytes,
    });
    if (!res.ok) throw new Error(`Supabase storage upload failed (${res.status}): ${await res.text()}`);
  }

  async deletePhoto(taskId: string): Promise<void> {
    await fetch(`${this.url}/storage/v1/object/${BUCKET}/${encodeURIComponent(taskId)}`, { method: 'DELETE', headers: this.headers() });
  }

  /** Sends an empty "something changed" ping on each account's private channel. */
  async broadcast(topics: string[]): Promise<void> {
    if (topics.length === 0) return;
    await fetch(`${this.url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ messages: topics.map((topic) => ({ topic, event: 'change', payload: {} })) }),
    });
  }
}
