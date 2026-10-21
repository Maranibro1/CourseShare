import { describe, expect, it } from 'vitest';
import {
  EMERGENCY_PER_WEEK,
  QUESTIONS_FALLBACK_MS,
  accessFor,
  addChildTask,
  addTask,
  answerTimeRequest,
  approveTask,
  askForTime,
  canApprove,
  closeSession,
  completeWithQuestions,
  createAccount,
  createLinkCode,
  dailyTick,
  deleteTask,
  emergencyLeft,
  emptyData,
  joinFamily,
  minutesLeft,
  remainingSeconds,
  requestRedo,
  requestsFor,
  signIn,
  spendScroll,
  startSession,
  streakDays,
  submitPhoto,
  todaysTasks,
  updateAccount,
  emergencyUnlock,
  weekStats,
} from './logic';
import { DAY, HOUR, MINUTE } from './time';
import type { AppData } from './types';

// Wednesday 21 October 2026, 08:00 local time.
const T0 = new Date(2026, 9, 21, 8, 0, 0).getTime();

function setup() {
  let data: AppData = emptyData();
  const sam = createAccount(data, { name: 'Sam', email: 'sam@example.com', passwordHash: 'h1' }, T0);
  data = sam.data;
  const emma = createAccount(data, { name: 'Emma', email: 'Emma@Example.com', passwordHash: 'h2' }, T0);
  data = emma.data;
  data = updateAccount(data, sam.id, {
    onboarded: true,
    verifier: { contact: 'emma@example.com', relation: 'Sister' },
    unlockTime: '13:00',
  });
  return { data, sam: sam.id, emma: emma.id };
}

describe('accounts', () => {
  it('rejects duplicate contacts regardless of case', () => {
    const { data } = setup();
    expect(() => createAccount(data, { name: 'X', email: 'SAM@example.com', passwordHash: 'h' }, T0)).toThrow(/already exists/);
  });

  it('signs in with matching hash only', () => {
    const { data, emma } = setup();
    expect(signIn(data, 'emma@example.com', 'h2').sessionId).toBe(emma);
    expect(() => signIn(data, 'emma@example.com', 'nope')).toThrow();
  });

  it('validates contacts', () => {
    expect(() => createAccount(emptyData(), { name: 'A', email: 'not-an-email', passwordHash: 'h' }, T0)).toThrow();
    expect(createAccount(emptyData(), { name: 'A', email: '0712 345 678', passwordHash: 'h' }, T0).id).toBeTruthy();
  });
});

