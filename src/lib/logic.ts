/**
 * All state changes live here as pure functions over AppData, so they can be
 * unit tested without a browser. Each mutation takes `now` explicitly.
 */
import { APPS, DEFAULT_LOCKED, getApp } from './apps';
import { DAY, HOUR, MINUTE, clockToday, dayKey, formatClock, isWeekday, startOfDay, startOfWeek } from './time';
import type {
  Account,
  AppData,
  LedgerEntry,
  Mode,
  Repeat,
  RewardKind,
  Task,
  VerifyMethod,
} from './types';

export const EMERGENCY_PER_WEEK = 3;
export const EMERGENCY_WAIT_SECONDS = 60;
export const EMERGENCY_SCROLLS = 10;
export const EMERGENCY_MINUTES = 5;
export const QUESTIONS_FALLBACK_MS = 3 * HOUR;
export const LINK_CODE_TTL_MS = 10 * MINUTE;
export const LOW_SCROLLS = 10;
export const MAX_REWARD = { scrolls: 500, minutes: 240 } as const;
export const TIME_GIFT = { scrolls: 20, minutes: 15 } as const;
const LEDGER_LIMIT = 300;
const NOTIFICATION_LIMIT = 100;

export class KaziError extends Error {}

export function emptyData(): AppData {
  return {
    version: 1,
    accounts: {},
    sessionId: null,
    tasks: {},
    notifications: [],
    linkCodes: [],
    timeRequests: [],
  };
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

const clone = (data: AppData): AppData => structuredClone(data);

export function normalizeContact(s: string): string {
  const t = s.trim().toLowerCase();
  // Phone numbers: keep digits and a leading +, so "0712 345 678" matches "0712345678".
  if (/^[+\d][\d\s-]*$/.test(t)) return t.replace(/[\s-]/g, '');
  return t;
}

export function isValidContact(s: string): boolean {
  const t = s.trim();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
  const phone = /^\+?\d[\d\s-]{6,}$/.test(t);
  return email || phone;
}

function account(data: AppData, id: string): Account {
  const a = data.accounts[id];
  if (!a) throw new KaziError('Account not found');
  return a;
}

function task(data: AppData, id: string): Task {
  const t = data.tasks[id];
  if (!t) throw new KaziError('Task not found');
  return t;
}

export function findAccountByContact(data: AppData, contact: string | null): Account | undefined {
  if (!contact) return undefined;
  const key = normalizeContact(contact);
  return Object.values(data.accounts).find((a) => normalizeContact(a.email) === key);
}

function pushLedger(a: Account, entry: Omit<LedgerEntry, 'id'>, id = newId('l')) {
  a.ledger.unshift({ id, ...entry });
  if (a.ledger.length > LEDGER_LIMIT) a.ledger.length = LEDGER_LIMIT;
}

function notify(data: AppData, accountId: string, text: string, link: string | null, now: number) {
  data.notifications.unshift({ id: newId('n'), accountId, at: now, text, read: false, link });
  // Keep each person's newest notifications; drop the oldest overall.
  if (data.notifications.length > NOTIFICATION_LIMIT * 4) data.notifications.length = NOTIFICATION_LIMIT * 4;
}

export function rewardLabel(kind: RewardKind, amount: number, sign = true): string {
  const prefix = sign ? (amount >= 0 ? '+' : '−') : '';
  const n = Math.abs(amount);
  return kind === 'minutes' ? `${prefix}${n} min` : `${prefix}${n}`;
}

export function rewardWords(kind: RewardKind, amount: number): string {
  return kind === 'minutes' ? `${amount} min of screen time` : `${amount} scroll${amount === 1 ? '' : 's'}`;
}

/* ───────────────────────── Accounts ───────────────────────── */

export interface NewAccount {
  name: string;
  email: string;
  passwordHash: string;
}

export function createAccount(data: AppData, input: NewAccount, now: number): { data: AppData; id: string } {
  const name = input.name.trim();
  if (!name) throw new KaziError('Enter your name');
  if (!isValidContact(input.email)) throw new KaziError('Enter a valid email or phone number');
  if (findAccountByContact(data, input.email)) throw new KaziError('An account with this email or phone already exists. Sign in instead.');
  const next = clone(data);
  const id = newId('u');
  next.accounts[id] = {
    id,
    name,
    email: input.email.trim(),
    passwordHash: input.passwordHash,
    mode: 'personal',
    createdAt: now,
    onboarded: false,
    permissions: { usage: false, accessibility: false },
    lockedApps: [...DEFAULT_LOCKED],
    unlockTime: '13:00',
    verifier: null,
    parentId: null,
    scrolls: 0,
    screenSeconds: 0,
    ledger: [],
    emergencyUses: [],
    notificationsOn: true,
    session: null,
    lastDay: dayKey(now),
    unlockNoticeDay: null,
    lowScrollNoticeDay: null,
  };
  next.sessionId = id;
  return { data: next, id };
}

export function signIn(data: AppData, contact: string, passwordHash: string): AppData {
  const a = findAccountByContact(data, contact);
  if (!a || a.passwordHash !== passwordHash) throw new KaziError('That email/phone and password don’t match.');
  return { ...data, sessionId: a.id };
}

export function signOut(data: AppData, now: number): AppData {
  let next = data;
  if (data.sessionId && data.accounts[data.sessionId]?.session) next = closeSession(data, data.sessionId, now);
  return { ...next, sessionId: null };
}

export function updateAccount(data: AppData, id: string, patch: Partial<Account>): AppData {
  const next = clone(data);
  Object.assign(account(next, id), patch);
  return next;
}

export function setMode(data: AppData, id: string, mode: Mode): AppData {
  return updateAccount(data, id, { mode });
}

/* ───────────────────────── Unlocking ───────────────────────── */

/** True once today's free unlock time has passed. Resets at midnight. */
export function freeUnlockActive(a: Account, now: number): boolean {
  return a.unlockTime !== null && now >= clockToday(a.unlockTime, now);
}

export type Access = 'not-locked' | 'free' | 'balance' | 'locked';

export function accessFor(a: Account, appId: string, now: number): Access {
  const app = getApp(appId);
  if (!app || !a.lockedApps.includes(appId)) return 'not-locked';
  if (freeUnlockActive(a, now)) return 'free';
  if (app.kind === 'scrolls') return a.scrolls > 0 ? 'balance' : 'locked';
  return remainingSeconds(a, now) > 0 ? 'balance' : 'locked';
}

/** Screen time left, counting down live while a timed app is open. */
export function remainingSeconds(a: Account, now: number): number {
  const s = a.session;
  if (!s || s.free) return a.screenSeconds;
  const elapsed = (now - s.startedAt) / 1000;
  return Math.max(0, a.screenSeconds - elapsed);
}

/** Whole minutes left for display. Rounds up so "0 min" only shows once time has truly run out. */
export function minutesLeft(a: Account, now: number): number {
  return Math.ceil(Math.floor(remainingSeconds(a, now)) / 60);
}

export function sessionElapsedSeconds(a: Account, now: number): number {
  return a.session ? Math.max(0, (now - a.session.startedAt) / 1000) : 0;
}

export function startSession(data: AppData, accountId: string, appId: string, now: number): AppData {
  const app = getApp(appId);
  if (!app || app.kind !== 'minutes') throw new KaziError('Only timed apps use screen time');
  let next = data.accounts[accountId].session ? closeSession(data, accountId, now) : data;
  const a0 = account(next, accountId);
  const access = accessFor(a0, appId, now);
  if (access === 'locked') throw new KaziError(`${app.name} is locked`);
  next = clone(next);
  account(next, accountId).session = { appId, startedAt: now, free: access !== 'balance' };
  return next;
}

/** Stops the running timed app and charges the minutes used. */
export function closeSession(data: AppData, accountId: string, now: number): AppData {
  const next = clone(data);
  const a = account(next, accountId);
  const s = a.session;
  if (!s) return data;
  const app = getApp(s.appId);
  if (!s.free) {
    const used = Math.min(a.screenSeconds, (now - s.startedAt) / 1000);
    a.screenSeconds = Math.max(0, a.screenSeconds - used);
    if (used >= 30 && app) {
      pushLedger(a, { at: now, label: `Played ${app.name}`, amount: -Math.max(1, Math.round(used / 60)), unit: 'minutes' });
    }
  }
  a.session = null;
  return next;
}

export type ScrollResult = 'charged' | 'free' | 'locked';

/**
 * Called once per swipe to a new post. `sessionKey` groups swipes from one visit
 * into a single "Scrolled TikTok −70" history line.
 */
export function spendScroll(
  data: AppData,
  accountId: string,
  appId: string,
  sessionKey: string,
  now: number,
): { data: AppData; result: ScrollResult } {
  const a0 = account(data, accountId);
  const access = accessFor(a0, appId, now);
  if (access === 'free' || access === 'not-locked') return { data, result: 'free' };
  if (access === 'locked') return { data, result: 'locked' };
  const next = clone(data);
  const a = account(next, accountId);
  a.scrolls -= 1;
  const app = getApp(appId);
  const existing = a.ledger.find((l) => l.id === sessionKey);
  if (existing) existing.amount -= 1;
  else pushLedger(a, { at: now, label: `Scrolled ${app?.name ?? appId}`, amount: -1, unit: 'scrolls' }, sessionKey);
  const today = dayKey(now);
  if (a.scrolls === LOW_SCROLLS && a.lowScrollNoticeDay !== today) {
    a.lowScrollNoticeDay = today;
    notify(next, accountId, `You have ${LOW_SCROLLS} scrolls left`, '/wallet', now);
  }
  return { data: next, result: 'charged' };
}

/* ───────────────────────── Daily reset ───────────────────────── */

function repeatsOn(repeat: Repeat, now: number): boolean {
  if (repeat === 'daily') return true;
  if (repeat === 'weekdays') return isWeekday(now);
  return false;
}

/**
 * Runs the once-a-day work for an account: brings repeating tasks back,
 * closes stale timers and posts the "apps unlocked" notice.
 * Returns the same object when nothing changed so React can skip renders.
 */
export function dailyTick(data: AppData, accountId: string, now: number): AppData {
  const a0 = data.accounts[accountId];
  if (!a0) return data;
  const today = dayKey(now);
  let next = data;
  const mutate = () => {
    if (next === data) next = clone(data);
    return next;
  };

  if (a0.lastDay !== today) {
    const n = mutate();
    for (const t of Object.values(n.tasks)) {
      if (t.ownerId !== accountId || t.day === today || t.status === 'pending') continue;
      if (repeatsOn(t.repeat, now)) {
        t.status = 'todo';
        t.day = today;
        t.redoReason = null;
        t.submittedAt = null;
        t.completedAt = null;
      } else if (t.status !== 'done') {
        // Unfinished one-off tasks carry over to today.
        t.day = today;
      }
    }
    account(n, accountId).lastDay = today;
  }

  // A timed app left running past midnight or past its balance gets closed.
  const s = (next.accounts[accountId] ?? a0).session;
  if (s) {
    const a = next.accounts[accountId];
    const ranOut = !s.free && remainingSeconds(a, now) <= 0;
    const newDay = dayKey(s.startedAt) !== today;
    if (ranOut || newDay) next = closeSession(next, accountId, ranOut ? s.startedAt + a.screenSeconds * 1000 : now);
  }

  const a1 = next.accounts[accountId];
  if (a1.onboarded && a1.unlockTime && freeUnlockActive(a1, now) && a1.unlockNoticeDay !== today) {
    const n = mutate();
    const a = account(n, accountId);
    a.unlockNoticeDay = today;
    notify(n, accountId, `Your apps unlocked at ${formatClock(a.unlockTime!)}`, null, clockToday(a.unlockTime!, now));
  }
  return next;
}

/* ───────────────────────── Tasks ───────────────────────── */

export interface TaskInput {
  title: string;
  rewardKind: RewardKind;
  amount: number;
  verify: VerifyMethod;
  repeat: Repeat;
  dueTime?: string | null;
}

function validateTaskInput(input: TaskInput) {
  if (!input.title.trim()) throw new KaziError('Give the task a name');
  if (input.title.trim().length > 80) throw new KaziError('Keep the task name under 80 characters');
  if (!Number.isInteger(input.amount) || input.amount < 1) throw new KaziError('Reward must be a whole number above 0');
  const max = MAX_REWARD[input.rewardKind];
  if (input.amount > max) throw new KaziError(`Reward can be at most ${rewardWords(input.rewardKind, max)}`);
}

/** Personal task the owner sets for themself. */
export function addTask(data: AppData, ownerId: string, input: TaskInput, now: number): { data: AppData; id: string } {
  validateTaskInput(input);
  const owner = account(data, ownerId);
  if (input.verify === 'photo' && !owner.verifier) throw new KaziError('Add a verifier before choosing photo proof');
  const next = clone(data);
  const id = newId('t');
  next.tasks[id] = {
    id,
    ownerId,
    createdBy: ownerId,
    title: input.title.trim(),
    reward: { kind: input.rewardKind, amount: input.amount },
    verify: input.verify,
    verifierContact: input.verify === 'photo' ? owner.verifier!.contact : null,
    verifierId: null,
    status: 'todo',
    repeat: input.repeat,
    dueTime: input.dueTime ?? null,
    day: dayKey(now),
    addedAt: now,
    submittedAt: null,
    completedAt: null,
    approvedBy: null,
    redoReason: null,
    rewardSeen: true,
    remindedAt: null,
    completions: [],
  };
  return { data: next, id };
}

/** Task a parent sets for their child. Always photo-verified by the parent. */
export function addChildTask(
  data: AppData,
  parentId: string,
  childId: string,
  input: Omit<TaskInput, 'verify'>,
  now: number,
): { data: AppData; id: string } {
  const child = account(data, childId);
  if (child.parentId !== parentId) throw new KaziError('This child is not linked to you');
  const full: TaskInput = { ...input, verify: 'photo' };
  validateTaskInput(full);
  const next = clone(data);
  const id = newId('t');
  next.tasks[id] = {
    id,
    ownerId: childId,
    createdBy: parentId,
    title: input.title.trim(),
    reward: { kind: input.rewardKind, amount: input.amount },
    verify: 'photo',
    verifierContact: null,
    verifierId: parentId,
    status: 'todo',
    repeat: input.repeat,
    dueTime: input.dueTime ?? null,
    day: dayKey(now),
    addedAt: now,
    submittedAt: null,
    completedAt: null,
    approvedBy: null,
    redoReason: null,
    rewardSeen: true,
    remindedAt: null,
    completions: [],
  };
  notify(next, childId, `${account(next, parentId).name} added a task: ${input.title.trim()} (${rewardLabel(input.rewardKind, input.amount)})`, '/child', now);
  return { data: next, id };
}

export function editTask(data: AppData, taskId: string, editorId: string, input: TaskInput): AppData {
  validateTaskInput(input);
  const t0 = task(data, taskId);
  if (t0.createdBy !== editorId) throw new KaziError('Only the person who made this task can edit it');
  if (t0.status === 'pending') throw new KaziError('This task is waiting for approval and can’t be changed');
  const next = clone(data);
  const t = task(next, taskId);
  const owner = account(next, t.ownerId);
  const isFamily = t.verifierId !== null;
  if (!isFamily && input.verify === 'photo' && !owner.verifier) throw new KaziError('Add a verifier before choosing photo proof');
  t.title = input.title.trim();
  t.reward = { kind: input.rewardKind, amount: input.amount };
  t.repeat = input.repeat;
  t.dueTime = input.dueTime ?? t.dueTime;
  if (!isFamily) {
    t.verify = input.verify;
    t.verifierContact = input.verify === 'photo' ? owner.verifier!.contact : null;
  }
  return next;
}

export function deleteTask(data: AppData, taskId: string, actorId: string): AppData {
  const t = task(data, taskId);
  if (t.createdBy !== actorId) throw new KaziError('Only the person who made this task can delete it');
  const next = clone(data);
  delete next.tasks[taskId];
  return next;
}

/** The account allowed to approve a photo task, if it exists on this device. */
export function approverFor(data: AppData, t: Task): Account | undefined {
  if (t.verifierId) return data.accounts[t.verifierId];
  return findAccountByContact(data, t.verifierContact);
}

/** Display name for whoever checks this task. */
export function approverName(data: AppData, t: Task): string {
  const a = approverFor(data, t);
  if (a) return a.name;
  if (t.verifierContact) return t.verifierContact;
  return 'your verifier';
}

export function canApprove(data: AppData, t: Task, accountId: string): boolean {
  if (t.verify !== 'photo' || t.ownerId === accountId) return false;
  if (t.verifierId) return t.verifierId === accountId;
  const me = data.accounts[accountId];
  return !!me && !!t.verifierContact && normalizeContact(me.email) === normalizeContact(t.verifierContact);
}

export function submitPhoto(data: AppData, taskId: string, ownerId: string, now: number): AppData {
  const t0 = task(data, taskId);
  if (t0.ownerId !== ownerId) throw new KaziError('This is not your task');
  if (t0.verify !== 'photo') throw new KaziError('This task is verified with questions');
  if (t0.status === 'done' || t0.status === 'pending') throw new KaziError('This task has already been sent');
  const next = clone(data);
  const t = task(next, taskId);
  t.status = 'pending';
  t.submittedAt = now;
  t.redoReason = null;
  t.remindedAt = null;
  const approver = approverFor(next, t);
  const owner = account(next, ownerId);
  if (approver) {
    const link = t.verifierId ? `/family/approve/${t.id}` : '/requests';
    notify(next, approver.id, `${owner.name} sent a photo: ${t.title} (${rewardLabel(t.reward.kind, t.reward.amount)})`, link, now);
  }
  return next;
}

function award(next: AppData, t: Task, approverId: string | null, now: number) {
  const owner = account(next, t.ownerId);
  const before = streakDays(next, owner.id, now);
  t.status = 'done';
  t.completedAt = now;
  t.approvedBy = approverId;
  t.rewardSeen = false;
  t.redoReason = null;
  t.completions.push(now);
  if (t.reward.kind === 'scrolls') owner.scrolls += t.reward.amount;
  else owner.screenSeconds += t.reward.amount * 60;
  pushLedger(owner, { at: now, label: t.title, amount: t.reward.amount, unit: t.reward.kind });
  const after = streakDays(next, owner.id, now);
  if (after > before && after >= 2) {
    notify(next, owner.id, `You hit a ${after}-day streak`, '/wallet', now);
  }
}

export function canFallBackToQuestions(t: Task, now: number): boolean {
  return t.status === 'pending' && t.verify === 'photo' && t.verifierId === null && t.submittedAt !== null && now - t.submittedAt >= QUESTIONS_FALLBACK_MS;
}

/** Self-verification: the owner answered the integrity questions honestly. */
export function completeWithQuestions(data: AppData, taskId: string, ownerId: string, answers: string[], now: number): AppData {
  const t0 = task(data, taskId);
  if (t0.ownerId !== ownerId) throw new KaziError('This is not your task');
  if (t0.verifierId) throw new KaziError('Family tasks need a photo for your parent');
  const fallback = canFallBackToQuestions(t0, now);
  if (t0.verify !== 'questions' && !fallback) throw new KaziError('This task needs photo approval');
  if (t0.status === 'done') throw new KaziError('This task is already done');
  if (t0.status === 'pending' && !fallback) throw new KaziError('This task is waiting for approval');
  if (answers.some((a) => a.trim().length < 3)) throw new KaziError('Answer every question');
  const next = clone(data);
  const t = task(next, taskId);
  if (fallback) t.verify = 'questions';
  award(next, t, null, now);
  return next;
}

export function approveTask(data: AppData, taskId: string, approverId: string, now: number): AppData {
  const t0 = task(data, taskId);
  if (!canApprove(data, t0, approverId)) throw new KaziError('You can’t approve this task');
  if (t0.status !== 'pending') throw new KaziError('This task isn’t waiting for approval');
  const next = clone(data);
  const t = task(next, taskId);
  award(next, t, approverId, now);
  const approver = account(next, approverId);
  notify(next, t.ownerId, `${approver.name} approved your ${t.title.toLowerCase()}. ${rewardLabel(t.reward.kind, t.reward.amount)} ${t.reward.kind === 'scrolls' ? 'scrolls' : 'screen time'}`, `/earned/${t.id}`, now);
  return next;
}

export function requestRedo(data: AppData, taskId: string, approverId: string, reason: string, now: number): AppData {
  const t0 = task(data, taskId);
  if (!canApprove(data, t0, approverId)) throw new KaziError('You can’t review this task');
  if (t0.status !== 'pending') throw new KaziError('This task isn’t waiting for approval');
  const next = clone(data);
  const t = task(next, taskId);
  t.status = 'redo';
  t.redoReason = reason.trim() || null;
  t.submittedAt = null;
  const approver = account(next, approverId);
  const why = t.redoReason ? ` ${t.redoReason.replace(/\.?$/, '.')}` : '';
  notify(next, t.ownerId, `${approver.name} asked you to redo “${t.title}”.${why}`, `/task/${t.id}`, now);
  return next;
}

export function remindApprover(data: AppData, taskId: string, ownerId: string, now: number): AppData {
  const t0 = task(data, taskId);
  if (t0.ownerId !== ownerId || t0.status !== 'pending') throw new KaziError('Nothing to remind about');
  if (t0.remindedAt && now - t0.remindedAt < 10 * MINUTE) throw new KaziError('You sent a reminder a few minutes ago');
  const next = clone(data);
  const t = task(next, taskId);
  t.remindedAt = now;
  const approver = approverFor(next, t);
  if (approver) {
    const link = t.verifierId ? `/family/approve/${t.id}` : '/requests';
    notify(next, approver.id, `${account(next, ownerId).name} is waiting for you to check: ${t.title}`, link, now);
  }
  return next;
}

export function markRewardSeen(data: AppData, taskId: string): AppData {
  const t = data.tasks[taskId];
  if (!t || t.rewardSeen) return data;
  const next = clone(data);
  task(next, taskId).rewardSeen = true;
  return next;
}

/** Tasks shown on someone's Today list: today's, plus anything unfinished or waiting. */
export function todaysTasks(data: AppData, ownerId: string, now: number): Task[] {
  const today = dayKey(now);
  const order: Record<Task['status'], number> = { done: 0, pending: 1, redo: 2, todo: 3 };
  return Object.values(data.tasks)
    .filter((t) => t.ownerId === ownerId && (t.day === today || t.status !== 'done'))
    .sort((a, b) => order[a.status] - order[b.status] || a.addedAt - b.addedAt);
}

export function requestsFor(data: AppData, accountId: string): Task[] {
  return Object.values(data.tasks)
    .filter((t) => t.status === 'pending' && canApprove(data, t, accountId))
    .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
}

export function reviewedBy(data: AppData, accountId: string, limit = 10): Task[] {
  return Object.values(data.tasks)
    .filter((t) => t.approvedBy === accountId || (t.status === 'redo' && canApprove(data, t, accountId)))
    .sort((a, b) => (b.completedAt ?? b.addedAt) - (a.completedAt ?? a.addedAt))
    .slice(0, limit);
}

/* ───────────────────────── Stats ───────────────────────── */

function completionDays(data: AppData, ownerId: string): Set<string> {
  const days = new Set<string>();
  for (const t of Object.values(data.tasks)) {
    if (t.ownerId !== ownerId) continue;
    for (const c of t.completions) days.add(dayKey(c));
  }
  return days;
}

/** Days in a row with at least one verified task, ending today (or yesterday if today is still open). */
export function streakDays(data: AppData, ownerId: string, now: number): number {
  const days = completionDays(data, ownerId);
  let cursor = startOfDay(now);
  if (!days.has(dayKey(cursor))) cursor -= DAY;
  let count = 0;
  // Step by calendar day using noon to stay clear of DST edges.
  let probe = cursor + 12 * HOUR;
  while (days.has(dayKey(probe))) {
    count += 1;
    probe -= DAY;
  }
  return count;
}

export interface WeekStats {
  scrollsEarned: number;
  scrollsUsed: number;
  minutesEarned: number;
  minutesUsed: number;
  tasksDone: number;
  streak: number;
}

export function weekStats(data: AppData, ownerId: string, now: number): WeekStats {
  const a = account(data, ownerId);
  const from = startOfWeek(now);
  const stats: WeekStats = { scrollsEarned: 0, scrollsUsed: 0, minutesEarned: 0, minutesUsed: 0, tasksDone: 0, streak: 0 };
  for (const l of a.ledger) {
    if (l.at < from) continue;
    if (l.unit === 'scrolls') {
      if (l.amount > 0) stats.scrollsEarned += l.amount;
      else stats.scrollsUsed -= l.amount;
    } else if (l.amount > 0) stats.minutesEarned += l.amount;
    else stats.minutesUsed -= l.amount;
  }
  for (const t of Object.values(data.tasks)) {
    if (t.ownerId === ownerId) stats.tasksDone += t.completions.filter((c) => c >= from).length;
  }
  stats.streak = streakDays(data, ownerId, now);
  return stats;
}

/** Completed tasks per day for the last 7 days, oldest first; the last entry is today. */
export function dailyCompletions(data: AppData, ownerId: string, now: number): { label: string; count: number }[] {
  const out: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const probe = startOfDay(now) - i * DAY + 12 * HOUR;
    const key = dayKey(probe);
    let count = 0;
    for (const t of Object.values(data.tasks)) {
      if (t.ownerId === ownerId) count += t.completions.filter((c) => dayKey(c) === key).length;
    }
    const label = i === 0 ? 'Today' : new Date(probe).toLocaleDateString('en-GB', { weekday: 'short' });
    out.push({ label, count });
  }
  return out;
}

