import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  addChildTask,
  addTask,
  createAccount,
  createLinkCode,
  emptyData,
  joinFamily,
  sendMessage,
  submitPhoto,
  updateAccount,
} from '../src/lib/logic';
import type { AppData } from '../src/lib/types';
import { PgRepo } from './pg-repo';
import { ConflictError, MemoryRepo, TakenError, canonical, diff, type Loaded, type Repo } from './repo';

const T0 = new Date(2026, 9, 21, 8, 0, 0).getTime();
const run = Math.random().toString(36).slice(2, 8);

/** A small world: Sam checked by Emma, Achieng with child Leo, Mallory alone, plus tasks, messages and a code. */
function world() {
  let d: AppData = emptyData();
  const add = (name: string, email: string) => {
    const r = createAccount(d, { name, email: email.replace('@', `+${run}@`), passwordHash: 'x' }, T0);
    d = r.data;
    return r.id;
  };
  const sam = add('Sam', 'sam@example.com');
  const emma = add('Emma', 'emma@example.com');
  const mum = add('Achieng', 'achieng@example.com');
  const leo = add('Leo', 'leo@example.com');
  const mallory = add('Mallory', 'mallory@example.com');
  // Usernames: Kofi picks Wanjiru by @username; Wanjiru must see Kofi and his photo task, and nobody else must.
  const wanjiru = add('Wanjiru', 'wanjiru@example.com');
  const kofi = add('Kofi', 'kofi@example.com');
  d = updateAccount(d, wanjiru, { username: `wanjiru_${run}` });
  d = updateAccount(d, kofi, { username: `kofi_${run}`, onboarded: true, verifier: { contact: `@Wanjiru_${run}`, relation: 'Friend' } });
  const t2 = addTask(d, kofi, { title: 'Gym', rewardKind: 'minutes', amount: 20, verify: 'photo', repeat: 'never' }, T0);
  d = submitPhoto(t2.data, t2.id, kofi, T0);
  // Kofi lets Wanjiru review his self-checked tasks, so she also sees his questions task.
  d = updateAccount(d, kofi, { letFriendsReview: true });
  d = addTask(d, kofi, { title: 'Read', rewardKind: 'scrolls', amount: 5, verify: 'questions', repeat: 'never' }, T0).data;
  d = updateAccount(d, sam, { onboarded: true, verifier: { contact: `EMMA+${run}@example.com`, relation: 'Sister' } });
  const t1 = addTask(d, sam, { title: 'Essay', rewardKind: 'scrolls', amount: 50, verify: 'photo', repeat: 'never' }, T0);
  d = submitPhoto(t1.data, t1.id, sam, T0);
  d = addTask(d, sam, { title: 'Read', rewardKind: 'scrolls', amount: 20, verify: 'questions', repeat: 'daily' }, T0).data;
  d = addTask(d, mallory, { title: 'Run', rewardKind: 'minutes', amount: 10, verify: 'questions', repeat: 'never' }, T0).data;
  d = createLinkCode(d, mum, T0);
  d = joinFamily(d, leo, d.linkCodes[0].code, T0);
  d = addChildTask(d, mum, leo, { title: 'Homework', rewardKind: 'scrolls', amount: 30, repeat: 'never' }, T0).data;
  d = createLinkCode(d, mum, T0 + 1);
  d = sendMessage(d, sam, emma, 'Sent my essay', T0);
  d = sendMessage(d, leo, mum, 'Done!', T0 + 5);
  d.sessionId = null;
  return { d, ids: { sam, emma, mum, leo, mallory, wanjiru, kofi }, code: d.linkCodes[0].code };
}

/** Compares two loads regardless of row order. */
function normalize(l: Loaded) {
  const byId = <T extends { id?: string; code?: string }>(xs: T[]) => [...xs].sort((a, b) => String(a.id ?? a.code).localeCompare(String(b.id ?? b.code)));
  return {
    accounts: Object.keys(l.data.accounts).sort(),
    tasks: Object.keys(l.data.tasks).sort(),
    notifications: byId(l.data.notifications).map((n) => n.id),
    messages: byId(l.data.messages).map((m) => m.id),
    linkCodes: byId(l.data.linkCodes).map((c) => c.code),
    timeRequests: byId(l.data.timeRequests).map((r) => r.id),
    data: canonical(l.data.accounts),
    taskData: canonical(l.data.tasks),
  };
}

