/**
 * Every change a person can make, as named actions. The same table runs in
 * the app (when it works on its own) and on the sync server, which always
 * applies an action as the signed-in account, never as an id the client sends.
 * Arguments arrive as untrusted JSON, so each action checks their shape.
 */
import { MAX_LOCKED_APPS, MAX_PHONE_APPS, isValidAppId, normalizePhoneApps } from './apps';
import {
  KaziError,
  addChildTask,
  addTask,
  answerTimeRequest,
  applyNativeEvents,
  approveTask,
  askForTime,
  closeSession,
  completeWithQuestions,
  createLinkCode,
  deleteTask,
  editTask,
  emergencyUnlock,
  isValidContact,
  joinFamily,
  markNotificationsRead,
  markRewardSeen,
  markThreadRead,
  normalizeContact,
  remindApprover,
  requestRedo,
  sendMessage,
  setChildRules,
  spendScroll,
  startSession,
  submitPhoto,
  unlinkChild,
  updateAccount,
  type NativeUsageEvent,
  type TaskInput,
} from './logic';
import { isValidTimeZone } from './time';
import type { Account, AppData, Repeat, RewardKind, VerifyMethod } from './types';

export interface ActionResult {
  data: AppData;
  result?: unknown;
}

type Handler = (data: AppData, actor: string, args: Record<string, unknown>, now: number) => AppData | ActionResult;

/* ───────── Argument checks ───────── */

const bad = (): never => {
  throw new KaziError('Something went wrong with that request. Please try again.');
};

function str(v: unknown, max = 200): string {
  if (typeof v !== 'string' || v.length > max) bad();
  return v as string;
}

function id(v: unknown): string {
  const s = str(v, 64);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) bad();
  return s;
}

function int(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) bad();
  return v as number;
}

function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') bad();
  return v as boolean;
}

function clock(v: unknown): string | null {
  if (v === null) return null;
  const s = str(v, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) bad();
  return s;
}

/** A listed app's id, or "pkg:" and the package name of an app found on the phone. */
function appId(v: unknown): string {
  const s = str(v, 160);
  if (!isValidAppId(s)) bad();
  return s;
}

function appIds(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_LOCKED_APPS) bad();
  return [...new Set((v as unknown[]).map(appId))];
}

/** The installed-apps list a phone reports. */
function phoneApps(v: unknown) {
  if (!Array.isArray(v) || v.length > MAX_PHONE_APPS * 2) bad();
  return normalizePhoneApps(
    (v as unknown[]).map((x) => {
      const o = x as Record<string, unknown>;
      if (!o || typeof o !== 'object') bad();
      return { pkg: str(o.pkg, 150), name: str(o.name, 200) };
    }),
  );
}

const REWARD_KINDS: RewardKind[] = ['scrolls', 'minutes'];
const REPEATS: Repeat[] = ['never', 'daily', 'weekdays'];
const VERIFY: VerifyMethod[] = ['photo', 'questions'];

function oneOf<T extends string>(v: unknown, options: T[]): T {
  if (typeof v !== 'string' || !options.includes(v as T)) bad();
  return v as T;
}

function taskInput(v: unknown): TaskInput {
  if (!v || typeof v !== 'object') bad();
  const o = v as Record<string, unknown>;
  return {
    title: str(o.title, 200),
    rewardKind: oneOf(o.rewardKind, REWARD_KINDS),
    amount: int(o.amount),
    verify: o.verify === undefined ? 'photo' : oneOf(o.verify, VERIFY),
    repeat: oneOf(o.repeat, REPEATS),
    dueTime: o.dueTime === undefined ? null : clock(o.dueTime),
  };
}

function me(data: AppData, actor: string): Account {
  const a = data.accounts[actor];
  if (!a) throw new KaziError('Please sign in again');
  return a;
}

/* ───────── Profile ───────── */

const RELATIONS = ['Friend', 'Sister', 'Brother', 'Parent', 'Partner', 'Other'];

/**
 * The only account fields a person may change themselves. Balances, history
 * and family links change through their own actions; a child's locked apps
 * and unlock time are set by their parent.
 */
function updateProfile(data: AppData, actor: string, args: Record<string, unknown>): AppData {
  const a = me(data, actor);
  const patch = (args.patch ?? {}) as Record<string, unknown>;
  if (typeof patch !== 'object') bad();
  const out: Partial<Account> = {};
  const linkedChild = a.mode === 'child' && a.parentId !== null;
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'name': {
        const name = str(value, 40).trim();
        if (!name) throw new KaziError('Enter your name');
        out.name = name;
        break;
      }
      case 'mode': {
        const mode = oneOf(value, ['personal', 'parent']);
        if (linkedChild) throw new KaziError('Ask your parent to unlink you first');
        out.mode = mode;
        break;
      }
      case 'onboarded':
        if (value !== true) bad();
        out.onboarded = true;
        break;
      case 'permissions': {
        const p = value as Record<string, unknown>;
        if (!p || typeof p !== 'object') bad();
        out.permissions = { usage: bool(p.usage), accessibility: bool(p.accessibility) };
        break;
      }
      case 'lockedApps':
        if (linkedChild) throw new KaziError('Your parent sets which apps are locked');
        out.lockedApps = appIds(value);
        break;
      case 'phoneApps':
        // A child's phone reports its apps too, so their parent can put limits on them.
        out.phoneApps = phoneApps(value);
        break;
      case 'unlockTime':
        if (linkedChild) throw new KaziError('Your parent sets your unlock time');
        out.unlockTime = clock(value);
        break;
      case 'verifier': {
        if (linkedChild) throw new KaziError('Your parent checks your tasks');
        if (value === null) {
          out.verifier = null;
          break;
        }
        const v = value as Record<string, unknown>;
        if (!v || typeof v !== 'object') bad();
        const contact = str(v.contact, 120).trim();
        if (!isValidContact(contact)) throw new KaziError('Enter a valid email or phone number');
        if (normalizeContact(contact) === normalizeContact(a.email)) throw new KaziError('Pick someone else. You can’t check your own work.');
        out.verifier = { contact, relation: oneOf(v.relation, RELATIONS) };
        break;
      }
      case 'notificationsOn':
        out.notificationsOn = bool(value);
        break;
      case 'timeZone':
        if (!isValidTimeZone(value)) bad();
        out.timeZone = value as string;
        break;
      default:
        bad();
    }
  }
  return updateAccount(data, actor, out);
}

