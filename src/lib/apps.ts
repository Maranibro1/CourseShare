import type { RewardKind } from './types';

export interface LockableApp {
  id: string;
  name: string;
  /** Scrolling apps spend scrolls; other apps spend screen-time minutes. */
  kind: RewardKind;
  color: string;
  /** Android package names, including regional builds of the same app. */
  packages: string[];
}

export const APPS: LockableApp[] = [
  { id: 'tiktok', name: 'TikTok', kind: 'scrolls', color: '#111827', packages: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'] },
  { id: 'instagram', name: 'Instagram', kind: 'scrolls', color: '#BE185D', packages: ['com.instagram.android', 'com.instagram.lite'] },
  { id: 'facebook', name: 'Facebook', kind: 'scrolls', color: '#1D4ED8', packages: ['com.facebook.katana', 'com.facebook.lite'] },
  { id: 'youtube', name: 'YouTube', kind: 'scrolls', color: '#B91C1C', packages: ['com.google.android.youtube'] },
  { id: 'x', name: 'X', kind: 'scrolls', color: '#18181B', packages: ['com.twitter.android', 'com.twitter.android.lite'] },
  { id: 'minecraft', name: 'Minecraft', kind: 'minutes', color: '#3F6212', packages: ['com.mojang.minecraftpe'] },
  { id: 'netflix', name: 'Netflix', kind: 'minutes', color: '#7F1D1D', packages: ['com.netflix.mediaclient'] },
  { id: 'snapchat', name: 'Snapchat', kind: 'minutes', color: '#A16207', packages: ['com.snapchat.android'] },
];

export const SCROLL_APPS = APPS.filter((a) => a.kind === 'scrolls');
export const TIME_APPS = APPS.filter((a) => a.kind === 'minutes');

export const DEFAULT_LOCKED = ['tiktok', 'instagram', 'facebook', 'youtube', 'minecraft', 'netflix'];

export function getApp(id: string): LockableApp | undefined {
  return APPS.find((a) => a.id === id);
}

/** "TikTok, Instagram, YouTube" — names of the locked apps of one kind. */
export function lockedNames(locked: string[], kind: RewardKind): string {
  return APPS.filter((a) => a.kind === kind && locked.includes(a.id))
    .map((a) => a.name)
    .join(', ');
}
