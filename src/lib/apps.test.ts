import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { APPS, appFor, appsFor, isValidAppId, lockedNames, normalizePhoneApps } from './apps';
import {
  accessFor,
  answerTimeRequest,
  applyNativeEvents,
  askForTime,
  createAccount,
  createLinkCode,
  emergencyUnlock,
  emptyData,
  joinFamily,
  minutesUsedToday,
  nativeRules,
  setChildRules,
  spendScroll,
  startSession,
  closeSession,
  updateAccount,
} from './logic';
import type { AppData } from './types';
import { publicAccount } from './view';

const T0 = new Date(2026, 9, 21, 8, 0, 0).getTime();
const manifest = readFileSync(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const queries = /<queries>([\s\S]*?)<\/queries>/.exec(manifest)?.[1] ?? '';

function sam(patch: Parameters<typeof updateAccount>[2] = {}) {
  const r = createAccount(emptyData(), { name: 'Sam', email: 'sam@example.com', passwordHash: 'h' }, T0);
  // No free unlock, so locking doesn't depend on the clock.
  const data = updateAccount(r.data, r.id, { onboarded: true, unlockTime: null, ...patch });
  return { data, id: r.id };
}

const ROBLOX = 'pkg:com.roblox.client';

describe('lockable apps', () => {
  it('are all visible to the Android app', () => {
    // Since Android 11, the app can only open apps its manifest lists under <queries>.
    const listed = [...queries.matchAll(/<package android:name="([^"]+)"/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual(APPS.flatMap((a) => a.packages).sort());
  });

  it('can see every app with a home-screen icon, plus the phone and home screen apps it must never lock', () => {
    expect(queries).toMatch(/<intent>\s*<action android:name="android.intent.action.MAIN" \/>\s*<category android:name="android.intent.category.LAUNCHER" \/>\s*<\/intent>/);
    expect(queries).toContain('android.intent.category.HOME');
    expect(queries).toContain('android.intent.action.DIAL');
  });

  it('YouTube spends scrolls on Shorts and screen time on videos', () => {
    expect(appFor(null, 'youtube')?.kind).toBe('mixed');
    expect(appFor(null, 'instagram')?.kind).toBe('scrolls');
  });
});

describe('apps found on the phone', () => {
  it('cleans up what the phone reports', () => {
    const list = normalizePhoneApps([
      { pkg: 'com.roblox.client', name: '  Roblox  ' },
      { pkg: 'com.spotify.music', name: 'Spotify' },
      { pkg: 'com.zhiliaoapp.musically', name: 'TikTok' },
      { pkg: 'app.kazikwanza', name: 'Kazikwanza' },
      { pkg: 'not a package', name: 'Bad' },
      { pkg: 'com.roblox.client', name: 'Roblox again' },
      { pkg: 'com.example.noname', name: '' },
    ]);
    expect(list).toEqual([
      { pkg: 'com.example.noname', name: 'Example' },
      { pkg: 'com.roblox.client', name: 'Roblox again' },
      { pkg: 'com.spotify.music', name: 'Spotify' },
    ]);
  });

  it('gives each found app a "pkg:" id that only accepts real package names', () => {
    expect(isValidAppId('tiktok')).toBe(true);
    expect(isValidAppId(ROBLOX)).toBe(true);
    expect(isValidAppId('pkg:com.zhiliaoapp.musically')).toBe(false); // that's TikTok's own entry
    expect(isValidAppId('pkg:app.kazikwanza')).toBe(false);
    expect(isValidAppId('pkg:../../etc')).toBe(false);
    expect(isValidAppId('pkg:nodots')).toBe(false);
    expect(isValidAppId('snake')).toBe(false);
  });

  it('lists the listed apps first, then the phone apps A to Z, keeping locked ones that were uninstalled', () => {
    const owner = {
      phoneApps: [
        { pkg: 'com.spotify.music', name: 'Spotify' },
        { pkg: 'com.roblox.client', name: 'Roblox' },
      ],
      lockedApps: ['tiktok', 'pkg:com.whatsapp'],
    };
    const ids = appsFor(owner).map((a) => a.id);
    expect(ids.slice(0, APPS.length)).toEqual(APPS.map((a) => a.id));
    expect(ids.slice(APPS.length)).toEqual([ROBLOX, 'pkg:com.spotify.music', 'pkg:com.whatsapp']);
    expect(appFor(owner, 'pkg:com.whatsapp')?.name).toBe('Whatsapp');
    expect(appFor(owner, ROBLOX)).toMatchObject({ name: 'Roblox', kind: 'minutes', packages: ['com.roblox.client'], found: true });
  });

  it('locks a phone app on screen time and tells the phone its package', () => {
    let { data, id } = sam({ phoneApps: [{ pkg: 'com.roblox.client', name: 'Roblox' }], lockedApps: ['tiktok', ROBLOX], screenSeconds: 600 });
    const a = data.accounts[id];
    expect(accessFor(a, ROBLOX, T0)).toBe('balance');
    expect(nativeRules(a, 'p').apps.find((x) => x.id === ROBLOX)).toEqual({ id: ROBLOX, name: 'Roblox', kind: 'minutes', packages: ['com.roblox.client'] });
    expect(lockedNames(a, 'minutes')).toBe('Roblox');

    data = applyNativeEvents(data, id, 'p', [{ seq: 1, appId: ROBLOX, kind: 'minutes', amount: 180, session: 'r', at: T0 }], T0);
    const after = data.accounts[id];
    expect(after.screenSeconds).toBe(420);
    expect(after.ledger[0]).toMatchObject({ label: 'Used Roblox', amount: -3, appId: ROBLOX });
    expect(minutesUsedToday(after, T0 + 1000)[ROBLOX]).toBe(3);
    expect(accessFor(updateAccount(data, id, { screenSeconds: 0 }).accounts[id], ROBLOX, T0)).toBe('locked');
  });

  it('are saved through the profile, validated, and hidden from other people', () => {
    const { data, id } = sam();
    const next = applyAction(data, id, 'updateProfile', { patch: { phoneApps: [{ pkg: 'com.roblox.client', name: 'Roblox' }, { pkg: 'bad pkg', name: 'x' }] } }, T0).data;
    expect(next.accounts[id].phoneApps).toEqual([{ pkg: 'com.roblox.client', name: 'Roblox' }]);
    expect(applyAction(next, id, 'updateProfile', { patch: { lockedApps: ['tiktok', ROBLOX] } }, T0).data.accounts[id].lockedApps).toEqual(['tiktok', ROBLOX]);
    expect(() => applyAction(next, id, 'updateProfile', { patch: { lockedApps: ['pkg:app.kazikwanza'] } }, T0)).toThrow();
    expect(() => applyAction(next, id, 'updateProfile', { patch: { phoneApps: 'everything' } }, T0)).toThrow();
    expect(() => applyAction(next, id, 'updateProfile', { patch: { phoneApps: [{ pkg: 'com.a.b', name: 'x'.repeat(201) }] } }, T0)).toThrow();
    expect(publicAccount(next.accounts[id]).phoneApps).toBeUndefined();
  });

  it("a parent can limit any app on their child's phone", () => {
    let data: AppData = emptyData();
    const mum = createAccount(data, { name: 'Mum', email: 'mum@example.com', passwordHash: 'h' }, T0);
    data = mum.data;
    const leo = createAccount(data, { name: 'Leo', email: 'leo@example.com', passwordHash: 'h' }, T0);
    data = updateAccount(leo.data, mum.id, { mode: 'parent', onboarded: true });
    data = createLinkCode(data, mum.id, T0, () => 0.1);
    data = joinFamily(data, leo.id, data.linkCodes[0].code, T0);
    // Leo's phone reports its apps (a linked child may do that), then Mum locks Roblox.
    data = applyAction(data, leo.id, 'updateProfile', { patch: { phoneApps: [{ pkg: 'com.roblox.client', name: 'Roblox' }] } }, T0).data;
    data = applyAction(data, mum.id, 'setChildRules', { childId: leo.id, rules: { lockedApps: ['tiktok', ROBLOX], unlockTime: null } }, T0).data;
    expect(data.accounts[leo.id].lockedApps).toEqual(['tiktok', ROBLOX]);
    expect(nativeRules(data.accounts[leo.id], 'p').apps.map((x) => x.id)).toContain(ROBLOX);
    expect(() => setChildRules(data, leo.id, leo.id, { lockedApps: [], unlockTime: null }, T0)).toThrow();

    data = askForTime(data, leo.id, ROBLOX, T0);
    expect(data.notifications.some((n) => n.text === 'Leo asked for more time on Roblox')).toBe(true);
    data = answerTimeRequest(data, data.timeRequests[0].id, mum.id, true, T0);
    expect(data.accounts[leo.id].screenSeconds).toBe(15 * 60);
    expect(data.accounts[leo.id].scrolls).toBe(0);
  });
});

describe('YouTube: Shorts cost scrolls, videos cost screen time', () => {
  it('opens while either balance is left and locks only when both are gone', () => {
    const at = (scrolls: number, screenSeconds: number) => {
      const s = sam({ scrolls, screenSeconds });
      return accessFor(s.data.accounts[s.id], 'youtube', T0);
    };
    expect(at(5, 0)).toBe('balance');
    expect(at(0, 60)).toBe('balance');
    expect(at(0, 0)).toBe('locked');
  });

  it('Shorts need scrolls even when there is screen time', () => {
    let { data, id } = sam({ scrolls: 1, screenSeconds: 600 });
    let r = spendScroll(data, id, 'youtube', 'v1', T0);
    expect(r.result).toBe('charged');
    data = r.data;
    expect(data.accounts[id].scrolls).toBe(0);
    expect(data.accounts[id].ledger[0]).toMatchObject({ label: 'Scrolled YouTube', amount: -1 });
    r = spendScroll(data, id, 'youtube', 'v1', T0);
    expect(r.result).toBe('locked');
    expect(r.data.accounts[id].screenSeconds).toBe(600);
  });

  it('videos run on screen time even with no scrolls, and show as "Watched YouTube"', () => {
    let { data, id } = sam({ scrolls: 0, screenSeconds: 600 });
    data = startSession(data, id, 'youtube', T0);
    data = closeSession(data, id, T0 + 2 * 60_000);
    const a = data.accounts[id];
    expect(a.screenSeconds).toBe(480);
    expect(a.ledger[0]).toMatchObject({ label: 'Watched YouTube', amount: -2, appId: 'youtube' });
    expect(minutesUsedToday(a, T0 + 3 * 60_000).youtube).toBe(2);
    expect(() => startSession(updateAccount(data, id, { screenSeconds: 0, scrolls: 5 }), id, 'youtube', T0)).toThrow(/locked/);
  });

  it('phone usage from Shorts and from videos lands in the right balance', () => {
    let { data, id } = sam({ scrolls: 10, screenSeconds: 600 });
    data = applyNativeEvents(
      data,
      id,
      'p',
      [
        { seq: 1, appId: 'youtube', kind: 'scrolls', amount: 4, session: 'y1', at: T0 },
        { seq: 2, appId: 'youtube', kind: 'minutes', amount: 120, session: 'y1', at: T0 },
      ],
      T0,
    );
    const a = data.accounts[id];
    expect(a.scrolls).toBe(6);
    expect(a.screenSeconds).toBe(480);
    expect(a.ledger.map((l) => l.label).sort()).toEqual(['Scrolled YouTube', 'Watched YouTube']);
    expect(nativeRules(a, 'p').apps.find((x) => x.id === 'youtube')?.kind).toBe('mixed');
  });

  it('an emergency unlock or a parent’s gift gives both', () => {
    const { data, id } = sam();
    const a = emergencyUnlock(data, id, 'youtube', T0).accounts[id];
    expect(a.scrolls).toBeGreaterThan(0);
    expect(a.screenSeconds).toBeGreaterThan(0);
    expect(lockedNames(a, 'scrolls')).toContain('YouTube');
    expect(lockedNames(a, 'minutes')).toContain('YouTube');
  });
});
