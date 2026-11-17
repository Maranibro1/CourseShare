import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppData } from '../src/lib/types';
import { createKaziServer } from './app';
import { FileStorage } from './storage';

// Smallest valid JPEG header plus padding; the server only checks the signature.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

let base = '';
let dir = '';
let close: () => Promise<void>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kazi-'));
  const web = join(dir, 'web');
  await mkdir(join(web, 'assets'), { recursive: true });
  await writeFile(join(web, 'index.html'), '<!doctype html><title>Kazikwanza</title>');
  await writeFile(join(dir, 'secret.txt'), 'top secret');
  const { server, flush } = await createKaziServer({ storage: new FileStorage(join(dir, 'data')), staticDir: web });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await flush();
  };
});

afterAll(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});

async function call(path: string, init: { method?: string; token?: string; json?: unknown; body?: Buffer; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...init.headers };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.body) body = init.body;
  const res = await fetch(base + path, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : null;
  return { res, data };
}

async function signUp(name: string, email: string) {
  const { res, data } = await call('/api/signup', { json: { name, email, password: 'password1', timeZone: 'Africa/Nairobi' } });
  expect(res.status).toBe(201);
  return { token: data.token as string, id: (data.state as AppData).sessionId as string };
}

async function act(token: string, name: string, args: Record<string, unknown> = {}) {
  return call('/api/action', { token, json: { name, args } });
}

