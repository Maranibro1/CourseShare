import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { activeBlock, scheduleEndsAt } from './blocks';
import {
  accessFor,
  addTask,
  completeWithQuestions,
  createAccount,
  createLinkCode,
  emptyData,
  findAccountByContact,
  joinFamily,
  nativeRules,
  signIn,
  signInKey,
  spendScroll,
  updateAccount,
} from './logic';
import type { AppData, BlockSchedule } from './types';
import { contactsOf, requestsFor, submitPhoto } from './logic';

// Wednesday 21 October 2026, 08:00 local time.
const T0 = new Date(2026, 9, 21, 8, 0, 0).getTime();
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 9, 21 + dayOffset, h, m, 0).getTime();

function two() {
  let data: AppData = emptyData();
  const sam = createAccount(data, { name: 'Sam', email: 'sam@example.com', username: 'Sam_K', passwordHash: 'h1' }, T0);
  data = sam.data;
  const emma = createAccount(data, { name: 'Emma', email: 'emma@example.com', username: 'emma', passwordHash: 'h2' }, T0);
  data = updateAccount(emma.data, sam.id, { onboarded: true, unlockTime: null, scrolls: 50, screenSeconds: 600 });
  return { data, sam: sam.id, emma: emma.id };
}

const bedtime = (patch: Partial<BlockSchedule> = {}): BlockSchedule => ({
  id: 'b1',
  name: 'Bedtime',
  apps: ['tiktok', 'minecraft'],
  start: '21:00',
  end: '07:00',
  days: [0, 1, 2, 3, 4],
  ...patch,
});

describe('usernames', () => {
  it('are lower-case, unique, and work for sign-in and finding people', () => {
    const { data, sam, emma } = two();
    expect(data.accounts[sam].username).toBe('sam_k');
    expect(findAccountByContact(data, '@SAM_K')?.id).toBe(sam);
    expect(signInKey('Sam_K')).toBe('@sam_k');
    expect(signInKey('sam@example.com')).toBe('sam@example.com');
    expect(signIn(data, signInKey('emma'), 'h2').sessionId).toBe(emma);
    expect(() => createAccount(data, { name: 'X', email: 'x@example.com', username: 'emma', passwordHash: 'h' }, T0)).toThrow(/taken/);
    expect(() => createAccount(data, { name: 'X', email: 'x@example.com', username: 'no spaces', passwordHash: 'h' }, T0)).toThrow(/Usernames/);
    expect(() => applyAction(data, sam, 'updateProfile', { patch: { username: 'emma' } }, T0)).toThrow(/taken/);
    expect(applyAction(data, sam, 'updateProfile', { patch: { username: '@Sammy' } }, T0).data.accounts[sam].username).toBe('sammy');
  });

  it('pick a verifier who then sees and approves your photos', () => {
    let { data, sam, emma } = two();
    data = applyAction(data, sam, 'updateProfile', { patch: { verifier: { contact: '@Emma', relation: 'Friend' } } }, T0).data;
    expect(() => applyAction(data, sam, 'updateProfile', { patch: { verifier: { contact: '@sam_k', relation: 'Friend' } } }, T0)).toThrow(/own work/);
    const t = addTask(data, sam, { title: 'Essay', rewardKind: 'scrolls', amount: 10, verify: 'photo', repeat: 'never' }, T0);
    data = submitPhoto(t.data, t.id, sam, T0);
    expect(requestsFor(data, emma).map((x) => x.id)).toEqual([t.id]);
    expect(contactsOf(data, emma).find((c) => c.id === sam)?.checksWith).toBe(true);
    data = applyAction(data, emma, 'approveTask', { taskId: t.id }, T0).data;
    expect(data.accounts[sam].scrolls).toBe(60);
  });
});

describe('lock screen messages', () => {
  it('are saved trimmed, without repeats, up to 20', () => {
    const { data, sam } = two();
    const next = applyAction(data, sam, 'updateProfile', { patch: { lockMessages: ['  You got this ', 'You got this', 'Mum believes in you'] } }, T0).data;
    expect(next.accounts[sam].lockMessages).toEqual(['You got this', 'Mum believes in you']);
    expect(() => applyAction(data, sam, 'updateProfile', { patch: { lockMessages: Array(21).fill('x') } }, T0)).toThrow();
  });
});

