/*
 * Lock screen backgrounds. Presets are saved on the account (so they follow
 * you to a new phone); your own photo stays on this phone only.
 */
import { useSyncExternalStore } from 'react';

export const BACKGROUNDS: { id: string; name: string; css: string; dark: boolean }[] = [
  { id: 'plain', name: 'Plain', css: '#ffffff', dark: false },
  { id: 'mint', name: 'Mint', css: 'linear-gradient(160deg, #dcfce7, #bbf7d0)', dark: false },
  { id: 'sunrise', name: 'Sunrise', css: 'linear-gradient(160deg, #fde68a, #fb923c)', dark: false },
  { id: 'ocean', name: 'Ocean', css: 'linear-gradient(160deg, #0ea5e9, #1e3a8a)', dark: true },
  { id: 'night', name: 'Night', css: 'linear-gradient(160deg, #312e81, #0f172a)', dark: true },
  { id: 'forest', name: 'Forest', css: 'linear-gradient(160deg, #166534, #052e16)', dark: true },
];

const PHOTO_KEY = 'kazikwanza:lock-photo';
const listeners = new Set<() => void>();

function readPhoto(): string | null {
  try {
    return localStorage.getItem(PHOTO_KEY);
  } catch {
    return null;
  }
}

let photo = readPhoto();

/** Saves (or clears) your own lock screen photo on this phone. Returns false if the phone is out of space. */
export function setLockPhoto(dataUrl: string | null): boolean {
  try {
    if (dataUrl) localStorage.setItem(PHOTO_KEY, dataUrl);
    else localStorage.removeItem(PHOTO_KEY);
  } catch {
    return false;
  }
  photo = dataUrl;
  listeners.forEach((l) => l());
  return true;
}

export function useLockPhoto(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => photo,
  );
}

/** The style for a lock screen, and whether its text should be light. */
export function useLockBackground(choice: string | undefined): { style: React.CSSProperties; dark: boolean } {
  const own = useLockPhoto();
  if (choice === 'photo' && own) {
    return {
      style: { background: `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(${own}) center / cover no-repeat` },
      dark: true,
    };
  }
  const preset = BACKGROUNDS.find((b) => b.id === choice) ?? BACKGROUNDS[0];
  return { style: { background: preset.css }, dark: preset.dark };
}
