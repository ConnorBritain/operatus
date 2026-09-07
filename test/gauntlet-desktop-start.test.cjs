'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const load = require('./load-ts.cjs');
const { desktopRunStarter } = load('src/main/gauntlet/desktopStart.ts');
const { subscriptionLaunchError, isolatedGauntletLaunchError } = load('src/shared/billingPolicy.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}) {
  const window = { mainFrame: {} }, event = { sender: window, senderFrame: window.mainFrame };
  const calls = [], rows = new Map(); let resolve, reject;
  const lifetime = new Promise((yes, no) => { resolve = yes; reject = no; });
  const backend = {
    start(input, assignments) { calls.push(['start', input, assignments]); const snapshot = { run: { id: 'run-1', status: 'orienting', version: 0 }, launches: [] }; rows.set('run-1', snapshot); return snapshot; },
    status(id) { return rows.get(id); },
    infrastructureFailure(id, reason, retryable) { calls.push(['failure', id, reason, retryable]); const snapshot = { ...rows.get(id), run: { ...rows.get(id).run, status: 'infrastructure_failure' } }; rows.set(id, snapshot); return snapshot; }
  };
  const services = { localWindow: () => window, hold: () => null, backend: () => backend,
    runner: () => ({ advance: id => { calls.push(['advance', id]); return lifetime; } }),
    publish: snapshot => { calls.push(['publish', snapshot.run.status]); return snapshot; },
    onDispatchError: () => { calls.push(['error']); }, ...overrides };
  return { start: desktopRunStarter(services), services, window, event, calls, rows, resolve, reject };
}
const payload = { repository: '/fixture', objective: 'Bounded task', baseRef: 'main', providers: { critic: { provider: 'codex' } },
  limits: { maxRepairRounds: 2 }, assignments: [{ role: 'implementer', sourceId: 'local', skillName: 'fixture' }] };
test('local start dispatches the exact persisted run without awaiting its lifetime or requiring any PTY', async () => {
  const f = fixture(), snapshot = f.start(f.event, payload);
  assert.equal(snapshot.run.status, 'orienting'); assert.equal(snapshot instanceof Promise, false);
  assert.deepEqual(f.calls.map(c => c[0]), ['start', 'publish', 'advance']);
  assert.deepEqual(f.calls[0][1], { repository: '/fixture', objective: 'Bounded task', baseRef: 'main', providers: payload.providers, limits: payload.limits });
  assert.deepEqual(f.calls[0][2], payload.assignments); assert.equal(f.calls[2][1], snapshot.run.id);
  f.resolve(); await tick(); assert.equal(f.calls.some(c => c[0] === 'failure'), false);
});
test('the actual subscription hold and unavailable runtime fail before any run/Git/provider mutation', () => {
  const f = fixture({ hold: subscriptionLaunchError });
  assert.throws(() => f.start(f.event, payload), /Legacy agent startup/); assert.equal(f.calls.length, 0);
  const absent = fixture({ runner: () => null }); assert.throws(() => absent.start(absent.event, payload), /not ready/);
  assert.equal(absent.calls.length, 0);
});
test('foreign web contents, subframes and malformed requests cannot create work', () => {
  const f = fixture();
  for (const event of [{ sender: {}, senderFrame: f.window.mainFrame }, { sender: f.window, senderFrame: {} }]) {
    assert.throws(() => f.start(event, payload), /local desktop/);
  }
  for (const input of [null, [], {}, { ...payload, baseRef: 12 }, { ...payload, assignments: {} }]) assert.throws(() => f.start(f.event, input));
  assert.equal(f.calls.length, 0);
});
test('asynchronous dispatch failure becomes explicit infrastructure failure, not a worker retry', async () => {
  const f = fixture(); f.start(f.event, payload); f.reject(Error('fixture rejection')); await tick();
  assert.equal(f.rows.get('run-1').run.status, 'infrastructure_failure');
  assert.equal(f.calls.filter(c => c[0] === 'failure').length, 1); assert.equal(f.calls.find(c => c[0] === 'failure')[3], false);
});
test('late rejected dispatch cannot overwrite cancellation or a terminal result', async () => {
  for (const status of ['cancelled', 'passed', 'human_required', 'infrastructure_failure']) {
    const f = fixture(); f.start(f.event, payload); f.rows.get('run-1').run.status = status;
    f.reject(Error('late rejection')); await tick(); assert.equal(f.rows.get('run-1').run.status, status);
    assert.equal(f.calls.some(c => c[0] === 'failure'), false);
  }
});
test('a changed hold between persistence and dispatch retains a visible failure without starting the runner', () => {
  let held = null; const f = fixture({ hold: () => held, publish: snapshot => { held = 'Closing'; return snapshot; } });
  const snapshot = f.start(f.event, payload); assert.equal(snapshot.run.status, 'infrastructure_failure');
  assert.equal(f.calls.some(c => c[0] === 'advance'), false);
});
test('actual main IPC registration uses the scoped native starter and the real billing/quit gate', () => {
  const ts = require('typescript'), source = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8');
  const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  const registrations = tree.statements.filter(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) &&
    n.expression.expression.getText(tree) === 'ipcMain.handle' && n.expression.arguments[0]?.text === 'gauntlet:start');
  assert.equal(registrations.length, 1);
  const registration = ts.transpileModule(registrations[0].getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [closing,platform] of [[false,'darwin'],[true,'darwin'],[false,'win32'],[false,'linux']]) {
    const f = fixture(); let handler;
    const bindings = { ipcMain: { handle(name, fn) { assert.equal(name, 'gauntlet:start'); handler = fn; } }, desktopRunStarter,
      liveWebContents: f.services.localWindow, allowQuit: closing, isolatedGauntletLaunchError, process:{platform},
      gauntlet: f.services.backend, isolatedGauntletRunner: f.services.runner(), publishGauntlet: f.services.publish, console };
    new Function(...Object.keys(bindings), registration)(...Object.values(bindings));
    if(!closing && platform==='darwin') {
      assert.equal(handler(f.event,payload).run.status,'orienting');
      assert.deepEqual(f.calls.map(c=>c[0]),['start','publish','advance']);f.resolve();
    } else {
      assert.throws(() => handler(f.event, payload), closing ? /shutting down/ : /require macOS/);
      assert.equal(f.calls.length, 0);
    }
  }
  assert.doesNotMatch(source, /function (deliverConductorOrientation|spawnPreparedGauntlet)\(/);
});