describe('blocked times', () => {
  it('run over midnight on the chosen days only', () => {
    const b = bedtime();
    expect(scheduleEndsAt(b, at(22))).toBe(at(7, 0, 1)); // Wednesday night, until Thursday 07:00
    expect(scheduleEndsAt(b, at(6, 59))).toBe(at(7)); // Wednesday morning, from Tuesday night
    expect(scheduleEndsAt(b, at(12))).toBeNull();
    expect(scheduleEndsAt(b, at(22, 0, 2))).toBeNull(); // Friday night isn't a school night
    expect(scheduleEndsAt(b, at(6, 0, 2))).toBe(at(7, 0, 2)); // Friday morning, from Thursday night
  });

  it('shut an app completely, even with scrolls and during the free unlock', () => {
    let { data, sam } = two();
    data = applyAction(data, sam, 'setBlocks', { blocks: [bedtime()] }, at(20)).data;
    data = updateAccount(data, sam, { unlockTime: '13:00' });
    expect(accessFor(data.accounts[sam], 'tiktok', at(22))).toBe('blocked');
    expect(spendScroll(data, sam, 'tiktok', 's', at(22)).result).toBe('locked');
    expect(accessFor(data.accounts[sam], 'tiktok', at(14))).toBe('free');
    expect(() => applyAction(data, sam, 'startSession', { appId: 'minecraft' }, at(23))).toThrow(/blocked/);
    // Apps that aren't locked can be blocked too.
    data = applyAction(data, sam, 'setBlocks', { blocks: [bedtime({ apps: ['snapchat'] })] }, at(20)).data;
    expect(accessFor(data.accounts[sam], 'snapchat', at(22))).toBe('blocked');
  });

  it('can’t be removed or loosened while they’re on', () => {
    let { data, sam } = two();
    data = applyAction(data, sam, 'setBlocks', { blocks: [bedtime()] }, at(20)).data;
    expect(() => applyAction(data, sam, 'setBlocks', { blocks: [] }, at(22))).toThrow(/on right now/);
    expect(() => applyAction(data, sam, 'setBlocks', { blocks: [bedtime({ end: '22:30' })] }, at(22))).toThrow(/on right now/);
    expect(() => applyAction(data, sam, 'setBlocks', { blocks: [bedtime({ apps: ['tiktok'] })] }, at(22))).toThrow(/on right now/);
    // Stricter is fine, and anything goes once it's over.
    expect(applyAction(data, sam, 'setBlocks', { blocks: [bedtime({ apps: ['tiktok', 'minecraft', 'x'] })] }, at(22)).data.accounts[sam].blocks).toHaveLength(1);
    expect(applyAction(data, sam, 'setBlocks', { blocks: [] }, at(12)).data.accounts[sam].blocks).toEqual([]);
  });

  it('are set by a parent for their child, who can’t change them', () => {
    let data: AppData = emptyData();
    const mum = createAccount(data, { name: 'Mum', email: 'mum@example.com', passwordHash: 'h' }, T0);
    const leo = createAccount(mum.data, { name: 'Leo', email: 'leo@example.com', passwordHash: 'h' }, T0);
    data = updateAccount(leo.data, mum.id, { mode: 'parent', onboarded: true });
    data = createLinkCode(data, mum.id, T0, () => 0.1);
    data = joinFamily(data, leo.id, data.linkCodes[0].code, T0);
    data = applyAction(data, mum.id, 'setBlocks', { childId: leo.id, blocks: [bedtime()] }, at(22)).data;
    expect(data.accounts[leo.id].blocks).toHaveLength(1);
    expect(() => applyAction(data, leo.id, 'setBlocks', { blocks: [] }, at(12))).toThrow(/parent/);
    // The parent can change them any time, even while on.
    expect(applyAction(data, mum.id, 'setBlocks', { childId: leo.id, blocks: [] }, at(22)).data.accounts[leo.id].blocks).toEqual([]);
    // But nobody else can.
    const stranger = createAccount(data, { name: 'X', email: 'x@example.com', passwordHash: 'h' }, T0);
    expect(() => applyAction(stranger.data, stranger.id, 'setBlocks', { childId: leo.id, blocks: [] }, at(12))).toThrow();
  });

  it('are validated', () => {
    const { data, sam } = two();
    const bad = (b: Partial<BlockSchedule>) => () => applyAction(data, sam, 'setBlocks', { blocks: [bedtime(b)] }, T0);
    expect(bad({ apps: [] })).toThrow(/at least one app/);
    expect(bad({ days: [] })).toThrow(/day/);
    expect(bad({ start: '07:00', end: '07:00' })).toThrow(/different/);
    expect(bad({ start: '25:00' })).toThrow();
    expect(bad({ apps: ['not-an-app'] })).toThrow();
    expect(bad({ days: [7] })).toThrow();
  });
});

