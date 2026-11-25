/*
 * Blocked times: apps that can't be opened at all, whatever is in the wallet
 * and even during the free unlock. Two kinds:
 *  - a daily window ("21:00 to 07:00 on school nights"), and
 *  - a focus timer counting down from now ("no TikTok for 2 hours").
 */
import { DAY, clockToday, formatClock, weekdayOf } from './time';
import type { Account, BlockSchedule } from './types';

export const MAX_BLOCKS = 10;
export const FOCUS_PRESETS = [15, 30, 60, 120, 240];
export const MAX_FOCUS_MINUTES = 12 * 60;

export interface ActiveBlock {
  until: number;
  /** "Focus timer" or the window's name. */
  label: string;
  kind: 'focus' | 'schedule';
}

/** When a daily window is on at `now`, the moment it ends; otherwise null. Times are in the account's zone. */
export function scheduleEndsAt(b: Pick<BlockSchedule, 'start' | 'end' | 'days'>, now: number): number | null {
  if (b.start === b.end) return null;
  const day = weekdayOf(now);
  const start = clockToday(b.start, now);
  const end = clockToday(b.end, now);
  if (b.start < b.end) return b.days.includes(day) && now >= start && now < end ? end : null;
  // Over midnight: it started this evening, or it started yesterday evening and runs until this morning.
  if (b.days.includes(day) && now >= start) return clockToday(b.end, now + DAY);
  if (b.days.includes((day + 6) % 7) && now < end) return end;
  return null;
}

/** The block keeping `appId` shut right now, if any (the one that ends last). */
export function activeBlock(a: Pick<Account, 'blocks' | 'focus'>, appId: string, now: number): ActiveBlock | null {
  let best: ActiveBlock | null = null;
  if (a.focus && now < a.focus.until && a.focus.apps.includes(appId)) best = { until: a.focus.until, label: 'Focus timer', kind: 'focus' };
  for (const b of a.blocks ?? []) {
    // Limit windows only shut an app once the limit is used up; the phone counts that.
    if (b.limit || !b.apps.includes(appId)) continue;
    const until = scheduleEndsAt(b, now);
    if (until !== null && (!best || until > best.until)) best = { until, label: b.name, kind: 'schedule' };
  }
  return best;
}

/** The limit window covering `appId` right now, if any. */
export function activeLimit(a: Pick<Account, 'blocks'>, appId: string, now: number): (BlockSchedule & { until: number }) | null {
  for (const b of a.blocks ?? []) {
    if (!b.limit || !b.apps.includes(appId)) continue;
    const until = scheduleEndsAt(b, now);
    if (until !== null) return { ...b, until };
  }
  return null;
}

/** "Limit: 30 min" / "Limit: 50 scrolls" / "Blocked". */
export function restrictionLabel(b: Pick<BlockSchedule, 'limit'>): string {
  if (!b.limit) return 'Blocked completely';
  return b.limit.kind === 'scrolls' ? `Up to ${b.limit.amount} scrolls` : `Up to ${b.limit.amount} min`;
}

/** Windows that are on right now; these can't be removed or loosened until they end. */
export function activeSchedules(a: Pick<Account, 'blocks'>, now: number): BlockSchedule[] {
  return (a.blocks ?? []).filter((b) => scheduleEndsAt(b, now) !== null);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "9:00 PM – 7:00 AM · Mon–Fri" */
export function describeSchedule(b: Pick<BlockSchedule, 'start' | 'end' | 'days'>): string {
  const days = [...b.days].sort();
  let when = days.map((d) => DAY_NAMES[d]).join(', ');
  if (days.length === 7) when = 'Every day';
  else if (days.join() === '1,2,3,4,5') when = 'Mon–Fri';
  else if (days.join() === '0,6') when = 'Weekends';
  return `${formatClock(b.start)} – ${formatClock(b.end)} · ${when}`;
}