/** Minutes each timed app was used today, from the history. */
export function minutesUsedToday(a: Account, now: number): Record<string, number> {
  const from = startOfDay(now);
  const out: Record<string, number> = {};
  for (const app of APPS) if (app.kind === 'minutes') out[app.id] = 0;
  for (const l of a.ledger) {
    if (l.at < from || l.unit !== 'minutes' || l.amount >= 0) continue;
    const app = APPS.find((x) => l.label === `Played ${x.name}`);
    if (app) out[app.id] += -l.amount;
  }
  if (a.session && !a.session.free) {
    out[a.session.appId] = (out[a.session.appId] ?? 0) + Math.floor(sessionElapsedSeconds(a, now) / 60);
  }
  return out;
}

/* ───────────────────────── Emergency unlock ───────────────────────── */

export function emergencyLeft(a: Account, now: number): number {
  const from = startOfWeek(now);
  return Math.max(0, EMERGENCY_PER_WEEK - a.emergencyUses.filter((u) => u >= from).length);
}

export function emergencyUnlock(data: AppData, accountId: string, appId: string, now: number): AppData {
  const a0 = account(data, accountId);
  if (a0.mode === 'child') throw new KaziError('Ask your parent for more time instead');
  if (emergencyLeft(a0, now) <= 0) throw new KaziError('No emergency unlocks left this week');
  const app = getApp(appId);
  if (!app) throw new KaziError('Unknown app');
  const next = clone(data);
  const a = account(next, accountId);
  a.emergencyUses.push(now);
  if (app.kind === 'scrolls') {
    a.scrolls += EMERGENCY_SCROLLS;
    pushLedger(a, { at: now, label: `Emergency unlock · ${app.name}`, amount: EMERGENCY_SCROLLS, unit: 'scrolls' });
  } else {
    a.screenSeconds += EMERGENCY_MINUTES * 60;
    pushLedger(a, { at: now, label: `Emergency unlock · ${app.name}`, amount: EMERGENCY_MINUTES, unit: 'minutes' });
  }
  return next;
}

