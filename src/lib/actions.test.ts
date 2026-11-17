import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import {
  addTask,
  contactsOf,
  createAccount,
  createLinkCode,
  emptyData,
  joinFamily,
  submitPhoto,
  threadBetween,
  unreadMessages,
  updateAccount,
} from './logic';
import type { AppData } from './types';
import { viewFor } from './view';

const T0 = new Date(2026, 9, 21, 8, 0, 0).getTime();

function people() {
  let data: AppData = emptyData();
  const add = (name: string, email: string) => {
    const r = createAccount(data, { name, email, passwordHash: `secret-${name}` }, T0);
    data = r.data;
    return r.id;
  };
  const sam = add('Sam', 'sam@example.com');
  const emma = add('Emma', 'emma@example.com');
  const stranger = add('Mallory', 'mallory@example.com');
  data = updateAccount(data, sam, { onboarded: true, verifier: { contact: 'emma@example.com', relation: 'Sister' } });
  return { data, sam, emma, stranger };
}

describe('profile updates', () => {
  it('only changes allowed fields', () => {
    const { data, sam } = people();
    expect(() => applyAction(data, sam, 'updateProfile', { patch: { scrolls: 9999 } }, T0)).toThrow();
    expect(() => applyAction(data, sam, 'updateProfile', { patch: { mode: 'child' } }, T0)).toThrow();
    expect(() => applyAction(data, sam, 'updateProfile', { patch: { lockedApps: ['not-an-app'] } }, T0)).toThrow();
    expect(() => applyAction(data, sam, 'updateProfile', { patch: { unlockTime: '25:00' } }, T0)).toThrow();
    const out = applyAction(data, sam, 'updateProfile', { patch: { unlockTime: '17:30', notificationsOn: false, timeZone: 'Africa/Nairobi' } }, T0);
    expect(out.data.accounts[sam]).toMatchObject({ unlockTime: '17:30', notificationsOn: false, timeZone: 'Africa/Nairobi' });
  });

  it('refuses yourself as your own verifier', () => {
    const { data, sam } = people();
    expect(() => applyAction(data, sam, 'updateProfile', { patch: { verifier: { contact: 'SAM@example.com', relation: 'Friend' } } }, T0)).toThrow(
      /own work/,
    );
  });

  it('keeps a linked child from changing their own locks', () => {
    let { data, emma, stranger } = people();
    data = createLinkCode(data, emma, T0);
    data = joinFamily(data, stranger, data.linkCodes[0].code, T0);
    expect(() => applyAction(data, stranger, 'updateProfile', { patch: { lockedApps: [] } }, T0)).toThrow(/parent/);
    expect(() => applyAction(data, stranger, 'updateProfile', { patch: { unlockTime: null } }, T0)).toThrow(/parent/);
    expect(() => applyAction(data, stranger, 'updateProfile', { patch: { mode: 'personal' } }, T0)).toThrow(/unlink/);
  });
});

describe('acting as the signed-in person only', () => {
  it('lets only the verifier approve', () => {
    let { data, sam, emma, stranger } = people();
    const t = addTask(data, sam, { title: 'Essay', rewardKind: 'scrolls', amount: 50, verify: 'photo', repeat: 'never' }, T0);
    data = submitPhoto(t.data, t.id, sam, T0);
    expect(() => applyAction(data, stranger, 'approveTask', { taskId: t.id }, T0)).toThrow();
    expect(() => applyAction(data, sam, 'approveTask', { taskId: t.id }, T0)).toThrow();
    const out = applyAction(data, emma, 'approveTask', { taskId: t.id }, T0);
    expect(out.data.accounts[sam].scrolls).toBe(50);
  });

  it('rejects malformed arguments', () => {
    const { data, sam } = people();
    expect(() => applyAction(data, sam, 'addTask', { input: { title: 'x', rewardKind: 'gold', amount: 5, repeat: 'never' } }, T0)).toThrow();
    expect(() => applyAction(data, sam, 'addTask', { input: { title: 'x', rewardKind: 'scrolls', amount: 1.5, repeat: 'never', verify: 'questions' } }, T0)).toThrow();
    expect(() => applyAction(data, sam, 'deleteTask', { taskId: '../../etc' }, T0)).toThrow();
    expect(() => applyAction(data, sam, 'applyNativeEvents', { deviceId: 'p', events: [{ seq: 1, appId: 'tiktok', kind: 'scrolls', amount: -5, session: 's', at: T0 }] }, T0)).toThrow();
  });

  it('returns the new task id', () => {
    const { data, sam } = people();
    const out = applyAction(data, sam, 'addTask', { input: { title: 'Read', rewardKind: 'scrolls', amount: 20, repeat: 'never', verify: 'questions' } }, T0);
    expect(typeof out.result).toBe('string');
    expect(out.data.tasks[out.result as string].ownerId).toBe(sam);
  });
});

