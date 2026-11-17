import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { applyAction, isActionName } from '../src/lib/actions';
import { KaziError, canApprove, childrenOf, createAccount, dailyTick, emptyData, findAccountByContact, isValidContact } from '../src/lib/logic';
import { isValidTimeZone, withTimeZone } from '../src/lib/time';
import type { AppData } from '../src/lib/types';
import { viewFor } from '../src/lib/view';
import { DUMMY_HASH, RateLimiter, hashPassword, newToken, tokenKey, verifyPassword } from './auth';
import type { ServerState, Storage } from './storage';

export interface ServerOptions {
  storage: Storage;
  /** Built web app to serve (the Vite `dist` folder). Optional for an API-only server. */
  staticDir?: string;
  /** Extra origins allowed to call the API, besides this site and the Android app. */
  allowedOrigins?: string[];
  /** Zone used for accounts that haven't told us theirs. */
  defaultTimeZone?: string;
  now?: () => number;
}

const SESSION_IDLE_MS = 180 * 24 * 60 * 60 * 1000;
const JSON_LIMIT = 512 * 1024;
const PHOTO_LIMIT = 4 * 1024 * 1024;
// The Android app's web view runs at https://localhost (http://localhost on older setups).
const APP_ORIGINS = ['https://localhost', 'http://localhost', 'capacitor://localhost'];

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
};

function photoType(bytes: Buffer): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new HttpError(413, 'That is too large to upload.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'That is too large to upload.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req, JSON_LIMIT);
  try {
    const parsed = JSON.parse(body.toString('utf8') || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Something went wrong with that request. Please try again.');
  }
}

function etagOf(json: string): string {
  return `"${createHash('sha1').update(json).digest('base64url')}"`;
}

