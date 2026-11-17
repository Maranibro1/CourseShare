import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { applyAction, type ActionName } from './actions';
import { KaziError, createAccount, dailyTick, emptyData, normalizeContact, signIn as localSignIn, signOut as localSignOut } from './logic';
import { deviceTimeZone } from './time';
import type { Account, AppData } from './types';

/*
 * Two ways to run, fixed when the app is built:
 * - on its own (default): everything is stored on this phone;
 * - with the sync server (VITE_SYNC=server): accounts, tasks, photos and
 *   messages live on the server, so verifiers and parents can use their own
 *   phones. VITE_API_URL points at the server ("" = the site the app came from).
 */
export const SERVER_MODE = import.meta.env.VITE_SYNC === 'server';
export const API_BASE = String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

const STORAGE_KEY = 'kazikwanza:v1';
const TOKEN_KEY = 'kazikwanza:token';
const CACHE_KEY = 'kazikwanza:server-cache';

function readJson(key: string): AppData | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppData;
    if (parsed?.version !== 1 || typeof parsed.accounts !== 'object') return null;
    return { ...emptyData(), ...parsed };
  } catch {
    return null;
  }
}

function writeJson(key: string, data: AppData | null) {
  try {
    if (data === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(data));
  } catch {
    useStore.getState().showToast('Storage is full. Some changes may not be saved.');
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Private mode: stays signed in for this visit only. */
  }
}

function initialData(): AppData {
  if (!SERVER_MODE) return readJson(STORAGE_KEY) ?? emptyData();
  // Show the last copy straight away (and offline); a fresh one follows.
  return (readToken() && readJson(CACHE_KEY)) || emptyData();
}

interface Toast {
  id: number;
  text: string;
}

interface StoreState {
  data: AppData;
  toast: Toast | null;
  /** Server mode: the first fetch after opening the app hasn't finished yet. */
  syncing: boolean;
  setData: (data: AppData) => void;
  showToast: (text: string) => void;
  clearToast: () => void;
  reload: () => void;
}

let toastSeq = 0;

export const useStore = create<StoreState>((setState, getState) => ({
  data: initialData(),
  toast: null,
  syncing: SERVER_MODE && !!readToken(),
  setData(data) {
    if (data === getState().data) return;
    writeJson(SERVER_MODE ? CACHE_KEY : STORAGE_KEY, data);
    setState({ data });
  },
  showToast(text) {
    toastSeq += 1;
    setState({ toast: { id: toastSeq, text } });
  },
  clearToast() {
    setState({ toast: null });
  },
  reload() {
    if (!SERVER_MODE) setState({ data: readJson(STORAGE_KEY) ?? emptyData() });
  },
}));

// Keep several open tabs in sync when everything is stored on this device.
if (typeof window !== 'undefined' && !SERVER_MODE) {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) useStore.getState().reload();
  });
}

export function useData(): AppData {
  return useStore((s) => s.data);
}

export function useMe(): Account | null {
  return useStore((s) => (s.data.sessionId ? s.data.accounts[s.data.sessionId] ?? null : null));
}

/** Like useMe, for screens that are only reachable when signed in. */
export function useAccount(): Account {
  const me = useMe();
  if (!me) throw new Error('Not signed in');
  return me;
}

export const toast = (text: string) => useStore.getState().showToast(text);

/* ───────── Talking to the server ───────── */

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const OFFLINE = 'Can’t reach Kazikwanza. Check your internet connection and try again.';

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = readToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, body });
  } catch {
    throw new ApiError(OFFLINE, 0);
  }
  if (res.status === 401 && token) {
    // The session ended (signed out elsewhere or expired).
    forgetSession();
    throw new ApiError('Please sign in again.', 401);
  }
  if (res.status === 304) return undefined as T;
  const type = res.headers.get('Content-Type') ?? '';
  const payload = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError((payload as { error?: string } | null)?.error ?? OFFLINE, res.status);
  return payload as T;
}

