export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const pad = (n: number) => String(n).padStart(2, '0');

/*
 * Calendar maths (days, weeks, "1:00 PM today") normally uses the device's own
 * clock. The sync server runs in UTC, so it wraps each request in
 * withTimeZone(account's zone) and these helpers then work in that zone.
 */
let zone: string | null = null;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Runs fn with calendar helpers in the given IANA time zone (falls back to the current one). */
export function withTimeZone<T>(tz: string | null | undefined, fn: () => T): T {
  const previous = zone;
  if (isValidTimeZone(tz)) zone = tz;
  try {
    return fn();
  } finally {
    zone = previous;
  }
}

/** The device's IANA time zone, e.g. "Africa/Nairobi". */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneParts(t: number, tz: string): Parts {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(t))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return { y: out.year, m: out.month, d: out.day, h: out.hour % 24, mi: out.minute, s: out.second };
}

/** Milliseconds the zone is ahead of UTC at instant t. */
function zoneOffset(t: number, tz: string): number {
  const p = zoneParts(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}

/** The instant when the zone's wall clock shows y-m-d h:mi. */
function zonedInstant(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let t = wall - zoneOffset(wall, tz);
  // A second pass settles the offset on days the clocks change.
  t = wall - zoneOffset(t, tz);
  return t;
}

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(t: number | Date = Date.now()): string {
  if (zone) {
    const p = zoneParts(+t, zone);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(t: number = Date.now()): number {
  if (zone) {
    const p = zoneParts(t, zone);
    return zonedInstant(p.y, p.m, p.d, 0, 0, zone);
  }
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 0 = Sunday … 6 = Saturday, in the current zone. */
function weekdayOf(t: number): number {
  if (zone) {
    const p = zoneParts(t, zone);
    return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  }
  return new Date(t).getDay();
}

/** Monday 00:00 of the week containing t. */
export function startOfWeek(t: number = Date.now()): number {
  const back = (weekdayOf(t) + 6) % 7;
  if (zone) {
    const p = zoneParts(t, zone);
    const monday = new Date(Date.UTC(p.y, p.m - 1, p.d - back));
    return zonedInstant(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, zone);
  }
  const d = new Date(startOfDay(t));
  d.setDate(d.getDate() - back);
  return d.getTime();
}

export function isWeekday(t: number = Date.now()): boolean {
  const day = weekdayOf(t);
  return day !== 0 && day !== 6;
}

/** "13:00" -> timestamp for that clock time on the day of t. */
export function clockToday(hhmm: string, t: number = Date.now()): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (zone) {
    const p = zoneParts(t, zone);
    return zonedInstant(p.y, p.m, p.d, h, m, zone);
  }
  const d = new Date(t);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/** "13:00" -> "1:00 PM". */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

/** "13:00" -> "1 PM" when on the hour, else "1:30 PM". */
export function formatClockShort(hhmm: string): string {
  const full = formatClock(hhmm);
  return full.replace(':00 ', ' ');
}

export function formatTimeOfDay(t: number): string {
  const d = new Date(t);
  return formatClock(`${d.getHours()}:${d.getMinutes()}`);
}

/** "Today, 8:10 AM", "Yesterday, 6:00 PM" or "Mon 14 Oct, 9:00 AM". */
export function formatAdded(t: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  const time = formatTimeOfDay(t);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const d = new Date(t);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

/** "Just now", "2 min ago", "1 hour ago", "Yesterday", "Monday". */
export function timeAgo(t: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - t);
  if (diff < MINUTE) return 'Just now';
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m} min ago`;
  }
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days === 0) {
    const h = Math.floor(diff / HOUR);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Date(t).toLocaleDateString('en-GB', { weekday: 'long' });
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** 125 -> "2:05". */
export function formatMinSec(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** Milliseconds -> "2h 58m" / "12m". */
export function formatHoursMinutes(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / MINUTE));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function greeting(t: number = Date.now()): string {
  const h = new Date(t).getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "Today", "Yesterday", "Monday" (this week) or "14 Oct", for grouping messages by day. */
export function dayLabel(t: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return new Date(t).toLocaleDateString('en-GB', { weekday: 'long' });
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
