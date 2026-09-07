const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const { floorVisibility } = load('src/renderer/src/scene/office/floorVisibility.ts');

function fixture(hidden = false, covered = false) {
  const document = new EventTarget();
  document.hidden = hidden;
  const gate = floorVisibility(document, () => covered);
  const ticker = { running: false, starts: 0, stops: 0,
    start() { this.running = true; this.starts++; },
    stop() { this.running = false; this.stops++; } };
  return { document, gate, ticker,
    cover(value) { covered = value; gate.refresh(); },
    hide(value) { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); } };
}

test('visible ready scene starts; Runs/fullscreen coverage pauses without replacing it', () => {
  const f = fixture();
  f.gate.attach(f.ticker);
  assert.equal(f.ticker.running, true);
  f.cover(true);
  assert.equal(f.ticker.running, false);
  f.cover(false);
  assert.equal(f.ticker.running, true);
  f.gate.dispose();
});

test('uncovering a hidden document and showing a covered document do not resume', () => {
  const f = fixture();
  f.gate.attach(f.ticker);
  f.hide(true); f.cover(true); f.cover(false);
  assert.equal(f.ticker.running, false);
  f.cover(true); f.hide(false);
  assert.equal(f.ticker.running, false);
  f.cover(false);
  assert.equal(f.ticker.running, true);
  f.gate.dispose();
});

test('async initialization uses current visibility, including changes before attachment', () => {
  const f = fixture();
  f.hide(true);
  f.gate.attach(f.ticker);
  assert.equal(f.ticker.starts, 0);
  f.hide(false);
  assert.equal(f.ticker.running, true);
  f.gate.dispose();
  const g = fixture(true, true);
  g.hide(false); g.cover(false); g.gate.attach(g.ticker);
  assert.equal(g.ticker.running, true);
  g.gate.dispose();
});

test('dispose stops the old ticker and rejects late initialization without restart', () => {
  const f = fixture();
  f.gate.attach(f.ticker);
  f.gate.dispose(); f.gate.dispose();
  const counts = [f.ticker.starts, f.ticker.stops];
  f.hide(true); f.hide(false); f.cover(false);
  assert.deepEqual([f.ticker.starts, f.ticker.stops], counts);
  const late = { running: true, start() { throw Error('revived disposed scene'); }, stop() { this.running = false; } };
  f.gate.attach(late);
  assert.equal(late.running, false);
});

test('replacement scene controls its own ticker after old scene disposal', () => {
  const old = fixture();
  old.gate.attach(old.ticker); old.gate.dispose();
  const next = fixture(true);
  next.gate.attach(next.ticker);
  assert.equal(next.ticker.running, false);
  next.hide(false);
  assert.equal(next.ticker.running, true);
  assert.equal(old.ticker.running, false);
  next.gate.dispose();
});

test('installed Pixi ticker cancels frame requests and resumes with no hidden-time jump', (t) => {
  // Real installed Pixi Ticker with a deterministic frame clock, not a GPU/app smoke.
  const { Ticker } = require('pixi.js');
  const savedRequest = globalThis.requestAnimationFrame;
  const savedCancel = globalThis.cancelAnimationFrame;
  const pending = new Map();
  let id = 0;
  globalThis.requestAnimationFrame = callback => { pending.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = key => pending.delete(key);
  const f = fixture(), ticker = new Ticker(), deltas = [];
  t.after(() => {
    f.gate.dispose(); ticker.destroy();
    if (savedRequest === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = savedRequest;
    if (savedCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = savedCancel;
  });
  const frame = time => {
    const callbacks = [...pending.values()]; pending.clear();
    for (const callback of callbacks) callback(time);
  };
  ticker.add(current => deltas.push(current.deltaMS));
  f.gate.attach(ticker);
  frame(ticker.lastTime + 16);
  assert.equal(deltas.length, 1);
  assert.equal(pending.size, 1);
  f.cover(true);
  assert.equal(ticker.started, false);
  assert.equal(pending.size, 0);
  frame(ticker.lastTime + 60_000);
  assert.equal(deltas.length, 1, 'hidden scene cannot animate');
  f.cover(false);
  assert.equal(pending.size, 1);
  frame(ticker.lastTime + 16);
  assert.equal(deltas.length, 2);
  assert.ok(deltas[1] < 20, 'resume must not replay the minute away');
  f.hide(true);
  assert.equal(pending.size, 0);
});
