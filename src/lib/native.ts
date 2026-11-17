import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { applyNativeEvents, nativeRules, type NativeRules, type NativeUsageEvent } from './logic';
import { deviceId, deviceOwner } from './device';
import { SERVER_MODE, act, useStore } from './store';
import type { Account, AppData } from './types';

interface KaziLockPlugin {
  getStatus(): Promise<{ accessibility: boolean; usage: boolean }>;
  openAccessibilitySettings(): Promise<void>;
  openUsageAccessSettings(): Promise<void>;
  sync(rules: NativeRules): Promise<void>;
  drain(options: { after: number }): Promise<{ events: NativeUsageEvent[] }>;
  openApp(options: { packages: string[] }): Promise<{ opened: boolean }>;
  addListener(event: 'locked', fn: (e: { appId: string }) => void): Promise<PluginListenerHandle>;
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
  const id = deviceOwner();
  if (!id) return undefined;
  if (SERVER_MODE && data.sessionId !== id) return undefined;
  return data.accounts[id];
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
    handles.push(KaziLock.addListener('locked', ({ appId }) => {
      void pumpNative();
      navigate(`/locked/${appId}`);
    }));
    handles.push(CapApp.addListener('resume', () => void pumpNative()));
    void pumpNative();
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
