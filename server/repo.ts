/**
 * How the server reads and writes data, whatever the database.
 *
 * Each request loads only the slice of data the signed-in person needs
 * (subsetFor below; the SQL function kazi_load in supabase/schema.sql
 * follows the same rules), runs the shared rules on it, and writes back
 * just what changed (diff below). Accounts and tasks carry a version
 * number, so if two phones change the same row at once one of them
 * retries instead of silently overwriting the other.
 */
import { normalizeContact } from '../src/lib/logic';
import type { Account, AppData, AppNotification, LinkCode, Message, Task, TimeRequest } from '../src/lib/types';

export interface Versions {
  accounts: Record<string, number>;
  tasks: Record<string, number>;
}

export interface Loaded {
  data: AppData;
  versions: Versions;
}

export interface Changes {
  /** version null = new row. */
  accounts: { id: string; version: number | null; data: Account }[];
  tasks: { id: string; version: number | null; data: Task }[];
  deletedTasks: { id: string; version: number; data: Task }[];
  /** New or changed (read) notifications and messages. */
  notifications: AppNotification[];
  messages: Message[];
  linkCodes: LinkCode[];
  deletedCodes: string[];
  timeRequests: TimeRequest[];
}

export interface Session {
  accountId: string;
  createdAt: number;
  lastUsed: number;
}

/** Thrown when a row changed since it was loaded; the request is retried. */
export class ConflictError extends Error {}
/** Thrown when a new account's email or phone is already taken. */
export class TakenError extends Error {}

export interface Repo {
  load(actorId: string, opts?: { code?: string }): Promise<Loaded>;
  commit(changes: Changes): Promise<void>;
  /** Full account (with password hash) by normalized email/phone. */
  findAccount(emailKey: string): Promise<Account | null>;
  getSession(tokenKey: string): Promise<Session | null>;
  putSession(tokenKey: string, session: Session): Promise<void>;
  deleteSession(tokenKey: string): Promise<void>;
  getPhoto(taskId: string): Promise<Uint8Array | null>;
  putPhoto(taskId: string, bytes: Uint8Array): Promise<void>;
  deletePhoto(taskId: string): Promise<void>;
}

const emptyVersions = (): Versions => ({ accounts: {}, tasks: {} });

export function isEmpty(c: Changes): boolean {
  return (
    c.accounts.length + c.tasks.length + c.deletedTasks.length + c.notifications.length + c.messages.length + c.linkCodes.length + c.deletedCodes.length + c.timeRequests.length ===
    0
  );
}

/** Keys the database indexes accounts and tasks by. */
export function accountKeys(a: Account) {
  return {
    email_key: normalizeContact(a.email),
    verifier_key: a.verifier ? normalizeContact(a.verifier.contact) : null,
    parent_id: a.parentId,
  };
}

export function taskKeys(t: Task) {
  return {
    owner_id: t.ownerId,
    created_by: t.createdBy,
    verifier_id: t.verifierId,
    verifier_key: t.verifierContact ? normalizeContact(t.verifierContact) : null,
    approved_by: t.approvedBy,
  };
}

/**
 * The slice of data one person's requests can need: themselves, the people
 * they're connected to, tasks involving them or their children, their
 * messages, notifications, family codes and time requests.
 */
export function subsetFor(full: AppData, actorId: string, opts: { code?: string } = {}): AppData {
  const me = full.accounts[actorId];
  const out: AppData = { version: 1, sessionId: null, accounts: {}, tasks: {}, notifications: [], linkCodes: [], timeRequests: [], messages: [] };
  if (!me) return out;
  const meKey = normalizeContact(me.email);
  const verKey = me.verifier ? normalizeContact(me.verifier.contact) : null;
  const all = Object.values(full.accounts);
  const add = (a: Account | undefined) => {
    if (a) out.accounts[a.id] = a;
  };

  add(me);
  for (const a of all) {
    const k = accountKeys(a);
    if ((verKey && k.email_key === verKey) || k.verifier_key === meKey || a.id === me.parentId || a.parentId === actorId) add(a);
  }
  const children = new Set(all.filter((a) => a.parentId === actorId).map((a) => a.id));

  for (const t of Object.values(full.tasks)) {
    const k = taskKeys(t);
    if (
      k.owner_id === actorId ||
      children.has(k.owner_id) ||
      k.created_by === actorId ||
      k.verifier_id === actorId ||
      k.verifier_key === meKey ||
      k.approved_by === actorId
    ) {
      out.tasks[t.id] = t;
    }
  }
  const taskVerifierKeys = new Set<string>();
  for (const t of Object.values(out.tasks)) {
    const k = taskKeys(t);
    for (const id of [k.owner_id, k.created_by, k.verifier_id, k.approved_by]) if (id) add(full.accounts[id]);
    if (k.verifier_key) taskVerifierKeys.add(k.verifier_key);
  }
  for (const a of all) if (taskVerifierKeys.has(normalizeContact(a.email))) add(a);

  out.messages = full.messages.filter((m) => m.from === actorId || m.to === actorId);
  for (const m of out.messages) add(full.accounts[m.from === actorId ? m.to : m.from]);

  out.notifications = full.notifications
    .filter((n) => n.accountId === actorId)
    .sort((a, b) => b.at - a.at)
    .slice(0, 100);
  const code = opts.code?.trim().toUpperCase();
  out.linkCodes = full.linkCodes.filter((c) => c.parentId === actorId || (code && c.code === code));
  for (const c of out.linkCodes) add(full.accounts[c.parentId]);
  out.timeRequests = full.timeRequests.filter((r) => r.childId === actorId || r.parentId === actorId);
  return structuredClone(out);
}