describe('locking', () => {
  it('locks scroll apps with no balance before the unlock time', () => {
    const { data, sam } = setup();
    const a = data.accounts[sam];
    expect(accessFor(a, 'tiktok', T0)).toBe('locked');
    expect(accessFor(a, 'x', T0)).toBe('not-locked');
    expect(accessFor(a, 'tiktok', T0 + 5 * HOUR)).toBe('free');
  });

  it('never unlocks for free when unlock time is off', () => {
    const { data, sam } = setup();
    const d = updateAccount(data, sam, { unlockTime: null });
    expect(accessFor(d.accounts[sam], 'tiktok', T0 + 12 * HOUR)).toBe('locked');
  });

  it('charges one scroll per swipe and locks at zero', () => {
    let { data, sam } = setup();
    data = updateAccount(data, sam, { scrolls: 2 });
    let r = spendScroll(data, sam, 'tiktok', 'visit1', T0);
    expect(r.result).toBe('charged');
    r = spendScroll(r.data, sam, 'tiktok', 'visit1', T0);
    expect(r.result).toBe('charged');
    expect(r.data.accounts[sam].scrolls).toBe(0);
    expect(r.data.accounts[sam].ledger[0]).toMatchObject({ label: 'Scrolled TikTok', amount: -2 });
    expect(spendScroll(r.data, sam, 'tiktok', 'visit1', T0).result).toBe('locked');
  });

  it('warns once when the balance drops to 10', () => {
    let { data, sam } = setup();
    data = updateAccount(data, sam, { scrolls: 12 });
    data = spendScroll(data, sam, 'tiktok', 'v', T0).data;
    data = spendScroll(data, sam, 'tiktok', 'v', T0).data;
    data = spendScroll(data, sam, 'tiktok', 'v', T0).data;
    expect(data.notifications.filter((n) => n.text === 'You have 10 scrolls left')).toHaveLength(1);
  });

  it('shows minutes rounded up so a running clock never reads 0 early', () => {
    let { data, sam } = setup();
    data = updateAccount(data, sam, { screenSeconds: 6 * 60 });
    data = startSession(data, sam, 'minecraft', T0);
    expect(minutesLeft(data.accounts[sam], T0 + 1000)).toBe(6);
    expect(minutesLeft(data.accounts[sam], T0 + 5 * MINUTE + 59_000)).toBe(1);
    expect(minutesLeft(data.accounts[sam], T0 + 6 * MINUTE)).toBe(0);
  });

  it('does not charge during the free window', () => {
    let { data, sam } = setup();
    data = updateAccount(data, sam, { scrolls: 5 });
    const r = spendScroll(data, sam, 'tiktok', 'v', T0 + 6 * HOUR);
    expect(r.result).toBe('free');
    expect(r.data.accounts[sam].scrolls).toBe(5);
  });

  it('counts screen time down while a timed app is open', () => {
    let { data, sam } = setup();
    data = updateAccount(data, sam, { screenSeconds: 10 * 60 });
    data = startSession(data, sam, 'minecraft', T0);
    expect(remainingSeconds(data.accounts[sam], T0 + 4 * MINUTE)).toBe(6 * 60);
    data = closeSession(data, sam, T0 + 4 * MINUTE);
    expect(data.accounts[sam].screenSeconds).toBe(6 * 60);
    expect(data.accounts[sam].ledger[0]).toMatchObject({ label: 'Played Minecraft', amount: -4, unit: 'minutes' });
  });

  it('closes a session that runs out and charges no more than the balance', () => {
    let { data, sam } = setup();
    data = updateAccount(data, sam, { screenSeconds: 60 });
    data = startSession(data, sam, 'netflix', T0);
    data = dailyTick(data, sam, T0 + 10 * MINUTE);
    expect(data.accounts[sam].session).toBeNull();
    expect(data.accounts[sam].screenSeconds).toBe(0);
    expect(accessFor(data.accounts[sam], 'netflix', T0 + 10 * MINUTE)).toBe('locked');
  });
});