/* ───────────────────────── Family ───────────────────────── */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function activeLinkCode(data: AppData, parentId: string, now: number) {
  return data.linkCodes.find((c) => c.parentId === parentId && c.expiresAt > now);
}

export function createLinkCode(data: AppData, parentId: string, now: number, random: () => number = Math.random): AppData {
  account(data, parentId);
  const next = clone(data);
  next.linkCodes = next.linkCodes.filter((c) => c.expiresAt > now && c.parentId !== parentId);
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]).join('');
  } while (next.linkCodes.some((c) => c.code === code));
  next.linkCodes.push({ code, parentId, expiresAt: now + LINK_CODE_TTL_MS });
  return next;
}

export function joinFamily(data: AppData, childId: string, rawCode: string, now: number): AppData {
  const code = rawCode.trim().toUpperCase();
  if (code.length !== 6) throw new KaziError('Enter all 6 characters');
  const link = data.linkCodes.find((c) => c.code === code);
  if (!link) throw new KaziError('That code doesn’t match. Check it with your parent.');
  if (link.expiresAt <= now) throw new KaziError('That code has expired. Ask your parent for a new one.');
  if (link.parentId === childId) throw new KaziError('You can’t join your own family as a child');
  const next = clone(data);
  const child = account(next, childId);
  const parent = account(next, link.parentId);
  child.parentId = parent.id;
  child.mode = 'child';
  child.lockedApps = ['tiktok', 'instagram', 'youtube', 'minecraft', 'netflix'];
  child.unlockTime = '18:00';
  child.verifier = null;
  next.linkCodes = next.linkCodes.filter((c) => c.code !== code);
  notify(next, parent.id, `${child.name} joined your family`, '/family', now);
  return next;
}

