import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { normalizePhoneApps } from './apps';
import { applyNativeEvents, nativeRules, type NativeRules, type NativeUsageEvent } from './logic';
import { deviceId, deviceOwner, setDeviceOwner } from './device';
import { SERVER_MODE, act, useStore } from './store';
import type { Account, AppData } from './types';

interface KaziLockPlugin {
  getStatus(): Promise<{ accessibility: boolean; usage: boolean }>;
  openAccessibilitySettings(): Promise<void>;
  openUsageAccessSettings(): Promise<void>;
  openAppInfo(): Promise<void>;
  sync(rules: NativeRules): Promise<void>;
  drain(options: { after: number }): Promise<{ events: NativeUsageEvent[] }>;
  openApp(options: { packages: string[] }): Promise<{ opened: boolean }>;
  /** Apps with an icon on the home screen, except the phone, Settings, home screens and Kazikwanza. */
  listApps(): Promise<{ apps: { pkg: string; name: string; icon?: string }[] }>;
  /** `kind` says which part of YouTube was locked: Shorts ("scrolls") or videos ("minutes"). */
  addListener(event: 'locked', fn: (e: { appId: string; kind?: string }) => void): Promise<PluginListenerHandle>;
}

/** True inside the Android app, where real apps can be locked. */
export const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const KaziLock = registerPlugin<KaziLockPlugin>('KaziLock');

export async function lockStatus(): Promise<{ accessibility: boolean; usage: boolean }> {
  if (!isNativeAndroid) return { accessibility: false, usage: false };
  try {
    return await KaziLock.getStatus();
  } catch {
    return { accessibility: false, usage: false };
  }
}

