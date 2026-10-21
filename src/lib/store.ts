import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { KaziError, dailyTick, emptyData, normalizeContact } from './logic';
import type { Account, AppData } from './types';

const STORAGE_KEY = 'kazikwanza:v1';

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw) as AppData;
    if (parsed?.version !== 1 || typeof parsed.accounts !== 'object') return emptyData();
    return { ...emptyData(), ...parsed };
  } catch {
    return emptyData();
  }
}

function save(data: AppData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    useStore.getState().showToast('Storage is full. Some changes may not be saved.');
  }
}

interface Toast {
  id: number;
  text: string;
}

interface StoreState {
  data: AppData;
  toast: Toast | null;
  /**
   * Applies a change. Returns false (and shows the message) when the change
   * is refused, so screens can stay put instead of navigating on.
   */
  run: (fn: (data: AppData, now: number) => AppData) => boolean;
  showToast: (text: string) => void;
  clearToast: () => void;
  reload: () => void;
}

let toastSeq = 0;

export const useStore = create<StoreState>((setState, getState) => ({
  data: load(),
  toast: null,
  run(fn) {
    try {
      const next = fn(getState().data, Date.now());
      if (next !== getState().data) {
        save(next);
        setState({ data: next });
      }
      return true;
    } catch (e) {
      if (e instanceof KaziError) {
        getState().showToast(e.message);
        return false;
      }
      throw e;
    }
  },
  showToast(text) {
    toastSeq += 1;
    setState({ toast: { id: toastSeq, text } });
  },
  clearToast() {
    setState({ toast: null });
  },
  reload() {
    setState({ data: load() });
  },
}));

// Keep several open tabs (e.g. Sam and Emma side by side) in sync.
if (typeof window !== 'undefined') {
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

export const run = (fn: (data: AppData, now: number) => AppData) => useStore.getState().run(fn);
export const toast = (text: string) => useStore.getState().showToast(text);

/** Current time, refreshed on an interval, for clocks and countdowns. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Runs the daily reset and session checks for the signed-in account. */
export function useDailyTick() {
  const sessionId = useStore((s) => s.data.sessionId);
  const now = useNow(5000);
  useEffect(() => {
    if (sessionId) run((d, t) => dailyTick(d, sessionId, t));
  }, [sessionId, now]);
}

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