function forgetSession() {
  writeToken(null);
  writeJson(CACHE_KEY, null);
  useStore.setState({ data: emptyData(), syncing: false });
}

let etag: string | null = null;

/** Server mode: fetch the latest copy of everything this person can see. */
export async function refresh(): Promise<void> {
  if (!SERVER_MODE || !readToken()) return;
  try {
    const headers: HeadersInit = etag ? { 'If-None-Match': etag } : {};
    const token = readToken();
    const res = await fetch(`${API_BASE}/api/state`, { headers: { ...headers, Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      forgetSession();
      return;
    }
    if (res.status === 304) return;
    if (!res.ok) return;
    etag = res.headers.get('ETag');
    const { state } = (await res.json()) as { state: AppData };
    useStore.getState().setData(state);
  } catch {
    /* Offline: keep showing the last copy. */
  } finally {
    if (useStore.getState().syncing) useStore.setState({ syncing: false });
  }
}

/* ───────── Changing things ───────── */

export interface ActOutcome {
  ok: boolean;
  result?: unknown;
}

/**
 * Applies a change as the signed-in person. On failure the reason is shown
 * and `ok` is false, so screens stay put instead of moving on.
 *
 * With the server, changes are sent one at a time, in order, and each is
 * also applied on the phone straight away (the rules are the same code), so
 * a second tap already sees the first. The server's answer then replaces the
 * guess; if the server refuses, the guess is rolled back.
 */
let sending: Promise<unknown> = Promise.resolve();

export function act(name: ActionName, args: Record<string, unknown> = {}): Promise<ActOutcome> {
  if (!SERVER_MODE) return Promise.resolve(actLocally(name, args));
  const next = sending.then(() => actOnServer(name, args));
  sending = next.catch(() => undefined);
  return next;
}

function actLocally(name: ActionName, args: Record<string, unknown>): ActOutcome {
  const { data, setData, showToast } = useStore.getState();
  const actor = data.sessionId;
  if (!actor) {
    showToast('Please sign in again.');
    return { ok: false };
  }
  try {
    const out = applyAction(data, actor, name, args, Date.now());
    setData(out.data);
    return { ok: true, result: out.result };
  } catch (e) {
    if (e instanceof KaziError) {
      showToast(e.message);
      return { ok: false };
    }
    throw e;
  }
}

async function actOnServer(name: ActionName, args: Record<string, unknown>): Promise<ActOutcome> {
  const { data: before, setData, showToast } = useStore.getState();
  const actor = before.sessionId;
  if (!actor) {
    showToast('Please sign in again.');
    return { ok: false };
  }
  // Family codes are random, so a guess would show a different code from the server's.
  if (name !== 'createLinkCode') {
    try {
      setData(applyAction(before, actor, name, args, Date.now()).data);
    } catch {
      // This phone may not hold everything the change needs (a family code, say); the server decides.
    }
  }
  try {
    const out = await api<{ state: AppData; result?: unknown; etag?: string }>('/api/action', { method: 'POST', json: { name, args } });
    if (out.etag) etag = out.etag;
    setData(out.state);
    return { ok: true, result: out.result };
  } catch (e) {
    showToast(e instanceof Error ? e.message : OFFLINE);
    if (useStore.getState().data.sessionId === actor) {
      setData(before);
      etag = null;
      void refresh();
    }
    return { ok: false };
  }
}

/* ───────── Accounts ───────── */

export async function hashPassword(contact: string, password: string): Promise<string> {
  const text = `kazikwanza:${normalizeContact(contact)}:${password}`;
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Insecure contexts (plain http on a LAN) have no SubtleCrypto; fall back to FNV-1a.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv:${(h >>> 0).toString(16)}`;
}

/** Creates an account and signs in. Throws with a message to show when refused. */
export async function signUp(input: { name: string; email: string; password: string }): Promise<void> {
  const timeZone = deviceTimeZone();
  if (!SERVER_MODE) {
    const passwordHash = await hashPassword(input.email, input.password);
    const result = createAccount(useStore.getState().data, { name: input.name, email: input.email, passwordHash, timeZone }, Date.now());
    useStore.getState().setData(result.data);
    return;
  }
  const out = await api<{ token: string; state: AppData }>('/api/signup', { method: 'POST', json: { ...input, timeZone } });
  writeToken(out.token);
  useStore.getState().setData(out.state);
}

export async function signIn(input: { email: string; password: string }): Promise<void> {
  if (!SERVER_MODE) {
    const passwordHash = await hashPassword(input.email, input.password);
    useStore.getState().setData(localSignIn(useStore.getState().data, input.email, passwordHash));
    return;
  }
  const out = await api<{ token: string; state: AppData }>('/api/signin', { method: 'POST', json: { ...input, timeZone: deviceTimeZone() } });
  writeToken(out.token);
  useStore.getState().setData(out.state);
}

export async function signOut(): Promise<void> {
  if (!SERVER_MODE) {
    useStore.getState().setData(localSignOut(useStore.getState().data, Date.now()));
    return;
  }
  await api('/api/signout', { method: 'POST', json: {} }).catch(() => undefined);
  forgetSession();
}

/** Turns errors from signUp/signIn into a message for the form. */
export function errorMessage(e: unknown): string {
  if (e instanceof KaziError || e instanceof ApiError) return e.message;
  return OFFLINE;
}

/* ───────── Clocks ───────── */

/** Current time, refreshed on an interval, for clocks and countdowns. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Keeps the day moving: on its own, the app runs the daily reset itself;
 * with the server, it re-fetches (the server runs the reset).
 */
export function useDailyTick() {
  const sessionId = useStore((s) => s.data.sessionId);
  const now = useNow(SERVER_MODE ? 30_000 : 5000);
  useEffect(() => {
    if (!sessionId) return;
    if (SERVER_MODE) {
      void refresh();
      return;
    }
    const { data, setData } = useStore.getState();
    setData(dailyTick(data, sessionId, Date.now()));
  }, [sessionId, now]);
}

/** Server mode: keep this person's account in their phone's time zone. */
export function useTimeZoneSync() {
  const me = useMe();
  useEffect(() => {
    if (!me) return;
    const tz = deviceTimeZone();
    if (me.timeZone !== tz) void act('updateProfile', { patch: { timeZone: tz } });
  }, [me?.id, me?.timeZone]); // eslint-disable-line react-hooks/exhaustive-deps
}

/* ───────── Live updates ───────── */

/**
 * Server mode: listens for "something changed" from the server and refetches,
 * so approvals and messages appear within a second. Falls back to polling.
 */
export function useLiveUpdates() {
  const sessionId = useStore((s) => s.data.sessionId);
  useEffect(() => {
    if (!SERVER_MODE || !sessionId) return;
    let stopped = false;
    let controller: AbortController | null = null;

    async function listen() {
      while (!stopped) {
        controller = new AbortController();
        try {
          const res = await fetch(`${API_BASE}/api/events`, {
            headers: { Authorization: `Bearer ${readToken()}` },
            signal: controller.signal,
          });
          if (res.status === 401) {
            forgetSession();
            return;
          }
          if (!res.ok || !res.body) throw new Error('no stream');
          void refresh();
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let cut: number;
            while ((cut = buffer.indexOf('\n\n')) >= 0) {
              const chunk = buffer.slice(0, cut);
              buffer = buffer.slice(cut + 2);
              if (chunk.includes('event: change')) void refresh();
            }
          }
        } catch {
          /* Dropped connection: wait, then reconnect. */
        }
        if (!stopped) await new Promise((r) => setTimeout(r, 3000));
      }
    }

    void listen();
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    const poll = window.setInterval(() => document.visibilityState === 'visible' && void refresh(), 20_000);
    return () => {
      stopped = true;
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.clearInterval(poll);
    };
  }, [sessionId]);
}
