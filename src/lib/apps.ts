import type { Account, PhoneApp, RewardKind } from './types';

export type { PhoneApp };

/**
 * How an app is paid for. Scrolling apps spend 1 scroll per swipe, other apps
 * spend screen-time minutes, and YouTube is both: swiping through Shorts
 * spends scrolls, watching a regular video spends screen time, and browsing
 * the home feed is free.
 */
export type AppKind = RewardKind | 'mixed';

export interface LockableApp {
  id: string;
  name: string;
  kind: AppKind;
  color: string;
  /** Android package names, including regional builds of the same app. */
  packages: string[];
  /** Found on the person's phone rather than in Kazikwanza's own list. */
  found?: boolean;
}

export const APPS: LockableApp[] = [
  { id: 'tiktok', name: 'TikTok', kind: 'scrolls', color: '#111827', packages: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'] },
  { id: 'instagram', name: 'Instagram', kind: 'scrolls', color: '#BE185D', packages: ['com.instagram.android', 'com.instagram.lite'] },
  { id: 'facebook', name: 'Facebook', kind: 'scrolls', color: '#1D4ED8', packages: ['com.facebook.katana', 'com.facebook.lite'] },
  { id: 'youtube', name: 'YouTube', kind: 'mixed', color: '#B91C1C', packages: ['com.google.android.youtube'] },
  { id: 'x', name: 'X', kind: 'scrolls', color: '#18181B', packages: ['com.twitter.android', 'com.twitter.android.lite'] },
  { id: 'minecraft', name: 'Minecraft', kind: 'minutes', color: '#3F6212', packages: ['com.mojang.minecraftpe'] },
  { id: 'netflix', name: 'Netflix', kind: 'minutes', color: '#7F1D1D', packages: ['com.netflix.mediaclient'] },
  { id: 'snapchat', name: 'Snapchat', kind: 'minutes', color: '#A16207', packages: ['com.snapchat.android'] },
];

/** Apps that spend scrolls (YouTube's Shorts included). */
export const SCROLL_APPS = APPS.filter((a) => a.kind !== 'minutes');
/** Kazikwanza's own list of apps that only spend screen time. */
export const TIME_APPS = APPS.filter((a) => a.kind === 'minutes');

export const DEFAULT_LOCKED = ['tiktok', 'instagram', 'facebook', 'youtube', 'minecraft', 'netflix'];

export const usesScrolls = (app: LockableApp) => app.kind !== 'minutes';
export const usesMinutes = (app: LockableApp) => app.kind !== 'scrolls';

/** One line on what an app costs, shown under its name. */
export function costLabel(app: LockableApp): string {
  if (app.kind === 'mixed') return 'Shorts: scrolls · videos: screen time';
  return app.kind === 'scrolls' ? '1 scroll per swipe' : 'Uses screen time';
}

/* ───────── Apps found on the phone ───────── */

/** Ids of phone-found apps are this prefix plus the package name. */
export const FOUND_PREFIX = 'pkg:';
export const MAX_PHONE_APPS = 300;
/** Lock rules can name at most this many apps. */
export const MAX_LOCKED_APPS = APPS.length + 200;
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
/** Kazikwanza itself can never be locked, or nobody could get back in to earn time. */
const NEVER_LOCK = new Set(['app.kazikwanza']);
const FOUND_COLORS = ['#0F766E', '#7C3AED', '#C2410C', '#0369A1', '#4D7C0F', '#BE123C', '#A16207', '#4338CA'];
const COMMON_PARTS = new Set(['com', 'org', 'net', 'io', 'co', 'android', 'app', 'apps', 'mobile', 'client', 'free', 'lite', 'google']);

export function isValidPackage(pkg: unknown): pkg is string {
  return typeof pkg === 'string' && pkg.length <= 150 && PACKAGE_RE.test(pkg) && !NEVER_LOCK.has(pkg);
}

/** The listed app a package belongs to, if any (so TikTok is never listed twice). */
export function catalogAppFor(pkg: string): LockableApp | undefined {
  return APPS.find((a) => a.packages.includes(pkg));
}

/** "com.roblox.client" → "Roblox", for a locked app whose name we don't know. */
function nameFromPackage(pkg: string): string {
  const parts = pkg.split('.').filter((p) => !COMMON_PARTS.has(p.toLowerCase()));
  const word = parts[0] ?? pkg.split('.').pop() ?? pkg;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function colorFor(pkg: string): string {
  let h = 0;
  for (let i = 0; i < pkg.length; i += 1) h = (h * 31 + pkg.charCodeAt(i)) >>> 0;
  return FOUND_COLORS[h % FOUND_COLORS.length];
}

function foundApp(pkg: string, name?: string): LockableApp {
  return { id: FOUND_PREFIX + pkg, name: name || nameFromPackage(pkg), kind: 'minutes', color: colorFor(pkg), packages: [pkg], found: true };
}

/** True for a listed app's id, or "pkg:" plus a package name that isn't a listed app. */
export function isValidAppId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (APPS.some((a) => a.id === id)) return true;
  if (!id.startsWith(FOUND_PREFIX)) return false;
  const pkg = id.slice(FOUND_PREFIX.length);
  return isValidPackage(pkg) && !catalogAppFor(pkg);
}

type AppOwner = Pick<Account, 'phoneApps' | 'lockedApps'> | null | undefined;

/**
 * Any app by id, for one person: Kazikwanza's list, plus the apps found on
 * their phone. A locked phone app stays known even after it's uninstalled, so
 * reinstalling it doesn't get around the lock.
 */
export function appFor(a: AppOwner, id: string): LockableApp | undefined {
  const listed = APPS.find((x) => x.id === id);
  if (listed) return listed;
  if (!isValidAppId(id)) return undefined;
  const pkg = id.slice(FOUND_PREFIX.length);
  return foundApp(pkg, a?.phoneApps?.find((p) => p.pkg === pkg)?.name);
}

/** Every app a person can lock: Kazikwanza's list first, then their phone's apps A to Z. */
export function appsFor(a: AppOwner): LockableApp[] {
  const found = new Map<string, LockableApp>();
  for (const p of a?.phoneApps ?? []) {
    if (isValidPackage(p.pkg) && !catalogAppFor(p.pkg)) found.set(p.pkg, foundApp(p.pkg, p.name));
  }
  for (const id of a?.lockedApps ?? []) {
    const app = id.startsWith(FOUND_PREFIX) ? appFor(a, id) : undefined;
    if (app && !found.has(app.packages[0])) found.set(app.packages[0], app);
  }
  return [...APPS, ...[...found.values()].sort((x, y) => x.name.localeCompare(y.name))];
}

/** The apps this person has locked, in the order they're listed. */
export function lockedAppsOf(a: AppOwner): LockableApp[] {
  const locked = new Set(a?.lockedApps ?? []);
  return appsFor(a).filter((x) => locked.has(x.id));
}

/** "TikTok, Instagram, YouTube": the locked apps that spend scrolls, or screen time. */
export function lockedNames(a: AppOwner, kind: RewardKind): string {
  return lockedAppsOf(a)
    .filter((x) => (kind === 'scrolls' ? usesScrolls(x) : usesMinutes(x)))
    .map((x) => x.name)
    .join(', ');
}

/**
 * Cleans up the list a phone reported: valid packages only, Kazikwanza's own
 * listed apps left out (they're always shown), no duplicates, sorted by name.
 */
export function normalizePhoneApps(list: PhoneApp[]): PhoneApp[] {
  const out = new Map<string, PhoneApp>();
  for (const p of list) {
    if (!p || !isValidPackage(p.pkg) || catalogAppFor(p.pkg)) continue;
    const name = String(p.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || nameFromPackage(p.pkg);
    out.set(p.pkg, { pkg: p.pkg, name });
  }
  return [...out.values()].sort((x, y) => x.name.localeCompare(y.name) || x.pkg.localeCompare(y.pkg)).slice(0, MAX_PHONE_APPS);
}