describe('tasks and verification', () => {
  it('awards scrolls after questions', () => {
    let { data, sam } = setup();
    const t = addTask(data, sam, { title: 'Read 20 pages', rewardKind: 'scrolls', amount: 40, verify: 'questions', repeat: 'never' }, T0);
    data = completeWithQuestions(t.data, t.id, sam, ['Atomic Habits ch 2', 'Small habits add up', 'Start tiny'], T0);
    expect(data.accounts[sam].scrolls).toBe(40);
    expect(data.tasks[t.id].status).toBe('done');
    expect(() => completeWithQuestions(data, t.id, sam, ['a b c', 'a b c', 'a b c'], T0)).toThrow(/already done/);
  });

  it('requires photo tasks to be approved by the verifier, not the owner', () => {
    let { data, sam, emma } = setup();
    const t = addTask(data, sam, { title: 'Statistics assignment', rewardKind: 'scrolls', amount: 100, verify: 'photo', repeat: 'never' }, T0);
    data = submitPhoto(t.data, t.id, sam, T0);
    expect(canApprove(data, data.tasks[t.id], sam)).toBe(false);
    expect(canApprove(data, data.tasks[t.id], emma)).toBe(true);
    expect(requestsFor(data, emma).map((x) => x.id)).toEqual([t.id]);
    expect(() => approveTask(data, t.id, sam, T0)).toThrow();
    expect(() => completeWithQuestions(data, t.id, sam, ['xxx', 'yyy', 'zzz'], T0)).toThrow();
    data = approveTask(data, t.id, emma, T0 + MINUTE);
    expect(data.accounts[sam].scrolls).toBe(100);
    expect(data.notifications.find((n) => n.accountId === sam)?.text).toBe('Emma approved your statistics assignment. +100 scrolls');
  });

  it('lets the owner switch to questions once the verifier has had 3 hours', () => {
    let { data, sam } = setup();
    const t = addTask(data, sam, { title: 'Go to the gym', rewardKind: 'minutes', amount: 30, verify: 'photo', repeat: 'never' }, T0);
    data = submitPhoto(t.data, t.id, sam, T0);
    expect(() => completeWithQuestions(data, t.id, sam, ['squats', 'one hour', 'tired'], T0 + HOUR)).toThrow();
    data = completeWithQuestions(data, t.id, sam, ['squats', 'one hour', 'tired'], T0 + QUESTIONS_FALLBACK_MS);
    expect(data.accounts[sam].screenSeconds).toBe(30 * 60);
  });

  it('sends a redo back to the owner with the reason', () => {
    let { data, sam, emma } = setup();
    const t = addTask(data, sam, { title: 'Go to the gym', rewardKind: 'minutes', amount: 30, verify: 'photo', repeat: 'never' }, T0);
    data = submitPhoto(t.data, t.id, sam, T0);
    data = requestRedo(data, t.id, emma, 'The photo was too blurry', T0);
    expect(data.tasks[t.id].status).toBe('redo');
    expect(data.notifications[0].text).toBe('Emma asked you to redo “Go to the gym”. The photo was too blurry.');
    data = submitPhoto(data, t.id, sam, T0 + MINUTE);
    expect(data.tasks[t.id].status).toBe('pending');
  });

  it('refuses photo tasks without a verifier and bad rewards', () => {
    let { data, sam } = setup();
    data = updateAccount(data, sam, { verifier: null });
    expect(() => addTask(data, sam, { title: 'x', rewardKind: 'scrolls', amount: 10, verify: 'photo', repeat: 'never' }, T0)).toThrow(/verifier/);
    expect(() => addTask(data, sam, { title: 'x', rewardKind: 'scrolls', amount: 0, verify: 'questions', repeat: 'never' }, T0)).toThrow();
    expect(() => addTask(data, sam, { title: 'x', rewardKind: 'scrolls', amount: 9999, verify: 'questions', repeat: 'never' }, T0)).toThrow(/at most/);
  });

  it('brings repeating tasks back the next day and carries unfinished ones over', () => {
    let { data, sam } = setup();
    const a = addTask(data, sam, { title: 'Revise chapter 3', rewardKind: 'scrolls', amount: 50, verify: 'questions', repeat: 'daily' }, T0);
    const b = addTask(a.data, sam, { title: 'One-off', rewardKind: 'scrolls', amount: 20, verify: 'questions', repeat: 'never' }, T0);
    const c = addTask(b.data, sam, { title: 'Unfinished', rewardKind: 'scrolls', amount: 20, verify: 'questions', repeat: 'never' }, T0);
    data = completeWithQuestions(c.data, a.id, sam, ['aaa', 'bbb', 'ccc'], T0);
    data = completeWithQuestions(data, b.id, sam, ['aaa', 'bbb', 'ccc'], T0);
    data = dailyTick(data, sam, T0 + DAY);
    const ids = todaysTasks(data, sam, T0 + DAY).map((t) => t.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(c.id);
    expect(ids).not.toContain(b.id);
    expect(data.tasks[a.id].status).toBe('todo');
  });

  it('only lets the creator delete a task', () => {
    const { data, sam, emma } = setup();
    const t = addTask(data, sam, { title: 'x', rewardKind: 'scrolls', amount: 10, verify: 'questions', repeat: 'never' }, T0);
    expect(() => deleteTask(t.data, t.id, emma)).toThrow();
    expect(deleteTask(t.data, t.id, sam).tasks[t.id]).toBeUndefined();
  });
});

describe('stats', () => {
  it('counts a streak across consecutive days', () => {
    let { data, sam } = setup();
    for (let i = 0; i < 3; i += 1) {
      const at = T0 + i * DAY;
      const t = addTask(data, sam, { title: `Task ${i}`, rewardKind: 'scrolls', amount: 10, verify: 'questions', repeat: 'never' }, at);
      data = completeWithQuestions(t.data, t.id, sam, ['aaa', 'bbb', 'ccc'], at);
    }
    expect(streakDays(data, sam, T0 + 2 * DAY)).toBe(3);
    // Today not done yet still counts yesterday's run.
    expect(streakDays(data, sam, T0 + 3 * DAY)).toBe(3);
    expect(streakDays(data, sam, T0 + 4 * DAY)).toBe(0);
    expect(weekStats(data, sam, T0 + 2 * DAY).scrollsEarned).toBe(30);
  });
});

describe('emergency unlock', () => {
  it('allows three per week', () => {
    let { data, sam } = setup();
    for (let i = 0; i < EMERGENCY_PER_WEEK; i += 1) data = emergencyUnlock(data, sam, 'tiktok', T0);
    expect(data.accounts[sam].scrolls).toBe(30);
    expect(emergencyLeft(data.accounts[sam], T0)).toBe(0);
    expect(() => emergencyUnlock(data, sam, 'tiktok', T0)).toThrow();
    // Next Monday the allowance resets.
    expect(emergencyLeft(data.accounts[sam], T0 + 5 * DAY)).toBe(EMERGENCY_PER_WEEK);
  });
});

describe('family', () => {
  function family() {
    let data = emptyData();
    const mum = createAccount(data, { name: 'Achieng', email: 'achieng@example.com', passwordHash: 'p' }, T0);
    const leo = createAccount(mum.data, { name: 'Leo', email: 'leo@example.com', passwordHash: 'c' }, T0);
    data = createLinkCode(leo.data, mum.id, T0);
    const code = data.linkCodes[0].code;
    return { data, mum: mum.id, leo: leo.id, code };
  }

  it('links a child with a valid code only', () => {
    const { data, mum, leo, code } = family();
    expect(() => joinFamily(data, leo, 'ZZZZZZ', T0)).toThrow(/doesn/);
    expect(() => joinFamily(data, leo, code, T0 + 11 * MINUTE)).toThrow(/expired/);
    const joined = joinFamily(data, leo, code.toLowerCase(), T0);
    expect(joined.accounts[leo].parentId).toBe(mum);
    expect(joined.accounts[leo].mode).toBe('child');
    expect(joined.linkCodes).toHaveLength(0);
  });

  it('runs the task, photo and approval loop between parent and child', () => {
    let { data, mum, leo, code } = family();
    data = joinFamily(data, leo, code, T0);
    const t = addChildTask(data, mum, leo, { title: 'Maths homework', rewardKind: 'scrolls', amount: 60, repeat: 'never', dueTime: '18:00' }, T0);
    data = submitPhoto(t.data, t.id, leo, T0);
    expect(requestsFor(data, mum).map((x) => x.id)).toEqual([t.id]);
    expect(() => emergencyUnlock(data, leo, 'tiktok', T0)).toThrow();
    data = approveTask(data, t.id, mum, T0);
    expect(data.accounts[leo].scrolls).toBe(60);
  });

  it('lets a child ask for more time once until answered', () => {
    let { data, mum, leo, code } = family();
    data = joinFamily(data, leo, code, T0);
    data = askForTime(data, leo, 'minecraft', T0);
    expect(() => askForTime(data, leo, 'minecraft', T0)).toThrow();
    data = answerTimeRequest(data, data.timeRequests[0].id, mum, true, T0);
    expect(data.accounts[leo].screenSeconds).toBe(15 * 60);
  });
});