describe('focus timers', () => {
  it('block apps until the time is up, can be extended but not stopped', () => {
    let { data, sam } = two();
    data = applyAction(data, sam, 'startFocus', { apps: ['tiktok'], minutes: 30 }, T0).data;
    const a = data.accounts[sam];
    expect(accessFor(a, 'tiktok', T0 + 29 * 60_000)).toBe('blocked');
    expect(activeBlock(a, 'tiktok', T0)?.until).toBe(T0 + 30 * 60_000);
    expect(accessFor(a, 'tiktok', T0 + 31 * 60_000)).toBe('balance');
    // A shorter one never cuts the running timer short; apps add up.
    data = applyAction(data, sam, 'startFocus', { apps: ['instagram'], minutes: 5 }, T0 + 60_000).data;
    expect(data.accounts[sam].focus).toMatchObject({ until: T0 + 30 * 60_000, apps: ['tiktok', 'instagram'] });
    expect(() => applyAction(data, sam, 'startFocus', { apps: ['tiktok'], minutes: 0 }, T0)).toThrow();
    expect(() => applyAction(data, sam, 'startFocus', { apps: [], minutes: 10 }, T0)).toThrow();
    // There's no action to stop one, and the profile can't clear it.
    expect(() => applyAction(data, sam, 'updateProfile', { patch: { focus: null } }, T0)).toThrow();
  });

  it('reach the phone with package names', () => {
    let { data, sam } = two();
    data = applyAction(data, sam, 'startFocus', { apps: ['tiktok'], minutes: 30 }, T0).data;
    data = applyAction(data, sam, 'setBlocks', { blocks: [bedtime({ apps: ['youtube'] })] }, T0).data;
    const rules = nativeRules(data.accounts[sam], 'p');
    expect(rules.focus).toEqual({ until: T0 + 30 * 60_000, apps: [{ id: 'tiktok', packages: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'] }] });
    expect(rules.blocks).toEqual([{ start: '21:00', end: '07:00', days: [0, 1, 2, 3, 4], apps: [{ id: 'youtube', packages: ['com.google.android.youtube'] }] }]);
  });
});

describe('questions with a photo', () => {
  it('keep what was answered as proof on the task', () => {
    let { data, sam } = two();
    const t = addTask(data, sam, { title: 'Read 20 pages', rewardKind: 'scrolls', amount: 20, verify: 'questions', repeat: 'never' }, T0);
    data = completeWithQuestions(t.data, t.id, sam, [' Atomic Habits ', 'Small habits add up', 'Make it easy'], T0);
    expect(data.tasks[t.id].lastProof).toEqual({
      at: T0,
      photo: true,
      answers: [
        { q: 'What did you read? Name the book, chapter or article.', a: 'Atomic Habits' },
        { q: 'What was the main idea of what you read?', a: 'Small habits add up' },
        { q: 'Write one thing you learned or want to remember.', a: 'Make it easy' },
      ],
    });
  });
});