/* ───────── Table ───────── */

export const ACTIONS = {
  updateProfile: (d, actor, a) => updateProfile(d, actor, a),

  addTask: (d, actor, a, now) => {
    const r = addTask(d, actor, taskInput(a.input), now);
    return { data: r.data, result: r.id };
  },
  editTask: (d, actor, a) => editTask(d, id(a.taskId), actor, taskInput(a.input)),
  deleteTask: (d, actor, a) => deleteTask(d, id(a.taskId), actor),
  submitPhoto: (d, actor, a, now) => submitPhoto(d, id(a.taskId), actor, now),
  remindApprover: (d, actor, a, now) => remindApprover(d, id(a.taskId), actor, now),
  completeWithQuestions: (d, actor, a, now) => {
    if (!Array.isArray(a.answers) || a.answers.length !== 3) bad();
    return completeWithQuestions(d, id(a.taskId), actor, (a.answers as unknown[]).map((x) => str(x, 2000)), now);
  },
  markRewardSeen: (d, actor, a) => {
    const t = d.tasks[id(a.taskId)];
    if (!t || t.ownerId !== actor) return d;
    return markRewardSeen(d, t.id);
  },
  approveTask: (d, actor, a, now) => approveTask(d, id(a.taskId), actor, now),
  requestRedo: (d, actor, a, now) => requestRedo(d, id(a.taskId), actor, str(a.reason, 200), now),
  markNotificationsRead: (d, actor) => markNotificationsRead(d, actor),

  emergencyUnlock: (d, actor, a, now) => emergencyUnlock(d, actor, appId(a.appId), now),
  askForTime: (d, actor, a, now) => askForTime(d, actor, appId(a.appId), now),
  answerTimeRequest: (d, actor, a, now) => answerTimeRequest(d, id(a.requestId), actor, bool(a.grant), now),

  createLinkCode: (d, actor, _a, now) => {
    me(d, actor);
    return createLinkCode(d, actor, now, secureRandom);
  },
  joinFamily: (d, actor, a, now) => joinFamily(d, actor, str(a.code, 12), now),
  addChildTask: (d, actor, a, now) => {
    const input = taskInput(a.input);
    const r = addChildTask(d, actor, id(a.childId), input, now);
    return { data: r.data, result: r.id };
  },
  setChildRules: (d, actor, a, now) => {
    const rules = a.rules as Record<string, unknown>;
    if (!rules || typeof rules !== 'object') bad();
    return setChildRules(d, actor, id(a.childId), { lockedApps: appIds(rules.lockedApps), unlockTime: clock(rules.unlockTime) }, now);
  },
  unlinkChild: (d, actor, a) => unlinkChild(d, actor, id(a.childId)),

  // The built-in demo of locked apps (web only; the Android app reports real usage instead).
  spendScroll: (d, actor, a, now) => {
    const r = spendScroll(d, actor, appId(a.appId), id(a.sessionKey), now);
    return { data: r.data, result: r.result };
  },
  startSession: (d, actor, a, now) => startSession(d, actor, appId(a.appId), now),
  closeSession: (d, actor, a, now) => {
    const s = me(d, actor).session;
    if (!s) return d;
    // A close time is only accepted between the session's start and now.
    const at = a.at === undefined ? now : Math.min(now, Math.max(s.startedAt, int(a.at)));
    return closeSession(d, actor, at);
  },

  applyNativeEvents: (d, actor, a, now) => {
    if (!Array.isArray(a.events) || a.events.length > 1000) bad();
    const events: NativeUsageEvent[] = (a.events as unknown[]).map((e) => {
      const o = e as Record<string, unknown>;
      if (!o || typeof o !== 'object') bad();
      const amount = o.amount;
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 86_400) bad();
      return {
        seq: int(o.seq),
        appId: appId(o.appId),
        kind: oneOf(o.kind, REWARD_KINDS),
        amount: amount as number,
        session: str(o.session, 200),
        at: int(o.at),
      };
    });
    return applyNativeEvents(d, actor, id(a.deviceId), events, now);
  },

  sendMessage: (d, actor, a, now) => sendMessage(d, actor, id(a.to), str(a.text, 4000), now),
  markThreadRead: (d, actor, a) => markThreadRead(d, actor, id(a.withId)),
} satisfies Record<string, Handler>;

export type ActionName = keyof typeof ACTIONS;

export function isActionName(name: string): name is ActionName {
  return Object.prototype.hasOwnProperty.call(ACTIONS, name);
}

/** Applies one action as `actor`. Throws KaziError when it is refused. */
export function applyAction(data: AppData, actor: string, name: ActionName, args: unknown, now: number): ActionResult {
  if (!args || typeof args !== 'object' || Array.isArray(args)) bad();
  const out = (ACTIONS[name] as Handler)(data, actor, args as Record<string, unknown>, now);
  // Handlers return either the new data, or the new data plus a result (such as a new task's id).
  return 'version' in out ? { data: out } : out;
}

/** Unbiased random numbers for family codes, from the platform's secure generator. */
export function secureRandom(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 0x1_0000_0000;
}
