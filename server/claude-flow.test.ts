import { beforeEach, describe, expect, it } from 'vitest';
import type { AppData } from '../src/lib/types';
import type { ClaudeChecker, Verdict } from './claude';
import { createCore } from './core';
import { MemoryRepo } from './repo';

/* The whole Claude flow through the API, with a stand-in for Claude so no real calls are made. */
let verdict: Verdict = { approve: true, reason: 'Looks done!' };
const asked: string[] = [];
const fakeClaude: ClaudeChecker = {
  checkPhoto: async (task) => {
    asked.push(`photo:${task.title}`);
    return verdict;
  },
  checkAnswers: async (task, qa) => {
    asked.push(`answers:${task.title}:${qa.length}`);
    return verdict;
  },
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3, 4]);

function setup(claude: ClaudeChecker | null) {
  const core = createCore({ repo: new MemoryRepo(), passwordRounds: 1000, claude });
  async function call(path: string, init: { token?: string; json?: unknown; body?: Uint8Array; method?: string } = {}) {
    const headers: Record<string, string> = {};
    if (init.token) headers['X-Kazi-Token'] = init.token;
    let body: BodyInit | undefined;
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    } else if (init.body) body = init.body;
    const res = await core.handle(new Request(`http://x/api${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body }));
    return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
  }
  const act = (token: string, name: string, args: Record<string, unknown> = {}) => call('/action', { token, json: { name, args } });
  async function person() {
    const { data } = await call('/signup', { json: { name: 'Sam', email: 'sam@example.com', password: 'password1', timeZone: 'Africa/Nairobi' } });
    const token = data.token as string;
    await act(token, 'updateProfile', { patch: { onboarded: true } });
    return token;
  }
  return { call, act, person };
}

const state = (r: { data: { state: AppData } }) => r.data.state;

describe('Claude checks proof on the server', () => {
  beforeEach(() => {
    verdict = { approve: true, reason: 'Looks done!' };
    asked.length = 0;
  });

  it('says whether Claude is switched on', async () => {
    expect((await setup(fakeClaude).call('/health')).data).toEqual({ ok: true, claude: true });
    expect((await setup(null).call('/health')).data).toEqual({ ok: true, claude: false });
  });

  it('approves a good photo straight away and pays the reward', async () => {
    const { act, call, person } = setup(fakeClaude);
    const token = await person();
    const added = await act(token, 'addTask', { input: { title: 'Clean my room', rewardKind: 'scrolls', amount: 50, verify: 'claude', repeat: 'never' } });
    const taskId = added.data.result as string;
    expect((await call(`/photos/${taskId}`, { token, method: 'PUT', body: JPEG })).status).toBe(200);
    const sent = await act(token, 'submitPhoto', { taskId });
    expect(sent.status).toBe(200);
    expect(sent.data.result).toEqual({ claude: { approve: true, reason: 'Looks done!' } });
    const s = state(sent);
    expect(s.tasks[taskId].status).toBe('done');
    expect(s.accounts[s.sessionId!].scrolls).toBe(50);
    expect(s.notifications.some((n) => n.text.startsWith('Claude approved your clean my room'))).toBe(true);
    expect(asked).toEqual(['photo:Clean my room']);
    // The photo is deleted once Claude has looked at it.
    expect((await call(`/photos/${taskId}`, { token })).status).toBe(404);
  });

  it('sends a bad photo back with Claude’s reason', async () => {
    const { act, call, person } = setup(fakeClaude);
    const token = await person();
    const taskId = (await act(token, 'addTask', { input: { title: 'Gym', rewardKind: 'minutes', amount: 30, verify: 'claude', repeat: 'never' } })).data.result;
    await call(`/photos/${taskId}`, { token, method: 'PUT', body: JPEG });
    verdict = { approve: false, reason: 'This photo doesn’t show a gym.' };
    const sent = await act(token, 'submitPhoto', { taskId });
    const s = state(sent);
    expect(s.tasks[taskId].status).toBe('redo');
    expect(s.tasks[taskId].redoReason).toBe('This photo doesn’t show a gym.');
    expect(s.accounts[s.sessionId!].screenSeconds).toBe(0);
  });

  it('grades question answers: good ones complete the task, weak ones come back with a note', async () => {
    const { act, person } = setup(fakeClaude);
    const token = await person();
    const taskId = (await act(token, 'addTask', { input: { title: 'Read 20 pages', rewardKind: 'scrolls', amount: 20, verify: 'questions', repeat: 'never' } }))
      .data.result;
    verdict = { approve: false, reason: 'Say which book you read.' };
    const weak = await act(token, 'completeWithQuestions', { taskId, answers: ['abc', 'abc', 'abc'] });
    expect(weak.data.result).toEqual({ claude: verdict });
    expect(state(weak).tasks[taskId].status).toBe('todo');
    verdict = { approve: true, reason: 'Great detail.' };
    const good = await act(token, 'completeWithQuestions', { taskId, answers: ['Atomic Habits ch 2', 'Small habits add up', 'Make it easy'] });
    expect(state(good).tasks[taskId].status).toBe('done');
    expect(asked).toEqual(['answers:Read 20 pages:3', 'answers:Read 20 pages:3']);
  });

  it('can’t be skipped: without Claude a Claude task can’t be approved, and phones can’t send a verdict', async () => {
    const { act, call, person } = setup(null);
    const token = await person();
    const taskId = (await act(token, 'addTask', { input: { title: 'Dishes', rewardKind: 'scrolls', amount: 10, verify: 'claude', repeat: 'never' } })).data.result;
    await call(`/photos/${taskId}`, { token, method: 'PUT', body: JPEG });
    const sent = await act(token, 'submitPhoto', { taskId });
    expect(sent.status).toBe(400);
    expect(sent.data.error).toMatch(/Claude isn’t set up/);
    expect((await act(token, 'applyClaudeVerdict', { taskId })).status).toBe(400);
    expect((await act(token, 'approveTask', { taskId })).status).toBe(400);
  });

  it('stops after the daily limit', async () => {
    const { act, person } = setup(fakeClaude);
    const token = await person();
    const taskId = (await act(token, 'addTask', { input: { title: 'Read', rewardKind: 'scrolls', amount: 5, verify: 'questions', repeat: 'never' } })).data.result;
    verdict = { approve: false, reason: 'More detail please.' };
    let last = { status: 200, data: {} as Record<string, unknown> };
    for (let i = 0; i < 41 && last.status === 200; i += 1) {
      last = await act(token, 'completeWithQuestions', { taskId, answers: ['aaa', 'bbb', 'ccc'] });
    }
    // Six checks a minute per person, then 40 a day.
    expect(last.status).toBe(429);
  });
});
