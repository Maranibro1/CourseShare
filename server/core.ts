/**
 * The Kazikwanza API, written against web-standard Request/Response and
 * WebCrypto only, so the same code runs in the Node server (server/node.ts)
 * and in a Supabase Edge Function (server/edge.ts).
 *
 *   POST /signup  /signin  /signout      accounts
 *   GET  /state                          everything the signed-in person may see
 *   POST /action                         one change, checked against the signed-in person
 *   PUT|GET /photos/:taskId              proof photos
 *   GET  /health
 *
 * The session token arrives in the X-Kazi-Token header (or Authorization: Bearer).
 */
import { applyAction, isActionName } from '../src/lib/actions';
import { KaziError, cleanUsername, signInKey, applyClaudeVerdict, canApprove, canReview, childrenOf, claudeCanCheck, createAccount, dailyTick, emptyData, isValidContact, normalizeContact } from '../src/lib/logic';
import { questionsFor } from '../src/lib/questions';
import { isValidTimeZone, withTimeZone } from '../src/lib/time';
import type { ClaudeChecker, Verdict } from './claude';
import type { AppData } from '../src/lib/types';
import { viewFor } from '../src/lib/view';
import { ConflictError, TakenError, affectedBy, diff, isEmpty, type Repo } from './repo';

export interface CoreOptions {
  repo: Repo;
  /** Zone for accounts that haven't told us theirs. */
  defaultTimeZone?: string;
  /** Called with everyone whose screen just changed, so their phones can refresh. */
  notify?: (accountIds: string[], accounts: AppData['accounts']) => void | Promise<void>;
  now?: () => number;
  /** PBKDF2 rounds for new passwords; lower only in tests. */
  passwordRounds?: number;
  /** Claude, for checking proof. Without it, Claude tasks are off and answers are taken on trust. */
  claude?: ClaudeChecker | null;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SESSION_IDLE_MS = 180 * 24 * 60 * 60 * 1000;
const JSON_LIMIT = 512 * 1024;
const PHOTO_LIMIT = 4 * 1024 * 1024;
const MAX_ATTEMPTS = 4;
const enc = new TextEncoder();

/* ───────── Crypto helpers (WebCrypto only) ───────── */

const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Tokens are stored only as hashes, so a leaked database can't be used to sign in. */
export async function tokenKey(token: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(token))));
}

async function pbkdf2(password: string, salt: Uint8Array, rounds: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256);
  return new Uint8Array(bits);
}

/** "pbkdf2-sha256$<rounds>$<salt>$<hash>". */
export async function hashPassword(password: string, rounds = 600_000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${rounds}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, rounds))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, roundsText, salt, hash] = stored.split('$');
  const rounds = Number(roundsText);
  if (scheme !== 'pbkdf2-sha256' || !Number.isInteger(rounds) || rounds < 1 || !salt || !hash) return false;
  const expected = fromB64url(hash);
  const actual = await pbkdf2(password, fromB64url(salt), rounds);
  // Compare every byte, so timing doesn't reveal how much matched.
  let diffBits = actual.length ^ expected.length;
  for (let i = 0; i < Math.min(actual.length, expected.length); i += 1) diffBits |= actual[i] ^ expected[i];
  return diffBits === 0;
}

/** Fixed-window counter: at most `limit` hits per `windowMs` for each key (per server instance). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}

/* ───────── Request helpers ───────── */

export async function readBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > limit) throw new HttpError(413, 'That is too large to upload.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, 'That is too large to upload.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await readBody(request, JSON_LIMIT);
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Something went wrong with that request. Please try again.');
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}

export function photoType(bytes: Uint8Array): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length > 8 && png.every((b, i) => bytes[i] === b)) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function etagOf(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', enc.encode(text)));
  return `"${b64url(digest)}"`;
}

/**
 * If-None-Match uses weak comparison: compressing proxies (Supabase's included)
 * turn "abc" into W/"abc", and the browser sends back what it received.
 */
