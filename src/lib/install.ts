import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';

/*
 * Getting Kazikwanza onto a phone's home screen:
 * - Android Chrome (and desktop Chrome/Edge) offer an install prompt, which we
 *   catch and show from our own button;
 * - iPhone Safari has no prompt, so we show the Share > Add to Home Screen steps;
 * - the Android app (APK), which can lock other apps, is a separate download.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Where the Android app can be downloaded, set when the web app is built. */
export const APK_URL: string = String(import.meta.env.VITE_APK_URL ?? '');

const listeners = new Set<() => void>();
let deferred: InstallPromptEvent | null = null;
let installed = false;

function changed() {
  snapshot = { canPrompt: deferred !== null, installed };
  listeners.forEach((l) => l());
}

let snapshot = { canPrompt: false, installed: false };

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the browser's mini-bar quiet; our button shows the prompt instead.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    changed();
  });
}

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** Already opened from the home screen as an installed app. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export type DevicePlatform = 'ios' | 'android' | 'other';

export function devicePlatform(): DevicePlatform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac with a touch screen.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

export function useInstallPrompt() {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
  async function prompt(): Promise<boolean> {
    const event = deferred;
    if (!event) return false;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // A prompt can only be used once.
    deferred = null;
    if (outcome === 'accepted') installed = true;
    changed();
    return outcome === 'accepted';
  }
  return { ...state, prompt };
}

/** A link to share with a verifier or child, when we know where the app lives. */
export function appLink(): string | null {
  const configured = String(import.meta.env.VITE_PUBLIC_URL ?? '');
  if (configured) return configured;
  if (isNativeApp() || typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  return `${location.origin}${location.pathname}`;
}