/** Live permission status, re-checked while the screen is open (people come back from Settings). */
export function useLockStatus(): { accessibility: boolean; usage: boolean } | null {
  const [status, setStatus] = useState<{ accessibility: boolean; usage: boolean } | null>(null);
  useEffect(() => {
    if (!isNativeAndroid) return;
    let alive = true;
    const check = () => lockStatus().then((s) => alive && setStatus(s));
    void check();
    const timer = window.setInterval(check, 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return status;
}

/**
 * The full account whose rules this phone enforces, or undefined. With the
 * server, only the signed-in person's own account is complete, so if someone
 * else is signed in on this phone the last rules simply stay in force.
 */
function owner(data: AppData): Account | undefined {
  claimPhone(data);
  const id = deviceOwner();
  if (!id) return undefined;
  if (SERVER_MODE && data.sessionId !== id) return undefined;
  return data.accounts[id];
}

/**
 * The phone follows whoever is signed in on it, so their scrolls and screen
 * time are the ones the lock checks, and their swipes land in their wallet.
 * The one exception: a parent signing in on their child's phone leaves the
 * child's rules in force.
 */
export function claimPhone(data: AppData): void {
  if (!isNativeAndroid) return;
  const me = data.sessionId ? data.accounts[data.sessionId] : undefined;
  if (!me || deviceOwner() === me.id) return;
  const current = deviceOwner() ? data.accounts[deviceOwner()!] : undefined;
  if (current && current.parentId === me.id) return;
  setDeviceOwner(me.id);
}

/* ───────── Apps installed on this phone ───────── */

/** Icons of the phone's apps, by package. Kept in memory only: they never leave the phone. */
let icons: ReadonlyMap<string, string> = new Map();
const iconListeners = new Set<() => void>();
let lastScan = 0;
let scanning: Promise<void> | null = null;
const RESCAN_MS = 10 * 60_000;

/**
 * Asks the phone which apps are installed and saves the list on the account of
 * the person this phone belongs to, so they (or their parent, from another
 * phone) can give any of them a screen-time limit.
 */
export function scanPhoneApps(force = false): Promise<void> {
  if (!isNativeAndroid) return Promise.resolve();
  if (scanning) return scanning;
  if (!force && Date.now() - lastScan < RESCAN_MS) return Promise.resolve();
  lastScan = Date.now();
  scanning = (async () => {
    try {
      const { apps } = await KaziLock.listApps();
      const nextIcons = new Map<string, string>();
      for (const a of apps) if (a.icon?.startsWith('data:image/')) nextIcons.set(a.pkg, a.icon);
      icons = nextIcons;
      iconListeners.forEach((l) => l());
      const data = useStore.getState().data;
      const me = owner(data);
      // Only the phone's own person: someone else signed in here doesn't get this phone's list.
      if (!me || data.sessionId !== me.id) {
        // Nobody to save it for yet (say, before setup marks the phone as theirs): try again next time.
        lastScan = 0;
        return;
      }
      const list = normalizePhoneApps(apps.map(({ pkg, name }) => ({ pkg, name })));
      if (JSON.stringify(list) !== JSON.stringify(me.phoneApps ?? [])) await act('updateProfile', { patch: { phoneApps: list } });
    } catch {
      // An old build without listApps, or the phone said no; the built-in list still works.
      lastScan = 0;
    } finally {
      scanning = null;
    }
  })();
  return scanning;
}

/** Icons for the phone's apps (empty off Android). Scans once when first shown. */
export function usePhoneAppIcons(): ReadonlyMap<string, string> {
  useEffect(() => {
    void scanPhoneApps(icons.size === 0);
  }, []);
  return useSyncExternalStore(
    (l) => {
      iconListeners.add(l);
      return () => iconListeners.delete(l);
    },
    () => icons,
  );
}

let pumping = false;

/** Pulls usage from the phone into the wallet, then pushes the current rules back. */
export async function pumpNative(): Promise<void> {
  if (!isNativeAndroid || pumping) return;
  pumping = true;
  try {
    const before = owner(useStore.getState().data);
    if (!before) return;
    const device = deviceId();
    const { events } = await KaziLock.drain({ after: before.nativeSeqs?.[device] ?? 0 });
    if (events.length > 0) {
      if (SERVER_MODE) {
        const { ok } = await act('applyNativeEvents', { deviceId: device, events });
        if (!ok) return;
      } else {
        const { data, setData } = useStore.getState();
        setData(applyNativeEvents(data, before.id, device, events, Date.now()));
      }
    }
    const after = owner(useStore.getState().data);
    if (after) await KaziLock.sync(nativeRules(after, device));
  } catch {
    // The service may be off or the plugin missing in an old build; try again next time.
  } finally {
    pumping = false;
  }
}

/**
 * Keeps the phone's lock service and the app in step, and opens the lock
 * screen when the service bounced the person out of a locked app.
 */
export function useNativeBridge() {
  const navigate = useNavigate();
  const lastRules = useRef('');

  useEffect(() => {
    if (!isNativeAndroid) return;
    const handles: Promise<PluginListenerHandle>[] = [];
    handles.push(KaziLock.addListener('locked', ({ appId, kind }) => {
      void pumpNative();
      const part = kind === 'scrolls' || kind === 'minutes' || kind === 'limit' ? `?part=${kind}` : '';
      navigate(`/locked/${appId}${part}`);
    }));
    handles.push(CapApp.addListener('resume', () => {
      void pumpNative();
      void scanPhoneApps();
    }));
    void pumpNative();
    void scanPhoneApps();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void pumpNative();
    }, 5000);

    // Push rule and balance changes (new task approved, unlock time changed…) right away.
    const unsubscribe = useStore.subscribe((s) => {
      const a = owner(s.data);
      if (!a) return;
      const rules = nativeRules(a, deviceId());
      const key = JSON.stringify(rules);
      if (key === lastRules.current) return;
      lastRules.current = key;
      KaziLock.sync(rules).catch(() => undefined);
    });

    return () => {
      window.clearInterval(timer);
      unsubscribe();
      handles.forEach((h) => h.then((x) => x.remove()).catch(() => undefined));
    };
  }, [navigate]);
}