export function childrenOf(data: AppData, parentId: string): Account[] {
  return Object.values(data.accounts)
    .filter((a) => a.parentId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function unlinkChild(data: AppData, parentId: string, childId: string): AppData {
  const child = account(data, childId);
  if (child.parentId !== parentId) throw new KaziError('This child is not linked to you');
  const next = clone(data);
  const c = account(next, childId);
  c.parentId = null;
  c.mode = 'personal';
  return next;
}

export function setChildRules(
  data: AppData,
  parentId: string,
  childId: string,
  rules: { lockedApps: string[]; unlockTime: string | null },
  now: number,
): AppData {
  const child = account(data, childId);
  if (child.parentId !== parentId) throw new KaziError('This child is not linked to you');
  const next = clone(data);
  const c = account(next, childId);
  c.lockedApps = rules.lockedApps.filter((id) => getApp(id));
  c.unlockTime = rules.unlockTime;
  notify(next, childId, `${account(next, parentId).name} updated your rules`, '/child', now);
  return next;
}

export function askForTime(data: AppData, childId: string, appId: string, now: number): AppData {
  const child = account(data, childId);
  if (!child.parentId) throw new KaziError('You aren’t linked to a parent yet');
  if (data.timeRequests.some((r) => r.childId === childId && r.status === 'open')) {
    throw new KaziError('You already asked. Wait for your parent to answer.');
  }
  const app = getApp(appId);
  const next = clone(data);
  next.timeRequests.push({ id: newId('r'), childId, parentId: child.parentId, appId, at: now, status: 'open' });
  notify(next, child.parentId, `${child.name} asked for more time on ${app?.name ?? 'an app'}`, '/family', now);
  return next;
}

export function answerTimeRequest(data: AppData, requestId: string, parentId: string, grant: boolean, now: number): AppData {
  const r0 = data.timeRequests.find((r) => r.id === requestId);
  if (!r0 || r0.parentId !== parentId) throw new KaziError('Request not found');
  if (r0.status !== 'open') throw new KaziError('Already answered');
  const next = clone(data);
  const r = next.timeRequests.find((x) => x.id === requestId)!;
  r.status = grant ? 'granted' : 'declined';
  const child = account(next, r.childId);
  const parent = account(next, parentId);
  const app = getApp(r.appId);
  if (grant) {
    if (app?.kind === 'minutes') {
      child.screenSeconds += TIME_GIFT.minutes * 60;
      pushLedger(child, { at: now, label: `Gift from ${parent.name}`, amount: TIME_GIFT.minutes, unit: 'minutes' });
      notify(next, child.id, `${parent.name} gave you ${TIME_GIFT.minutes} min of screen time`, '/child', now);
    } else {
      child.scrolls += TIME_GIFT.scrolls;
      pushLedger(child, { at: now, label: `Gift from ${parent.name}`, amount: TIME_GIFT.scrolls, unit: 'scrolls' });
      notify(next, child.id, `${parent.name} gave you ${TIME_GIFT.scrolls} scrolls`, '/child', now);
    }
  } else {
    notify(next, child.id, `${parent.name} said not now. Finish a task to earn more.`, '/child', now);
  }
  return next;
}

/* ───────────────────────── Notifications ───────────────────────── */

export function notificationsFor(data: AppData, accountId: string) {
  return data.notifications.filter((n) => n.accountId === accountId).slice(0, NOTIFICATION_LIMIT);
}

export function markNotificationsRead(data: AppData, accountId: string): AppData {
  if (!data.notifications.some((n) => n.accountId === accountId && !n.read)) return data;
  return {
    ...data,
    notifications: data.notifications.map((n) => (n.accountId === accountId && !n.read ? { ...n, read: true } : n)),
  };
}

/* ───────────────────────── Phone lock (Android) ───────────────────────── */

/** Usage the phone's lock service recorded, as returned by the KaziLock plugin. */
export interface NativeUsageEvent {
  seq: number;
  appId: string;
  kind: RewardKind;
  /** Scrolls swiped, or seconds of screen time. */
  amount: number;
  session: string;
  at: number;
}

/** What the phone should enforce, sent to the KaziLock plugin. */
export interface NativeRules {
  enabled: boolean;
  apps: { id: string; name: string; kind: RewardKind; packages: string[] }[];
  scrolls: number;
  screenSeconds: number;
  unlockTime: string;
  ackSeq: number;
}

export function setDeviceOwner(data: AppData, accountId: string): AppData {
  account(data, accountId);
  if (data.deviceOwnerId === accountId) return data;
  return { ...data, deviceOwnerId: accountId };
}

export function nativeRules(a: Account): NativeRules {
  return {
    enabled: a.onboarded && a.lockedApps.length > 0,
    apps: APPS.filter((x) => a.lockedApps.includes(x.id)).map(({ id, name, kind, packages }) => ({ id, name, kind, packages })),
    scrolls: a.scrolls,
    screenSeconds: a.screenSeconds,
    unlockTime: a.unlockTime ?? '',
    ackSeq: a.nativeSeq ?? 0,
  };
}

/**
 * Charges usage recorded by the phone to the account. Safe to call with the
 * same events twice: anything at or below the account's nativeSeq is skipped.
 */
export function applyNativeEvents(data: AppData, accountId: string, events: NativeUsageEvent[], now: number): AppData {
  const a0 = data.accounts[accountId];
  if (!a0) return data;
  const fresh = events.filter((e) => e.seq > (a0.nativeSeq ?? 0)).sort((x, y) => x.seq - y.seq);
  if (fresh.length === 0) return data;
  const next = clone(data);
  const a = account(next, accountId);
  const today = dayKey(now);
  for (const e of fresh) {
    const app = getApp(e.appId);
    const name = app?.name ?? e.appId;
    const ledgerId = `n_${e.session}`;
    const line = a.ledger.find((l) => l.id === ledgerId);
    if (e.kind === 'scrolls') {
      const n = Math.max(0, Math.round(e.amount));
      const before = a.scrolls;
      a.scrolls = Math.max(0, before - n);
      if (line) line.amount -= n;
      else pushLedger(a, { at: e.at, label: `Scrolled ${name}`, amount: -n, unit: 'scrolls' }, ledgerId);
      if (before > LOW_SCROLLS && a.scrolls <= LOW_SCROLLS && a.scrolls > 0 && a.lowScrollNoticeDay !== today) {
        a.lowScrollNoticeDay = today;
        notify(next, accountId, `You have ${a.scrolls} scrolls left`, '/wallet', now);
      }
    } else {
      const secs = Math.max(0, e.amount);
      a.screenSeconds = Math.max(0, a.screenSeconds - secs);
      if (line) {
        line.seconds = (line.seconds ?? 0) + secs;
        line.amount = -Math.round(line.seconds / 60);
      } else {
        pushLedger(a, { at: e.at, label: `Played ${name}`, amount: -Math.round(secs / 60), unit: 'minutes', seconds: secs }, ledgerId);
      }
    }
    a.nativeSeq = e.seq;
  }
  return next;
}
