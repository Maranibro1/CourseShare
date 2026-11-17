import { describe, expect, it } from 'vitest';
import { clockToday, dayKey, isWeekday, startOfDay, startOfWeek, withTimeZone } from './time';

describe('time zones', () => {
  // 21 Oct 2026 22:30 UTC is already 22 Oct 01:30 in Nairobi (UTC+3).
  const t = Date.UTC(2026, 9, 21, 22, 30);

  it('uses the account zone for the calendar day', () => {
    expect(withTimeZone('Africa/Nairobi', () => dayKey(t))).toBe('2026-10-22');
    expect(withTimeZone('UTC', () => dayKey(t))).toBe('2026-10-21');
  });

  it('finds 1:00 PM and midnight in that zone', () => {
    withTimeZone('Africa/Nairobi', () => {
      expect(new Date(clockToday('13:00', t)).toISOString()).toBe('2026-10-22T10:00:00.000Z');
      expect(new Date(startOfDay(t)).toISOString()).toBe('2026-10-21T21:00:00.000Z');
    });
  });

  it('starts weeks on Monday and knows weekends', () => {
    withTimeZone('Africa/Nairobi', () => {
      // 22 Oct 2026 is a Thursday; that week began Monday 19 Oct.
      expect(new Date(startOfWeek(t)).toISOString()).toBe('2026-10-18T21:00:00.000Z');
      expect(isWeekday(t)).toBe(true);
      expect(isWeekday(Date.UTC(2026, 9, 24, 12))).toBe(false);
    });
  });

  it('handles daylight-saving changes', () => {
    // US clocks went back on 1 Nov 2026; midnight that day is still EDT (UTC-4).
    withTimeZone('America/New_York', () => {
      const noon = Date.UTC(2026, 10, 1, 17);
      expect(new Date(startOfDay(noon)).toISOString()).toBe('2026-11-01T04:00:00.000Z');
      expect(new Date(clockToday('13:00', noon)).toISOString()).toBe('2026-11-01T18:00:00.000Z');
    });
  });

  it('ignores an invalid zone and restores the previous one', () => {
    const local = dayKey(t);
    expect(withTimeZone('Not/AZone', () => dayKey(t))).toBe(local);
    expect(dayKey(t)).toBe(local);
  });
});
