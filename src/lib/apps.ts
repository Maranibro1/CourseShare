import type { RewardKind } from './types';

export interface LockableApp {
  id: string;
  name: string;
  /** Scrolling apps spend scrolls; other apps spend screen-time minutes. */
  kind: RewardKind;
  color: string;
}

export const APPS: LockableApp[] = [
  { id: 'tiktok', name: 'TikTok', kind: 'scrolls', color: '#111827' },
  { id: 'instagram', name: 'Instagram', kind: 'scrolls', color: '#BE185D' },
  { id: 'youtube', name: 'YouTube', kind: 'scrolls', color: '#B91C1C' },
  { id: 'x', name: 'X', kind: 'scrolls', color: '#18181B' },
  { id: 'minecraft', name: 'Minecraft', kind: 'minutes', color: '#3F6212' },
  { id: 'netflix', name: 'Netflix', kind: 'minutes', color: '#7F1D1D' },
  { id: 'snapchat', name: 'Snapchat', kind: 'minutes', color: '#A16207' },
];

export const SCROLL_APPS = APPS.filter((a) => a.kind === 'scrolls');
export const TIME_APPS = APPS.filter((a) => a.kind === 'minutes');

export const DEFAULT_LOCKED = ['tiktok', 'instagram', 'youtube', 'minecraft', 'netflix'];

export function getApp(id: string): LockableApp | undefined {
  return APPS.find((a) => a.id === id);
}

/** "TikTok, Instagram, YouTube" — names of the locked apps of one kind. */
export function lockedNames(locked: string[], kind: RewardKind): string {
  return APPS.filter((a) => a.kind === kind && locked.includes(a.id))
    .map((a) => a.name)
    .join(', ');
}
