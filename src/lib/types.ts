export type Mode = 'personal' | 'parent' | 'child';

/** What a task pays out. Scrolls unlock feed apps, minutes unlock everything else. */
export type RewardKind = 'scrolls' | 'minutes';

export type VerifyMethod = 'photo' | 'questions';

export type TaskStatus = 'todo' | 'pending' | 'redo' | 'done';

export type Repeat = 'never' | 'daily' | 'weekdays';

export interface Verifier {
  contact: string;
  relation: string;
}

export interface LedgerEntry {
  id: string;
  at: number;
  label: string;
  /** Positive when earned, negative when spent. Minutes for screen time. */
  amount: number;
  unit: RewardKind;
  /** Exact seconds behind a screen-time line recorded by the phone. */
  seconds?: number;
}

export interface ActiveSession {
  appId: string;
  startedAt: number;
  /** True when the session started during the free unlock window, so nothing is charged. */
  free: boolean;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  mode: Mode;
  createdAt: number;
  onboarded: boolean;
  permissions: { usage: boolean; accessibility: boolean };
  lockedApps: string[];
  /** "HH:MM" in 24h, or null when there is no free unlock. */
  unlockTime: string | null;
  verifier: Verifier | null;
  parentId: string | null;
  scrolls: number;
  /** Screen time balance, kept in seconds so running timers stay exact. */
  screenSeconds: number;
  ledger: LedgerEntry[];
  emergencyUses: number[];
  notificationsOn: boolean;
  session: ActiveSession | null;
  /** Local day key (YYYY-MM-DD) the daily reset last ran for. */
  lastDay: string;
  /** Day the "apps unlocked" notice was last sent. */
  unlockNoticeDay: string | null;
  lowScrollNoticeDay: string | null;
  /** Last phone usage event applied from each of this account's phones (see android LockStore). */
  nativeSeqs?: Record<string, number>;
  /** IANA zone the account's days and unlock time are counted in. */
  timeZone?: string;
  /** Secret part of this account's live-update channel name. Only ever sent to the account itself. */
  notifyKey?: string;
}

export interface Task {
  id: string;
  ownerId: string;
  createdBy: string;
  title: string;
  reward: { kind: RewardKind; amount: number };
  verify: VerifyMethod;
  /** For photo tasks: the verifier contact (email/phone) at the time the task was made. */
  verifierContact: string | null;
  /** For family tasks the parent approves directly. */
  verifierId: string | null;
  status: TaskStatus;
  repeat: Repeat;
  /** "HH:MM" due time for family tasks. */
  dueTime: string | null;
  day: string;
  addedAt: number;
  submittedAt: number | null;
  completedAt: number | null;
  approvedBy: string | null;
  redoReason: string | null;
  /** Owner has seen the "scrolls earned" screen for this completion. */
  rewardSeen: boolean;
  remindedAt: number | null;
  /** Log of completions, so repeating tasks keep their history. */
  completions: number[];
}

export interface AppNotification {
  id: string;
  accountId: string;
  at: number;
  text: string;
  read: boolean;
  link: string | null;
}

export interface LinkCode {
  code: string;
  parentId: string;
  expiresAt: number;
}

export interface TimeRequest {
  id: string;
  childId: string;
  parentId: string;
  appId: string;
  at: number;
  status: 'open' | 'granted' | 'declined';
}

export interface Message {
  id: string;
  from: string;
  to: string;
  text: string;
  at: number;
  read: boolean;
}

export interface AppData {
  version: 1;
  accounts: Record<string, Account>;
  sessionId: string | null;
  tasks: Record<string, Task>;
  notifications: AppNotification[];
  linkCodes: LinkCode[];
  timeRequests: TimeRequest[];
  messages: Message[];
}
