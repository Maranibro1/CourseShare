import { useSyncExternalStore } from 'react';

/*
 * Settings that belong to this phone rather than to an account: a random id
 * for the phone, and which account's rules the phone's lock service enforces.
 */

const DEVICE_KEY = 'kazikwanza:device';
const OWNER_KEY = 'kazikwanza:device-owner';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Private mode: the value lasts for this visit only. */
  }
}

let memoryDeviceId: string | null = null;

export function deviceId(): string {
  const stored = read(DEVICE_KEY);
  if (stored) return stored;
  if (!memoryDeviceId) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    memoryDeviceId = `d_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    write(DEVICE_KEY, memoryDeviceId);
  }
  return memoryDeviceId;
}

const listeners = new Set<() => void>();
let owner = read(OWNER_KEY);

export function deviceOwner(): string | null {
  return owner;
}

export function setDeviceOwner(accountId: string | null) {
  owner = accountId;
  write(OWNER_KEY, accountId);
  listeners.forEach((l) => l());
}

export function useDeviceOwner(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => owner,
  );
}