/** JSON with object keys sorted, so the same data always gives the same text (Postgres reorders keys). */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** What has to be written to turn `before` into `after`. */
export function diff(before: AppData, after: AppData, versions: Versions): Changes {
  const c: Changes = { accounts: [], tasks: [], deletedTasks: [], notifications: [], messages: [], linkCodes: [], deletedCodes: [], timeRequests: [] };
  for (const [id, a] of Object.entries(after.accounts)) {
    const old = before.accounts[id];
    if (!old) c.accounts.push({ id, version: null, data: a });
    else if (!same(old, a)) c.accounts.push({ id, version: versions.accounts[id] ?? 0, data: a });
  }
  for (const [id, t] of Object.entries(after.tasks)) {
    const old = before.tasks[id];
    if (!old) c.tasks.push({ id, version: null, data: t });
    else if (!same(old, t)) c.tasks.push({ id, version: versions.tasks[id] ?? 0, data: t });
  }
  for (const [id, t] of Object.entries(before.tasks)) if (!after.tasks[id]) c.deletedTasks.push({ id, version: versions.tasks[id] ?? 0, data: t });

  // Notifications and messages are only ever added or marked read, never removed here.
  const oldNotes = new Map(before.notifications.map((n) => [n.id, n]));
  for (const n of after.notifications) if (!same(oldNotes.get(n.id), n)) c.notifications.push(n);
  const oldMessages = new Map(before.messages.map((m) => [m.id, m]));
  for (const m of after.messages) if (!same(oldMessages.get(m.id), m)) c.messages.push(m);

  const oldCodes = new Map(before.linkCodes.map((x) => [x.code, x]));
  const newCodes = new Set(after.linkCodes.map((x) => x.code));
  for (const x of after.linkCodes) if (!same(oldCodes.get(x.code), x)) c.linkCodes.push(x);
  for (const code of oldCodes.keys()) if (!newCodes.has(code)) c.deletedCodes.push(code);

  const oldRequests = new Map(before.timeRequests.map((r) => [r.id, r]));
  for (const r of after.timeRequests) if (!same(oldRequests.get(r.id), r)) c.timeRequests.push(r);
  return c;
}

/** Everyone whose screen a set of changes affects, so their phones can refresh. */
export function affectedBy(c: Changes, actorId: string, accounts: AppData['accounts']): string[] {
  const ids = new Set<string>([actorId]);
  const byKey = new Map(Object.values(accounts).map((a) => [normalizeContact(a.email), a.id]));
  for (const a of c.accounts) {
    ids.add(a.id);
    if (a.data.parentId) ids.add(a.data.parentId);
  }
  for (const t of [...c.tasks, ...c.deletedTasks].map((x) => x.data)) {
    const k = taskKeys(t);
    for (const id of [k.owner_id, k.created_by, k.verifier_id, k.approved_by]) if (id) ids.add(id);
    const v = k.verifier_key && byKey.get(k.verifier_key);
    if (v) ids.add(v);
  }
  for (const n of c.notifications) ids.add(n.accountId);
  for (const m of c.messages) {
    ids.add(m.from);
    ids.add(m.to);
  }
  for (const x of c.linkCodes) ids.add(x.parentId);
  for (const r of c.timeRequests) {
    ids.add(r.childId);
    ids.add(r.parentId);
  }
  return [...ids];
}

/**
 * Keeps everything in memory, saved through a callback (to a file, for one
 * small server). Used by the Node server without DATABASE_URL, and by tests.
 */
export class MemoryRepo implements Repo {
  data: AppData;
  versions: Versions;
  sessions: Record<string, Session>;
  private photos = new Map<string, Uint8Array>();