describe('sync server', () => {
  let sam: { token: string; id: string };
  let emma: { token: string; id: string };
  let mallory: { token: string; id: string };
  let taskId = '';

  it('creates accounts and refuses duplicates and bad passwords', async () => {
    sam = await signUp('Sam', 'sam@example.com');
    emma = await signUp('Emma', 'emma@example.com');
    mallory = await signUp('Mallory', 'mallory@example.com');
    const dup = await call('/api/signup', { json: { name: 'Sam 2', email: 'SAM@example.com', password: 'password1' } });
    expect(dup.res.status).toBe(400);
    expect(dup.data.error).toMatch(/already exists/);
    const short = await call('/api/signup', { json: { name: 'X', email: 'x@example.com', password: '123' } });
    expect(short.res.status).toBe(400);
  });

  it('signs in with the right password only, and never returns password hashes', async () => {
    const wrong = await call('/api/signin', { json: { email: 'sam@example.com', password: 'nope' } });
    expect(wrong.res.status).toBe(400);
    const ok = await call('/api/signin', { json: { email: 'sam@example.com', password: 'password1' } });
    expect(ok.res.status).toBe(200);
    expect(JSON.stringify(ok.data)).not.toContain('scrypt$');
    expect(ok.data.state.accounts[sam.id].timeZone).toBe('Africa/Nairobi');
  });

  it('rejects missing or made-up tokens', async () => {
    expect((await call('/api/state')).res.status).toBe(401);
    expect((await call('/api/state', { token: 'x'.repeat(43) })).res.status).toBe(401);
  });

  it('runs the verifier flow across two accounts', async () => {
    await act(sam.token, 'updateProfile', { patch: { verifier: { contact: 'emma@example.com', relation: 'Sister' }, onboarded: true } });
    const added = await act(sam.token, 'addTask', { input: { title: 'Statistics assignment', rewardKind: 'scrolls', amount: 100, verify: 'photo', repeat: 'never' } });
    expect(added.res.status).toBe(200);
    taskId = added.data.result;

    // Only the owner can upload, and only real images.
    expect((await call(`/api/photos/${taskId}`, { method: 'PUT', token: mallory.token, body: JPEG, headers: { 'Content-Type': 'image/jpeg' } })).res.status).toBe(404);
    expect((await call(`/api/photos/${taskId}`, { method: 'PUT', token: sam.token, body: Buffer.from('<script>'), headers: { 'Content-Type': 'image/jpeg' } })).res.status).toBe(400);
    expect((await call(`/api/photos/${taskId}`, { method: 'PUT', token: sam.token, body: JPEG, headers: { 'Content-Type': 'image/jpeg' } })).res.status).toBe(200);
    expect((await act(sam.token, 'submitPhoto', { taskId })).res.status).toBe(200);

    // Emma sees the request and the photo; Mallory sees neither.
    const emmaState = (await call('/api/state', { token: emma.token })).data.state as AppData;
    expect(Object.keys(emmaState.tasks)).toEqual([taskId]);
    expect(emmaState.accounts[sam.id].scrolls).toBe(0);
    const photo = await fetch(`${base}/api/photos/${taskId}`, { headers: { Authorization: `Bearer ${emma.token}` } });
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect((await call(`/api/photos/${taskId}`, { token: mallory.token })).res.status).toBe(404);
    const malloryState = (await call('/api/state', { token: mallory.token })).data.state as AppData;
    expect(Object.keys(malloryState.tasks)).toEqual([]);

    // Sam can't approve his own work; Emma can.
    expect((await act(sam.token, 'approveTask', { taskId })).res.status).toBe(400);
    const approved = await act(emma.token, 'approveTask', { taskId });
    expect(approved.res.status).toBe(200);
    const samState = (await call('/api/state', { token: sam.token })).data.state as AppData;
    expect(samState.accounts[sam.id].scrolls).toBe(100);
    // The photo is deleted once checked.
    expect((await call(`/api/photos/${taskId}`, { token: sam.token })).res.status).toBe(404);
  });

  it('delivers messages only between connected people', async () => {
    expect((await act(sam.token, 'sendMessage', { to: emma.id, text: 'Thanks!' })).res.status).toBe(200);
    expect((await act(mallory.token, 'sendMessage', { to: sam.id, text: 'hi' })).res.status).toBe(400);
    const emmaState = (await call('/api/state', { token: emma.token })).data.state as AppData;
    expect(emmaState.messages.map((m) => m.text)).toEqual(['Thanks!']);
    const malloryState = (await call('/api/state', { token: mallory.token })).data.state as AppData;
    expect(malloryState.messages).toEqual([]);
  });

  it('answers unchanged state with 304', async () => {
    const first = await fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${emma.token}` } });
    const tag = first.headers.get('etag')!;
    const again = await fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${emma.token}`, 'If-None-Match': tag } });
    expect(again.status).toBe(304);
  });

  it('pushes a change notice to the other phone', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${emma.token}` }, signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read(); // ": connected"
    await act(sam.token, 'sendMessage', { to: emma.id, text: 'Are you there?' });
    let text = '';
    while (!text.includes('event: change')) text += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    expect(text).toContain('event: change');
  });

  it('links a child across accounts and enforces the parent’s rules', async () => {
    const parent = await signUp('Achieng', 'achieng@example.com');
    const child = await signUp('Leo', 'leo@example.com');
    const withCode = await act(parent.token, 'createLinkCode');
    const code = (withCode.data.state as AppData).linkCodes[0].code;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect((await act(child.token, 'joinFamily', { code })).res.status).toBe(200);
    expect((await act(child.token, 'updateProfile', { patch: { lockedApps: [] } })).res.status).toBe(400);
    expect((await act(parent.token, 'setChildRules', { childId: child.id, rules: { lockedApps: ['tiktok'], unlockTime: null } })).res.status).toBe(200);
    const childState = (await call('/api/state', { token: child.token })).data.state as AppData;
    expect(childState.accounts[child.id].lockedApps).toEqual(['tiktok']);
    // A stranger can't change someone else's child.
    expect((await act(sam.token, 'setChildRules', { childId: child.id, rules: { lockedApps: [], unlockTime: null } })).res.status).toBe(400);
  });

  it('accepts phone usage once per phone', async () => {
    const events = [{ seq: 1, appId: 'tiktok', kind: 'scrolls', amount: 7, session: 's1', at: Date.now() }];
    await act(sam.token, 'applyNativeEvents', { deviceId: 'phoneA', events });
    await act(sam.token, 'applyNativeEvents', { deviceId: 'phoneA', events });
    const state = (await call('/api/state', { token: sam.token })).data.state as AppData;
    expect(state.accounts[sam.id].scrolls).toBe(93);
  });

  it('serves the web app but nothing outside it', async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await page.text()).toContain('Kazikwanza');
    expect((await fetch(`${base}/../secret.txt`)).status).toBe(404);
    expect((await fetch(`${base}/%2e%2e/secret.txt`)).status).toBe(404);
    expect((await fetch(`${base}/assets/..%2f..%2fsecret.txt`)).status).toBe(404);
  });

  it('lets the Android app call the API but not other websites', async () => {
    const app = await fetch(`${base}/api/health`, { headers: { Origin: 'https://localhost' } });
    expect(app.headers.get('access-control-allow-origin')).toBe('https://localhost');
    const other = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('keeps data after a restart', async () => {
    await close();
    const { server, flush } = await createKaziServer({ storage: new FileStorage(join(dir, 'data')) });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await flush();
    };
    const state = (await call('/api/state', { token: sam.token })).data.state as AppData;
    expect(state.accounts[sam.id].scrolls).toBe(93);
    expect(state.messages.length).toBe(2);
  });

  it('signs out', async () => {
    await call('/api/signout', { token: mallory.token, json: {} });
    expect((await call('/api/state', { token: mallory.token })).res.status).toBe(401);
  });
});
