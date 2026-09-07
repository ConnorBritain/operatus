'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinalQuitBarrier } = require('./load-ts.cjs')('src/main/finalQuit.ts');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
function fixture(flush, timeout = 100) {
  let flushes = 0, quits = 0, prevents = 0;
  let finished;
  const completion = new Promise(resolve => { finished = resolve; });
  const event = { preventDefault: () => { prevents++; } };
  const handler = createFinalQuitBarrier(() => { flushes++; return flush(); }, () => {
    quits++;
    handler(event); // Electron re-enters will-quit after the native quit call.
    finished();
  }, timeout);
  return { handler, event, completion, counts: () => ({ flushes, quits, prevents }) };
}
test('an immediate flush never resumes native quit inside a Promise microtask', async () => {
  const f = fixture(async () => {});
  f.handler(f.event);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.counts().quits, 0);
  await f.completion;
  assert.deepEqual(f.counts(), { flushes: 1, quits: 1, prevents: 1 });
});
test('duplicate quit requests wait for one flush and one deferred continuation', async () => {
  let release;
  const f = fixture(() => new Promise(resolve => { release = resolve; }));
  f.handler(f.event); f.handler(f.event);
  await Promise.resolve(); release();
  await f.completion;
  f.handler(f.event);
  assert.deepEqual(f.counts(), { flushes: 1, quits: 1, prevents: 2 });
});
for (const [name, flush] of [
  ['rejected', () => Promise.reject(new Error('offline'))],
  ['synchronously throwing', () => { throw new Error('shutdown failed'); }]
]) test(`${name} telemetry cannot prevent quit`, async () => {
  const f = fixture(flush); f.handler(f.event); await f.completion;
  assert.deepEqual(f.counts(), { flushes: 1, quits: 1, prevents: 1 });
});
test('stalled telemetry is bounded; late completion cannot quit a second time', async () => {
  let release;
  const f = fixture(() => new Promise(resolve => { release = resolve; }), 10);
  f.handler(f.event); await f.completion;
  release(); await tick();
  assert.deepEqual(f.counts(), { flushes: 1, quits: 1, prevents: 1 });
});
