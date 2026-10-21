export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(t: number | Date = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(t: number = Date.now()): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday 00:00 of the week containing t. */
export function startOfWeek(t: number = Date.now()): number {
  const d = new Date(startOfDay(t));
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d.getTime();
}

export function isWeekday(t: number = Date.now()): boolean {
  const day = new Date(t).getDay();
  return day !== 0 && day !== 6;
}

/** "13:00" -> timestamp for that clock time on the day of t. */
export function clockToday(hhmm: string, t: number = Date.now()): number {
  const [h, m] = hhmm.split(':').map(Number);
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