  constructor(
    initial: { data?: AppData; versions?: Versions; sessions?: Record<string, Session> } = {},
    private readonly save: (snapshot: { data: AppData; versions: Versions; sessions: Record<string, Session> }) => Promise<void> = async () => {},
    private readonly photoStore?: { get(id: string): Promise<Uint8Array | null>; put(id: string, b: Uint8Array): Promise<void>; delete(id: string): Promise<void> },
  ) {
    this.data = initial.data ?? { version: 1, sessionId: null, accounts: {}, tasks: {}, notifications: [], linkCodes: [], timeRequests: [], messages: [] };
    this.versions = initial.versions ?? emptyVersions();
    this.sessions = initial.sessions ?? {};
  }

  private persist() {
    return this.save({ data: this.data, versions: this.versions, sessions: this.sessions });
  }

  async load(actorId: string, opts: { code?: string } = {}): Promise<Loaded> {
    const data = subsetFor(this.data, actorId, opts);
    const versions = emptyVersions();
    for (const id of Object.keys(data.accounts)) versions.accounts[id] = this.versions.accounts[id] ?? 1;
    for (const id of Object.keys(data.tasks)) versions.tasks[id] = this.versions.tasks[id] ?? 1;
    return { data, versions };
  }

  async commit(c: Changes): Promise<void> {
    // Check everything first, so a conflict changes nothing.
    for (const a of c.accounts) {
      const exists = !!this.data.accounts[a.id];
      if (a.version === null) {
        if (exists) throw new ConflictError();
        const key = normalizeContact(a.data.email);
        if (Object.values(this.data.accounts).some((x) => normalizeContact(x.email) === key)) throw new TakenError();
      } else if (!exists || (this.versions.accounts[a.id] ?? 1) !== a.version) throw new ConflictError();
    }
    for (const t of [...c.tasks, ...c.deletedTasks]) {
      const exists = !!this.data.tasks[t.id];
      if (t.version === null ? exists : !exists || (this.versions.tasks[t.id] ?? 1) !== t.version) throw new ConflictError();
    }
    const d = this.data;
    for (const a of c.accounts) {
      d.accounts[a.id] = structuredClone(a.data);
      this.versions.accounts[a.id] = (a.version ?? 0) + 1;
    }
    for (const t of c.tasks) {
      d.tasks[t.id] = structuredClone(t.data);
      this.versions.tasks[t.id] = (t.version ?? 0) + 1;
    }
    for (const t of c.deletedTasks) {
      delete d.tasks[t.id];
      delete this.versions.tasks[t.id];
    }
    const upsert = <T extends { id: string }>(list: T[], rows: T[]) => {
      for (const r of rows) {
        const i = list.findIndex((x) => x.id === r.id);
        if (i >= 0) list[i] = structuredClone(r);
        else list.push(structuredClone(r));
      }
    };
    upsert(d.notifications, c.notifications);
    upsert(d.messages, c.messages);
    upsert(d.timeRequests, c.timeRequests);
    d.linkCodes = d.linkCodes.filter((x) => !c.deletedCodes.includes(x.code) && !c.linkCodes.some((y) => y.code === x.code));
    d.linkCodes.push(...structuredClone(c.linkCodes));
    // Keep each person's newest 100 notifications.
    const counts = new Map<string, number>();
    d.notifications = d.notifications
      .sort((a, b) => b.at - a.at)
      .filter((n) => {
        const k = (counts.get(n.accountId) ?? 0) + 1;
        counts.set(n.accountId, k);
        return k <= 100;
      });
    await this.persist();
  }

  async findAccount(emailKey: string): Promise<Account | null> {
    return structuredClone(Object.values(this.data.accounts).find((a) => normalizeContact(a.email) === emailKey) ?? null);
  }

  async getSession(tokenKey: string) {
    return this.sessions[tokenKey] ?? null;
  }

  async putSession(tokenKey: string, session: Session) {
    this.sessions[tokenKey] = session;
    await this.persist();
  }

  async deleteSession(tokenKey: string) {
    delete this.sessions[tokenKey];
    await this.persist();
  }

  async getPhoto(taskId: string) {
    return this.photoStore ? this.photoStore.get(taskId) : this.photos.get(taskId) ?? null;
  }

  async putPhoto(taskId: string, bytes: Uint8Array) {
    if (this.photoStore) await this.photoStore.put(taskId, bytes);
    else this.photos.set(taskId, bytes);
  }

  async deletePhoto(taskId: string) {
    if (this.photoStore) await this.photoStore.delete(taskId);
    else this.photos.delete(taskId);
  }
}