export async function createKaziServer(options: ServerOptions) {
  const { storage } = options;
  const now = options.now ?? Date.now;
  const defaultZone = isValidTimeZone(options.defaultTimeZone) ? options.defaultTimeZone : 'Africa/Nairobi';
  const allowedOrigins = new Set([...APP_ORIGINS, ...(options.allowedOrigins ?? [])]);
  const staticRoot = options.staticDir ? resolve(options.staticDir) : null;

  const loaded = await storage.load();
  const state: ServerState = loaded ?? { app: emptyData(), sessions: {} };
  state.app = { ...emptyData(), ...state.app, sessionId: null };

  /* ───────── Saving, one write at a time ───────── */

  let saving: Promise<void> = Promise.resolve();
  function persist(): Promise<void> {
    const snapshot = structuredClone(state);
    saving = saving.then(() => storage.save(snapshot));
    return saving;
  }

  /* ───────── Live updates ───────── */

  interface Listener {
    accountId: string;
    res: ServerResponse;
    lastTag: string;
  }
  const listeners = new Set<Listener>();

  function viewJson(accountId: string): string {
    const account = state.app.accounts[accountId];
    return withTimeZone(account?.timeZone ?? defaultZone, () => JSON.stringify(viewFor(state.app, accountId)));
  }

  /** Tells each connected phone whose view just changed to fetch it again. */
  function broadcast() {
    for (const l of listeners) {
      if (!state.app.accounts[l.accountId]) continue;
      const tag = etagOf(viewJson(l.accountId));
      if (tag === l.lastTag) continue;
      l.lastTag = tag;
      l.res.write(`event: change\ndata: {}\n\n`);
    }
  }

  /* ───────── Helpers ───────── */

  const authLimiter = new RateLimiter(20, 60_000);
  const failedLogins = new RateLimiter(10, 15 * 60_000);
  const actionLimiter = new RateLimiter(600, 60_000);
  const messageLimiter = new RateLimiter(30, 60_000);

  function clientIp(req: IncomingMessage): string {
    return req.socket.remoteAddress ?? 'unknown';
  }

  function authenticate(req: IncomingMessage): string {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
    if (!match) throw new HttpError(401, 'Please sign in again.');
    const key = tokenKey(match[1]);
    const session = state.sessions[key];
    const t = now();
    if (!session || t - session.lastUsed > SESSION_IDLE_MS || !state.app.accounts[session.accountId]) {
      if (session) delete state.sessions[key];
      throw new HttpError(401, 'Please sign in again.');
    }
    session.lastUsed = t;
    return session.accountId;
  }

  /** Runs the daily reset for this person and their children, in their time zone. */
  function tick(accountId: string): boolean {
    const before = state.app;
    const zone = state.app.accounts[accountId]?.timeZone ?? defaultZone;
    const ids = [accountId, ...childrenOf(state.app, accountId).map((c) => c.id)];
    for (const id of ids) {
      const childZone = state.app.accounts[id]?.timeZone ?? zone;
      state.app = withTimeZone(childZone, () => dailyTick(state.app, id, now()));
    }
    return state.app !== before;
  }

  function startSession(accountId: string): string {
    const token = newToken();
    const t = now();
    state.sessions[tokenKey(token)] = { accountId, createdAt: t, lastUsed: t };
    // Drop sessions nobody has used for months.
    for (const [key, s] of Object.entries(state.sessions)) if (t - s.lastUsed > SESSION_IDLE_MS) delete state.sessions[key];
    return token;
  }

  function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(json);
  }

  function stateResponse(accountId: string) {
    const json = viewJson(accountId);
    return { json, etag: etagOf(json) };
  }

  /* ───────── API routes ───────── */

  async function signUp(req: IncomingMessage, res: ServerResponse) {
    if (!authLimiter.allow(`signup:${clientIp(req)}`)) throw new HttpError(429, 'Too many tries. Wait a minute and try again.');
    const body = await readJson(req);
    const name = typeof body.name === 'string' ? body.name : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 6) throw new HttpError(400, 'Use at least 6 characters for your password');
    if (password.length > 200) throw new HttpError(400, 'That password is too long');
    if (!isValidContact(email)) throw new HttpError(400, 'Enter a valid email or phone number');
    const passwordHash = await hashPassword(password);
    const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : defaultZone;
    // createAccount checks the name and that the email/phone is free.
    const result = createAccount(state.app, { name, email, passwordHash, timeZone }, now());
    state.app = { ...result.data, sessionId: null };
    const token = startSession(result.id);
    await persist();
    send(res, 201, { token, state: JSON.parse(viewJson(result.id)) });
  }

  async function signIn(req: IncomingMessage, res: ServerResponse) {
    if (!authLimiter.allow(`signin:${clientIp(req)}`)) throw new HttpError(429, 'Too many tries. Wait a minute and try again.');
    const body = await readJson(req);
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const account = findAccountByContact(state.app, email);
    const limitKey = `fail:${account?.id ?? email.trim().toLowerCase()}`;
    // Always do the slow comparison, so a wrong email takes as long as a wrong password.
    const ok = await verifyPassword(password, account?.passwordHash ?? DUMMY_HASH);
    if (!account || !ok) {
      if (!failedLogins.allow(limitKey)) throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes and try again.');
      throw new HttpError(400, 'That email/phone and password don’t match.');
    }
    failedLogins.reset(limitKey);
    if (isValidTimeZone(body.timeZone) && account.timeZone !== body.timeZone) {
      state.app = { ...state.app, accounts: { ...state.app.accounts, [account.id]: { ...account, timeZone: body.timeZone } } };
    }
    const token = startSession(account.id);
    tick(account.id);
    await persist();
    send(res, 200, { token, state: JSON.parse(viewJson(account.id)) });
  }

  async function signOut(req: IncomingMessage, res: ServerResponse) {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer (.+)$/.exec(header);
    if (match) {
      delete state.sessions[tokenKey(match[1])];
      await persist();
    }
    send(res, 200, { ok: true });
  }

  async function getState(req: IncomingMessage, res: ServerResponse) {
    const me = authenticate(req);
    if (tick(me)) {
      await persist();
      broadcast();
    }
    const { json, etag } = stateResponse(me);
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ETag: etag, 'Cache-Control': 'no-store' });
    res.end(`{"state":${json}}`);
  }

  async function postAction(req: IncomingMessage, res: ServerResponse) {
    const me = authenticate(req);
    const body = await readJson(req);
    const name = typeof body.name === 'string' ? body.name : '';
    if (!isActionName(name)) throw new HttpError(400, 'Something went wrong with that request. Please try again.');
    if (!actionLimiter.allow(me)) throw new HttpError(429, 'Slow down a little and try again.');
    if (name === 'sendMessage' && !messageLimiter.allow(me)) throw new HttpError(429, 'You’re sending messages very fast. Wait a moment.');
    const before = state.app;
    tick(me);
    const zone = state.app.accounts[me]?.timeZone ?? defaultZone;
    const out = withTimeZone(zone, () => applyAction(state.app, me, name, body.args ?? {}, now()));
    state.app = { ...out.data, sessionId: null };
    // Photos are only needed until the task has been checked.
    const taskId = (body.args as { taskId?: unknown } | undefined)?.taskId;
    if (typeof taskId === 'string' && ['approveTask', 'requestRedo', 'deleteTask'].includes(name)) {
      await storage.deletePhoto(taskId).catch(() => undefined);
    }
    if (state.app !== before) await persist();
    const { json, etag } = stateResponse(me);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`{"state":${json},"etag":${JSON.stringify(etag)},"result":${JSON.stringify(out.result ?? null)}}`);
    broadcast();
  }

  async function putPhoto(req: IncomingMessage, res: ServerResponse, taskId: string) {
    const me = authenticate(req);
    const task = state.app.tasks[taskId];
    if (!task || task.ownerId !== me) throw new HttpError(404, 'Task not found');
    if (task.status !== 'todo' && task.status !== 'redo') throw new HttpError(400, 'This task has already been sent');
    if (task.verify !== 'photo') throw new HttpError(400, 'This task is verified with questions');
    const bytes = await readBody(req, PHOTO_LIMIT);
    if (!photoType(bytes)) throw new HttpError(400, 'Choose a photo (JPEG, PNG or WebP)');
    await storage.putPhoto(taskId, bytes);
    send(res, 200, { ok: true });
  }

  async function getPhoto(req: IncomingMessage, res: ServerResponse, taskId: string) {
    const me = authenticate(req);
    const task = state.app.tasks[taskId];
    const allowed = task && (task.ownerId === me || canApprove(state.app, task, me));
    if (!allowed) throw new HttpError(404, 'Photo not found');
    const bytes = await storage.getPhoto(taskId);
    const type = bytes && photoType(bytes);
    if (!bytes || !type) throw new HttpError(404, 'Photo not found');
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'private, no-store' });
    res.end(bytes);
  }

  function events(req: IncomingMessage, res: ServerResponse) {
    const me = authenticate(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // Stop proxies such as nginx from holding the stream back.
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    const listener: Listener = { accountId: me, res, lastTag: etagOf(viewJson(me)) };
    listeners.add(listener);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      listeners.delete(listener);
    });
  }

  /* ───────── Static files ───────── */

  async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
    if (!staticRoot) throw new HttpError(404, 'Not found');
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(staticRoot, rel));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) throw new HttpError(404, 'Not found');
    let info;
    try {
      info = await stat(file);
    } catch {
      info = null;
    }
    if (!info || !info.isFile()) {
      // The app uses #/ routes, so anything else that isn't a file is a wrong link.
      throw new HttpError(404, 'Not found');
    }
    const ext = extname(file).toLowerCase();
    const immutable = rel.startsWith('/assets/');
    const headers: Record<string, string | number> = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    if (ext === '.apk') headers['Content-Disposition'] = 'attachment; filename="kazikwanza.apk"';
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  }

  /* ───────── Request handling ───────── */

  function cors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    if (!origin) return;
    const host = req.headers.host;
    const sameSite = host && (origin === `https://${host}` || origin === `http://${host}`);
    if (sameSite || allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'ETag');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url ?? '/', 'http://local');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (path.startsWith('/api/')) {
      cors(req, res);
      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      const photo = /^\/api\/photos\/([A-Za-z0-9_-]{1,64})$/.exec(path);
      if (path === '/api/health' && method === 'GET') return send(res, 200, { ok: true });
      if (path === '/api/signup' && method === 'POST') return signUp(req, res);
      if (path === '/api/signin' && method === 'POST') return signIn(req, res);
      if (path === '/api/signout' && method === 'POST') return signOut(req, res);
      if (path === '/api/state' && method === 'GET') return getState(req, res);
      if (path === '/api/action' && method === 'POST') return postAction(req, res);
      if (path === '/api/events' && method === 'GET') return events(req, res);
      if (photo && method === 'PUT') return putPhoto(req, res, photo[1]);
      if (photo && method === 'GET') return getPhoto(req, res, photo[1]);
      throw new HttpError(404, 'Not found');
    }

    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    return serveStatic(req, res, path);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e instanceof KaziError) return send(res, 400, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
    });
  });

  return {
    server,
    /** Waits for pending writes; for tests and shutdown. */
    flush: () => saving,
    state: () => state as { app: AppData; sessions: ServerState['sessions'] },
  };
}