export function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  const opaque = (t: string) => t.trim().replace(/^W\//, '');
  return header.split(',').some((t) => t.trim() === '*' || opaque(t) === opaque(etag));
}

/** The API route, whether the request came to /api/state (Node) or /functions/v1/kazi/state (Supabase). */
export function routeOf(pathname: string): string {
  const m = /\/(health|signup|signin|signout|state|action|photos\/[^/]+)\/?$/.exec(pathname);
  return m ? m[1] : '';
}

/* ───────── The API ───────── */

export function createCore(options: CoreOptions) {
  const { repo } = options;
  const now = options.now ?? Date.now;
  const defaultZone = isValidTimeZone(options.defaultTimeZone) ? options.defaultTimeZone : 'Africa/Nairobi';
  const rounds = options.passwordRounds ?? 600_000;
  // A hash we check against when the account doesn't exist, so timing doesn't reveal which emails are registered.
  const dummyHash = hashPassword(randomToken(), rounds);

  const authLimiter = new RateLimiter(20, 60_000);
  const failedLogins = new RateLimiter(10, 15 * 60_000);
  const actionLimiter = new RateLimiter(600, 60_000);
  const messageLimiter = new RateLimiter(30, 60_000);
  const claudeLimiter = new RateLimiter(6, 60_000);

  const zoneOf = (data: AppData, id: string) => data.accounts[id]?.timeZone ?? defaultZone;

  function tokenFrom(request: Request): string | null {
    const header = request.headers.get('x-kazi-token') ?? /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
    return /^[A-Za-z0-9_-]{20,200}$/.test(header) ? header : null;
  }

  /** The signed-in account, or a 401. */
  async function authenticate(request: Request): Promise<string> {
    const token = tokenFrom(request);
    if (!token) throw new HttpError(401, 'Please sign in again.');
    const key = await tokenKey(token);
    const session = await repo.getSession(key);
    const t = now();
    if (!session || t - session.lastUsed > SESSION_IDLE_MS) {
      if (session) await repo.deleteSession(key);
      throw new HttpError(401, 'Please sign in again.');
    }
    // Note recent use about once an hour rather than on every request.
    if (t - session.lastUsed > 60 * 60 * 1000) await repo.putSession(key, { ...session, lastUsed: t });
    return session.accountId;
  }

  async function startSession(accountId: string): Promise<string> {
    const token = randomToken();
    const t = now();
    await repo.putSession(await tokenKey(token), { accountId, createdAt: t, lastUsed: t });
    return token;
  }

  /** Runs the daily reset for this person and their children, in their time zones. */
  function tick(data: AppData, accountId: string): AppData {
    let out = data;
    for (const id of [accountId, ...childrenOf(data, accountId).map((c) => c.id)]) {
      out = withTimeZone(zoneOf(out, id), () => dailyTick(out, id, now()));
    }
    return out;
  }

  /**
   * Loads, changes and saves, retrying if another phone changed the same rows
   * meanwhile. Returns the new data and the change's result.
   */
  async function transact(actorId: string, change: (data: AppData) => { data: AppData; result?: unknown }, code?: string) {
    for (let attempt = 1; ; attempt += 1) {
      const loaded = await repo.load(actorId, { code });
      if (!loaded.data.accounts[actorId]) throw new HttpError(401, 'Please sign in again.');
      const out = change(tick(loaded.data, actorId));
      const changes = diff(loaded.data, out.data, loaded.versions);
      if (isEmpty(changes)) return { data: out.data, result: out.result, photosToDelete: [] as string[] };
      try {
        await repo.commit(changes);
      } catch (e) {
        if (e instanceof ConflictError && attempt < MAX_ATTEMPTS) continue;
        // Only a username can clash after sign-up (emails can't change).
        if (e instanceof TakenError) throw new KaziError('That username is taken. Try another.');
        if (e instanceof ConflictError) throw new HttpError(503, 'Kazikwanza is busy. Please try again.');
        throw e;
      }
      const affected = affectedBy(changes, actorId, out.data.accounts);
      try {
        await options.notify?.(affected, out.data.accounts);
      } catch {
        // Live updates are a bonus; phones also refresh on their own.
      }
      return { data: out.data, result: out.result, photosToDelete: changes.deletedTasks.map((t) => t.id) };
    }
  }

  async function stateResponse(data: AppData, me: string, request?: Request): Promise<Response> {
    const text = withTimeZone(zoneOf(data, me), () => JSON.stringify(viewFor(data, me)));
    const etag = await etagOf(text);
    if (request && matchesEtag(request.headers.get('if-none-match'), etag)) {
      return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } });
    }
    return new Response(`{"state":${text}}`, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', ETag: etag, 'Cache-Control': 'no-store' } });
  }

  async function signUp(request: Request, ip: string): Promise<Response> {
    if (!authLimiter.allow(`signup:${ip}`)) throw new HttpError(429, 'Too many tries. Wait a minute and try again.');
    const body = await readJson(request);
    const name = typeof body.name === 'string' ? body.name : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 6) throw new HttpError(400, 'Use at least 6 characters for your password');
    if (password.length > 200) throw new HttpError(400, 'That password is too long');
    if (!isValidContact(email)) throw new HttpError(400, 'Enter a valid email or phone number');
    if (await repo.findAccount(normalizeContact(email))) throw new KaziError('An account with this email or phone already exists. Sign in instead.');
    const rawUsername = typeof body.username === 'string' ? body.username : '';
    if (rawUsername.trim()) {
      const u = cleanUsername(rawUsername);
      if (!u) throw new KaziError('Usernames are 3–20 letters, numbers, dots or underscores');
      if (await repo.findAccount(`@${u}`)) throw new KaziError('That username is taken. Try another.');
    }
    const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : defaultZone;
    const created = createAccount(emptyData(), { name, email, username: rawUsername, passwordHash: await hashPassword(password, rounds), timeZone }, now());
    created.data.accounts[created.id].notifyKey = randomToken(18);
    created.data.sessionId = null;
    try {
      await repo.commit(diff(emptyData(), created.data, { accounts: {}, tasks: {} }));
    } catch (e) {
      if (e instanceof TakenError) throw new KaziError('That email, phone or username is already taken. Sign in instead, or pick another.');
      throw e;
    }
    const token = await startSession(created.id);
    const res = await stateResponse(created.data, created.id);
    return new Response(`{"token":${JSON.stringify(token)},${(await res.text()).slice(1)}`, { status: 201, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  async function signIn(request: Request, ip: string): Promise<Response> {
    if (!authLimiter.allow(`signin:${ip}`)) throw new HttpError(429, 'Too many tries. Wait a minute and try again.');
    const body = await readJson(request);
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const account = await repo.findAccount(signInKey(email));
    const limitKey = `fail:${account?.id ?? signInKey(email)}`;
    // Always do the slow comparison, so a wrong email takes as long as a wrong password.
    const ok = await verifyPassword(password, account?.passwordHash || (await dummyHash));
    if (!account || !ok) {
      if (!failedLogins.allow(limitKey)) throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes and try again.');
      throw new HttpError(400, 'That sign-in and password don’t match.');
    }
    failedLogins.reset(limitKey);
    const token = await startSession(account.id);
    const tz = isValidTimeZone(body.timeZone) ? body.timeZone : null;
    const { data } = await transact(account.id, (d) => {
      const a = d.accounts[account.id];
      if (!tz || a.timeZone === tz) return { data: d };
      return { data: { ...d, accounts: { ...d.accounts, [a.id]: { ...a, timeZone: tz } } } };
    });
    const res = await stateResponse(data, account.id);
    return new Response(`{"token":${JSON.stringify(token)},${(await res.text()).slice(1)}`, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  async function signOut(request: Request): Promise<Response> {
    const token = tokenFrom(request);
    if (token) await repo.deleteSession(await tokenKey(token));
    return json(200, { ok: true });
  }

  async function getState(request: Request): Promise<Response> {
    const me = await authenticate(request);
    const { data } = await transact(me, (d) => ({ data: d }));
    return stateResponse(data, me, request);
  }

  async function postAction(request: Request): Promise<Response> {
    const me = await authenticate(request);
    const body = await readJson(request);
    const name = typeof body.name === 'string' ? body.name : '';
    if (!isActionName(name)) throw new HttpError(400, 'Something went wrong with that request. Please try again.');
    if (!actionLimiter.allow(me)) throw new HttpError(429, 'Slow down a little and try again.');
    if (name === 'sendMessage' && !messageLimiter.allow(me)) throw new HttpError(429, 'You’re sending messages very fast. Wait a moment.');
    const args = (body.args ?? {}) as Record<string, unknown>;
    if (name === 'completeWithQuestions') {
      // Questions need a photo of the finished task too; it's kept with the answers as proof.
      const taskId = typeof args.taskId === 'string' ? args.taskId : '';
      const { data } = await repo.load(me);
      if (data.tasks[taskId]?.ownerId === me && !(await repo.getPhoto(taskId))) throw new HttpError(400, 'Take a photo of what you did first');
    }
    if (name === 'submitPhoto' || name === 'completeWithQuestions') {
      const viaClaude = await claudeAction(me, name, args);
      if (viaClaude) return viaClaude;
    }
    const code = name === 'joinFamily' && typeof args.code === 'string' ? args.code : undefined;
    const out = await transact(me, (d) => withTimeZone(zoneOf(d, me), () => applyAction(d, me, name, args, now())), code);
    // Photos are only needed until the task has been checked.
    const taskId = typeof args.taskId === 'string' ? args.taskId : null;
    const doneWith = new Set(out.photosToDelete);
    if (taskId && (name === 'approveTask' || name === 'requestRedo')) doneWith.add(taskId);
    for (const id of doneWith) await repo.deletePhoto(id).catch(() => undefined);
    const res = await stateResponse(out.data, me);
    const etag = res.headers.get('ETag') ?? '';
    return new Response(`${(await res.text()).slice(0, -1)},"etag":${JSON.stringify(etag)},"result":${JSON.stringify(out.result ?? null)}}`, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  /**
   * Proof that Claude checks: a photo for a Claude task, or question answers
   * when Claude is set up. Claude is asked first, then its verdict is saved.
   * Returns null when the action isn't one for Claude.
   */
  async function claudeAction(me: string, name: 'submitPhoto' | 'completeWithQuestions', args: Record<string, unknown>): Promise<Response | null> {
    const taskId = typeof args.taskId === 'string' ? args.taskId : '';
    const { data } = await repo.load(me);
    const task0 = data.tasks[taskId];
    if (!task0) return null;
    const kind = name === 'submitPhoto' ? 'photo' : 'answers';
    if (kind === 'photo' && task0.verify !== 'claude') return null;
    if (kind === 'answers' && (task0.verify !== 'questions' || !options.claude)) return null;
    const claude = options.claude;
    if (!claude) throw new HttpError(400, 'Claude isn’t set up on this server yet. Edit the task to use a verifier or questions.');
    let answers: string[] | null = null;
    if (kind === 'answers') {
      if (!Array.isArray(args.answers) || args.answers.length !== 3 || args.answers.some((a) => typeof a !== 'string' || a.length > 2000)) {
        throw new HttpError(400, 'Answer every question');
      }
      answers = args.answers as string[];
      if (answers.some((a) => a.trim().length < 3)) throw new HttpError(400, 'Answer every question');
    }
    const zone = zoneOf(data, me);
    withTimeZone(zone, () => claudeCanCheck(data, taskId, me, kind, now()));
    if (!claudeLimiter.allow(me)) throw new HttpError(429, 'Slow down a little and try again.');

    let verdict: Verdict;
    try {
      if (kind === 'photo') {
        const bytes = await repo.getPhoto(taskId);
        const type = bytes && photoType(bytes);
        if (!bytes || !type) throw new HttpError(400, 'Take a photo first');
        verdict = await claude.checkPhoto(task0, bytes, type as 'image/jpeg' | 'image/png' | 'image/webp');
      } else {
        const questions = questionsFor(task0.title);
        const bytes = await repo.getPhoto(taskId);
        const type = bytes && photoType(bytes);
        const photo = bytes && type ? { bytes, type: type as 'image/jpeg' | 'image/png' | 'image/webp' } : undefined;
        verdict = await claude.checkAnswers(task0, questions.map((question, i) => ({ question, answer: answers![i] })), photo);
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error('Claude check failed', e);
      throw new HttpError(503, 'Claude couldn’t check this right now. Please try again in a minute.');
    }

    const out = await transact(me, (d) => ({
      data: withTimeZone(zoneOf(d, me), () => applyClaudeVerdict(d, taskId, me, kind, verdict, answers, now())),
      result: { claude: verdict },
    }));
    if (kind === 'photo') await repo.deletePhoto(taskId).catch(() => undefined);
    const res = await stateResponse(out.data, me);
    const etag = res.headers.get('ETag') ?? '';
    return new Response(`${(await res.text()).slice(0, -1)},"etag":${JSON.stringify(etag)},"result":${JSON.stringify(out.result ?? null)}}`, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  async function putPhoto(request: Request, taskId: string): Promise<Response> {
    const me = await authenticate(request);
    const { data } = await repo.load(me);
    const task = data.tasks[taskId];
    if (!task || task.ownerId !== me) throw new HttpError(404, 'Task not found');
    if (task.status !== 'todo' && task.status !== 'redo') throw new HttpError(400, 'This task has already been sent');
    const bytes = await readBody(request, PHOTO_LIMIT);
    if (!photoType(bytes)) throw new HttpError(400, 'Choose a photo (JPEG, PNG or WebP)');
    await repo.putPhoto(taskId, bytes);
    return json(200, { ok: true });
  }

  async function getPhoto(request: Request, taskId: string): Promise<Response> {
    const me = await authenticate(request);
    const { data } = await repo.load(me);
    const task = data.tasks[taskId];
    const parentOfOwner = data.accounts[task?.ownerId ?? '']?.parentId === me;
    if (!task || !(task.ownerId === me || parentOfOwner || canApprove(data, task, me) || canReview(data, me, task.ownerId))) throw new HttpError(404, 'Photo not found');
    const bytes = await repo.getPhoto(taskId);
    const type = bytes && photoType(bytes);
    if (!bytes || !type) throw new HttpError(404, 'Photo not found');
    return new Response(bytes, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store' } });
  }

  /** Handles one API request. `ip` is used for rate limits on sign-in. */
  async function handle(request: Request, ip = 'unknown'): Promise<Response> {
    const route = routeOf(new URL(request.url).pathname);
    const method = request.method;
    try {
      if (route === 'health' && method === 'GET') return json(200, { ok: true, claude: !!options.claude });
      if (route === 'signup' && method === 'POST') return await signUp(request, ip);
      if (route === 'signin' && method === 'POST') return await signIn(request, ip);
      if (route === 'signout' && method === 'POST') return await signOut(request);
      if (route === 'state' && method === 'GET') return await getState(request);
      if (route === 'action' && method === 'POST') return await postAction(request);
      const photo = /^photos\/([A-Za-z0-9_-]{1,64})$/.exec(route);
      if (photo && method === 'PUT') return await putPhoto(request, photo[1]);
      if (photo && method === 'GET') return await getPhoto(request, photo[1]);
      return json(404, { error: 'Not found' });
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      if (e instanceof KaziError) return json(400, { error: e.message });
      console.error(e);
      return json(500, { error: 'Something went wrong on our side. Please try again.' });
    }
  }

  return { handle, authenticate };
}