const pgUrl = process.env.KAZI_TEST_DATABASE_URL;
const repos: { name: string; make: () => Promise<Repo & { close?: () => Promise<void> }> }[] = [{ name: 'memory', make: async () => new MemoryRepo() }];
if (pgUrl) {
  repos.push({
    name: 'Postgres (Supabase SQL)',
    make: async () => {
      const r = new PgRepo(pgUrl, resolve('supabase/schema.sql'));
      await r.init();
      return r;
    },
  });
}

describe.each(repos)('$name repo', ({ make }) => {
  let repo: Repo & { close?: () => Promise<void> };
  const { d, ids, code } = world();
  afterAll(async () => repo?.close?.());

  it('stores a world and loads each person’s slice like the reference rules', async () => {
    repo = await make();
    await repo.commit(diff(emptyData(), d, { accounts: {}, tasks: {} }));
    const reference = new MemoryRepo({ data: structuredClone(d) });
    for (const id of Object.values(ids)) {
      expect(normalize(await repo.load(id)), id).toEqual(normalize(await reference.load(id)));
    }
    // A child typing a family code also gets that code and its parent.
    const withCode = await repo.load(ids.mallory, { code: code.toLowerCase() });
    expect(withCode.data.linkCodes.map((c) => c.code)).toEqual([code]);
    expect(Object.keys(withCode.data.accounts)).toContain(ids.mum);
  });

  it('keeps people’s slices apart', async () => {
    const mallory = await repo.load(ids.mallory);
    expect(Object.keys(mallory.data.accounts)).toEqual([ids.mallory]);
    expect(mallory.data.messages).toEqual([]);
    const emma = await repo.load(ids.emma);
    expect(Object.values(emma.data.tasks).map((t) => t.title)).toEqual(['Essay']);
    // Picked by @username: Wanjiru sees Kofi and his photo, and Kofi sees her.
    const wanjiru = await repo.load(ids.wanjiru);
    expect(Object.keys(wanjiru.data.accounts).sort()).toEqual([ids.kofi, ids.wanjiru].sort());
    expect(Object.values(wanjiru.data.tasks).map((t) => t.title).sort()).toEqual(['Gym', 'Read']);
    expect(Object.keys((await repo.load(ids.kofi)).data.accounts).sort()).toEqual([ids.kofi, ids.wanjiru].sort());
  });

  it('refuses a stale write instead of overwriting it', async () => {
    const a = await repo.load(ids.sam);
    const b = await repo.load(ids.sam);
    const bump = (l: Loaded, scrolls: number) => {
      const after = structuredClone(l.data);
      after.accounts[ids.sam].scrolls = scrolls;
      return diff(l.data, after, l.versions);
    };
    await repo.commit(bump(a, 11));
    await expect(repo.commit(bump(b, 22))).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.load(ids.sam)).data.accounts[ids.sam].scrolls).toBe(11);
  });

  it('refuses a second account with the same email or phone', async () => {
    const dup = createAccount(emptyData(), { name: 'Sam 2', email: `SAM+${run}@example.com`, passwordHash: 'x' }, T0);
    await expect(repo.commit(diff(emptyData(), dup.data, { accounts: {}, tasks: {} }))).rejects.toBeInstanceOf(TakenError);
  });

  it('refuses a username someone else already has', async () => {
    const l = await repo.load(ids.mallory);
    const after = structuredClone(l.data);
    after.accounts[ids.mallory].username = `wanjiru_${run}`;
    await expect(repo.commit(diff(l.data, after, l.versions))).rejects.toBeInstanceOf(TakenError);
    expect((await repo.findAccount(`@wanjiru_${run}`))?.id).toBe(ids.wanjiru);
  });

  it('saves sessions and finds accounts by email', async () => {
    await repo.putSession('k1', { accountId: ids.sam, createdAt: 1, lastUsed: 2 });
    expect(await repo.getSession('k1')).toEqual({ accountId: ids.sam, createdAt: 1, lastUsed: 2 });
    await repo.deleteSession('k1');
    expect(await repo.getSession('k1')).toBeNull();
    expect((await repo.findAccount(`sam+${run}@example.com`))?.id).toBe(ids.sam);
  });
});
