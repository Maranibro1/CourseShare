// A stand-in for the Claude API for browser tests: approves proof unless the
// task's name contains "messy" (photos) or an answer contains "dunno".
import { createServer } from 'node:http';

createServer((req, res) => {
  if (req.method === 'GET') {
    res.end('ok');
    return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const text = JSON.stringify(JSON.parse(raw).messages);
    const no = /messy/i.test(text) ? 'The room still looks messy. Tidy the bed and floor, then try again.' : /dunno/i.test(text) ? 'Tell me which book and chapter you read.' : null;
    const verdict = no ? { approve: false, reason: no } : { approve: true, reason: 'Looks done!' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify(verdict) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
}).listen(Number(process.env.PORT ?? 4176));
