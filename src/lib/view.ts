/**
 * What one signed-in person may see. The sync server sends each person only
 * this slice of the shared data: their own account, the people they are
 * connected to (with private fields removed), and the tasks, messages and
 * notifications that involve them.
 */
import { approverFor, canApprove, childrenOf, contactsOf, normalizeContact } from './logic';
import type { Account, AppData } from './types';

/**
 * Name and contact only; balances, history and settings stay private. The one
 * setting kept is "who checks my work", and only when the viewer is that person.
 */
export function publicAccount(a: Account, viewerEmail = ''): Account {
  const picksViewer = !!a.verifier && !!viewerEmail && normalizeContact(a.verifier.contact) === normalizeContact(viewerEmail);
  return {
    ...a,
    passwordHash: '',
    permissions: { usage: false, accessibility: false },
    lockedApps: [],
    unlockTime: null,
    verifier: picksViewer ? a.verifier : null,
    scrolls: 0,
    screenSeconds: 0,
    ledger: [],
    emergencyUses: [],
    session: null,
    nativeSeqs: {},
    notifyKey: undefined,
    phoneApps: undefined,
    claudeChecks: undefined,
    unlockNoticeDay: null,
    lowScrollNoticeDay: null,
  };
}

/** Everything about an account except its password hash. */
export function privateAccount(a: Account): Account {
  return { ...a, passwordHash: '' };
}

export function viewFor(data: AppData, meId: string): AppData {
  const me = data.accounts[meId];
  if (!me) throw new Error('unknown account');
  const children = childrenOf(data, meId);
  const childIds = new Set(children.map((c) => c.id));

  const tasks: AppData['tasks'] = {};
  for (const t of Object.values(data.tasks)) {
    const mine = t.ownerId === meId || t.createdBy === meId;
    const mineToCheck = canApprove(data, t, meId) || t.approvedBy === meId;
    if (mine || mineToCheck || childIds.has(t.ownerId)) tasks[t.id] = t;
  }

  const accounts: AppData['accounts'] = { [meId]: privateAccount(me) };
  for (const c of children) accounts[c.id] = privateAccount(c);
  const addPublic = (a: Account | undefined) => {
    if (a && !accounts[a.id]) accounts[a.id] = publicAccount(a, me.email);
  };
  for (const c of contactsOf(data, meId)) if (c.id) addPublic(data.accounts[c.id]);
  for (const t of Object.values(tasks)) {
    addPublic(data.accounts[t.ownerId]);
    addPublic(data.accounts[t.createdBy]);
    addPublic(approverFor(data, t));
    if (t.approvedBy) addPublic(data.accounts[t.approvedBy]);
  }

  const messages = data.messages.filter((m) => m.from === meId || m.to === meId);
  for (const m of messages) addPublic(data.accounts[m.from === meId ? m.to : m.from]);

  return {
    version: 1,
    sessionId: meId,
    accounts,
    tasks,
    notifications: data.notifications.filter((n) => n.accountId === meId),
    linkCodes: data.linkCodes.filter((c) => c.parentId === meId),
    timeRequests: data.timeRequests.filter((r) => r.childId === meId || r.parentId === meId),
    messages,
  };
}
