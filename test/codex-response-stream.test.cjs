'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { codexResponseSse, codexResponseEvent } = require('./load-ts.cjs')('src/main/codexResponseStream.ts');
const complete = { type: 'response.completed', response: { id: 'synthetic', status: 'completed' } };
const delta = { type: 'response.output_text.delta', delta: 'café 🪴' };
const sse = event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
async function read(chunks) { const frames = []; for await (const frame of codexResponseSse(Readable.from(chunks))) frames.push(frame.toString()); return frames.join(''); }

test('SSE framing survives every UTF-8 byte boundary, CRLF and multiline data without relaying metadata', async () => {
  const bytes = Buffer.from(`: synthetic-secret\r\nid: synthetic-secret\r\nretry: 1000\r\ndata: ${JSON.stringify(delta)}\r\n\r\n` +
    `event: response.completed\ndata: {"type":"response.completed",\ndata: "response":{"id":"synthetic","status":"completed"}}\n\n` +
    'data: [DONE]\n\n');
  const output = await read(Array.from(bytes, byte => Buffer.from([byte])));
  assert.equal(output, sse(delta) + sse(complete)); assert.doesNotMatch(output, /synthetic-secret|retry|DONE/);
});

test('completion is withheld until clean EOF; ordinary deltas remain streaming', async () => {
  let release; const gate = new Promise(resolve => release = resolve);
  async function* source() { yield Buffer.from(sse(delta)); yield Buffer.from(sse(complete)); await gate; }
  const iterator = codexResponseSse(source());
  assert.equal((await iterator.next()).value.toString(), sse(delta));
  let finished = false; const next = iterator.next().then(result => { finished = true; return result; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false);
  release(); assert.equal((await next).value.toString(), sse(complete)); assert.equal((await iterator.next()).done, true);
});

test('missing, forged, truncated, mismatched or trailing completion data is rejected', async () => {
  for (const value of ['', sse(delta), sse(complete).slice(0, -1), 'data: [DONE]\n\n',
    'data: not-json\n\n', 'data: []\n\n', 'event: other\ndata: ' + JSON.stringify(complete) + '\n\n',
    'event: response.completed\nevent: response.completed\ndata: ' + JSON.stringify(complete) + '\n\n',
    sse({ type: 'response.completed', response: { id: 'synthetic', status: 'failed' } }),
    sse({ type: 'response.completed' }), sse(complete) + sse(delta), sse(complete) + sse(complete),
    sse(complete) + 'data: [DONE]\n\ndata: [DONE]\n\n']) {
    await assert.rejects(read([Buffer.from(value)]), undefined, value);
  }
});

test('invalid UTF-8, record size and total stream size are bounded', async () => {
  await assert.rejects(read([Buffer.from('data: "'), Buffer.from([0xff]), Buffer.from('"\n\n')]), /encoded data/);
  await assert.rejects(read([Buffer.from('x'.repeat(1024 * 1024 + 1))]), /record too large/);
  await assert.rejects(read([Buffer.from(':' + 'x'.repeat(1024 * 1024) + '\n\n')]), /record too large/);
  const comment = Buffer.from(':' + 'x'.repeat(500000) + '\n\n');
  await assert.rejects(read(Array(34).fill(comment)), /stream too large/);
});

test('both protocols reject failure events and error-bearing completed envelopes', () => {
  for (const value of [{ type: 'error', error: { message: 'synthetic-secret' } },
    { type: 'response.failed' }, { type: 'response.incomplete' },
    { ...complete, response: { ...complete.response, error: { message: 'synthetic-secret' } } }]) {
    assert.throws(() => codexResponseEvent(Buffer.from(JSON.stringify(value))), /provider did not complete/);
  }
});