describe('messages', () => {
  it('lets a person and their verifier talk, and no one else', () => {
    let { data, sam, emma, stranger } = people();
    expect(contactsOf(data, sam).map((c) => c.id)).toEqual([emma]);
    expect(contactsOf(data, emma).map((c) => c.id)).toEqual([sam]);
    expect(contactsOf(data, emma)[0].checksWith).toBe(true);
    data = applyAction(data, sam, 'sendMessage', { to: emma, text: '  Sent my essay photo  ' }, T0).data;
    data = applyAction(data, emma, 'sendMessage', { to: sam, text: 'Looks great!' }, T0 + 1000).data;
    expect(threadBetween(data, sam, emma).map((m) => m.text)).toEqual(['Sent my essay photo', 'Looks great!']);
    expect(unreadMessages(data, sam)).toBe(1);
    data = applyAction(data, sam, 'markThreadRead', { withId: emma }, T0).data;
    expect(unreadMessages(data, sam)).toBe(0);
    expect(() => applyAction(data, stranger, 'sendMessage', { to: sam, text: 'hi' }, T0)).toThrow(/verifier/);
    expect(() => applyAction(data, sam, 'sendMessage', { to: emma, text: '   ' }, T0)).toThrow(/Write/);
    expect(() => applyAction(data, sam, 'sendMessage', { to: emma, text: 'x'.repeat(1001) }, T0)).toThrow(/under/);
  });

  it('connects parents and children', () => {
    let { data, emma, stranger } = people();
    data = createLinkCode(data, emma, T0);
    data = joinFamily(data, stranger, data.linkCodes[0].code, T0);
    expect(contactsOf(data, stranger).map((c) => c.roles)).toEqual([['Your parent']]);
    data = applyAction(data, stranger, 'sendMessage', { to: emma, text: 'Can I have 10 more minutes?' }, T0).data;
    expect(unreadMessages(data, emma)).toBe(1);
  });

  it('shows a verifier who has not joined as pending', () => {
    let { data, sam } = people();
    data = updateAccount(data, sam, { verifier: { contact: 'new@example.com', relation: 'Friend' } });
    const [c] = contactsOf(data, sam);
    expect(c.id).toBeNull();
    expect(c.name).toBe('new@example.com');
  });
});

describe('what each person can see', () => {
  it('hides other people’s private data and unrelated records', () => {
    let { data, sam, emma, stranger } = people();
    data = updateAccount(data, sam, { scrolls: 77 });
    const t = addTask(data, sam, { title: 'Essay', rewardKind: 'scrolls', amount: 50, verify: 'photo', repeat: 'never' }, T0);
    data = submitPhoto(t.data, t.id, sam, T0);
    data = applyAction(data, sam, 'sendMessage', { to: emma, text: 'hi' }, T0).data;

    const emmaView = viewFor(data, emma);
    expect(emmaView.sessionId).toBe(emma);
    expect(Object.keys(emmaView.tasks)).toEqual([t.id]);
    expect(emmaView.accounts[sam].scrolls).toBe(0);
    expect(emmaView.accounts[sam].passwordHash).toBe('');
    expect(emmaView.accounts[emma].passwordHash).toBe('');
    expect(emmaView.accounts[stranger]).toBeUndefined();
    expect(emmaView.messages).toHaveLength(1);

    const strangerView = viewFor(data, stranger);
    expect(Object.keys(strangerView.tasks)).toEqual([]);
    expect(strangerView.messages).toEqual([]);
    expect(Object.keys(strangerView.accounts)).toEqual([stranger]);

    expect(viewFor(data, sam).accounts[sam].scrolls).toBe(77);
  });

  it('lets each phone work out its own contacts from what it receives', () => {
    let { data, sam, emma, stranger } = people();
    data = createLinkCode(data, emma, T0);
    data = joinFamily(data, stranger, data.linkCodes[0].code, T0);
    const ids = (view: AppData, me: string) => contactsOf(view, me).map((c) => c.id).sort();
    // Each person's view gives the same contacts as the full data does.
    for (const me of [sam, emma, stranger]) expect(ids(viewFor(data, me), me)).toEqual(ids(data, me));
    expect(contactsOf(viewFor(data, emma), emma).find((c) => c.id === sam)?.checksWith).toBe(true);
    // But Sam's verifier choice isn't shown to people it doesn't concern.
    expect(viewFor(data, stranger).accounts[sam]).toBeUndefined();
  });

  it('gives parents their children’s full details', () => {
    let { data, emma, stranger } = people();
    data = createLinkCode(data, emma, T0);
    data = joinFamily(data, stranger, data.linkCodes[0].code, T0);
    data = updateAccount(data, stranger, { scrolls: 12 });
    expect(viewFor(data, emma).accounts[stranger].scrolls).toBe(12);
    expect(viewFor(data, emma).accounts[stranger].passwordHash).toBe('');
  });
});
