import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claudeChecker } from './claude';

/* A stand-in for the Claude API: records each request and answers with a canned reply. */
let base = '';
let reply: Record<string, unknown> = {};
const seen: { headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    seen.push({ headers: req.headers, body: JSON.parse(raw) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply));
  });
});

function message(text: string, stop_reason = 'end_turn') {
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text }], stop_reason, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_BASE_URL = base;
});
afterAll(() => {
  delete process.env.ANTHROPIC_BASE_URL;
  server.close();
});

describe('Claude checker', () => {
  it('is off without an API key', () => {
    expect(claudeChecker(undefined)).toBeNull();
    expect(claudeChecker('')).toBeNull();
  });

  it('sends the photo and task to Claude and reads a structured verdict', async () => {
    reply = message(JSON.stringify({ approve: true, reason: 'The room looks tidy.' }));
    const claude = claudeChecker('sk-ant-test')!;
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const verdict = await claude.checkPhoto({ title: 'Clean my room' }, photo, 'image/jpeg');
    expect(verdict).toEqual({ approve: true, reason: 'The room looks tidy.' });

    const { headers, body } = seen.at(-1)!;
    expect(headers.authorization).toBe('Bearer sk-ant-test');
    expect(String(headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.fallbacks).toBe('default');
    expect(body.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    const content = (body.messages as { content: { type: string; source?: { data: string; media_type: string }; text?: string }[] }[])[0].content;
    expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(photo).toString('base64') } });
    expect(content[1].text).toContain('"Clean my room"');
  });

  it('grades answers and asks for a redo with Claude’s reason', async () => {
    reply = message(JSON.stringify({ approve: false, reason: 'Say which chapter you read.' }));
    const verdict = await claudeChecker('sk-ant-test')!.checkAnswers({ title: 'Read 20 pages' }, [
      { question: 'What did you read?', answer: 'stuff' },
      { question: 'Main idea?', answer: 'things' },
      { question: 'One thing you learned?', answer: 'idk' },
    ]);
    expect(verdict).toEqual({ approve: false, reason: 'Say which chapter you read.' });
    const text = (seen.at(-1)!.body.messages as { content: { text: string }[] }[])[0].content[0].text;
    expect(text).toContain('Answer: "idk"');
  });

  it('never approves when Claude declines to answer', async () => {
    reply = message('', 'refusal');
    const verdict = await claudeChecker('sk-ant-test')!.checkPhoto({ title: 'Gym' }, new Uint8Array([0x89, 0x50]), 'image/png');
    expect(verdict.approve).toBe(false);
  });
});
