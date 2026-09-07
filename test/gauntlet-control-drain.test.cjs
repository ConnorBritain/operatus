'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const load = require('./load-ts.cjs');
const { GauntletControlServer } = load('src/main/gauntlet/controlServer.ts');
const { LocalGauntletBackend } = load('src/main/gauntlet/localBackend.ts');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'condition timed out'); await sleep(10); }
}
async function fixture(backend, observer = () => {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'op-drain-'));
  const server = new GauntletControlServer(root, backend, observer);
  return { root, server, endpoint: await server.start() };
}
async function connect(path) {
  const socket = net.createConnection(path);
  socket.on('error', () => {});
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  return socket;
}
const complete = { action: 'complete', runId: 'run', launchId: 'launch', token: 'scoped', payload: { sha: 'a'.repeat(40) } };

test('long profile paths use private short endpoints and repeated starts leave peers reachable', { skip: process.platform === 'win32' }, async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'op-long-'));
  const profile = join(root, 'long-profile-'.repeat(16));
  const first = new GauntletControlServer(profile, {}, () => {});
  const second = new GauntletControlServer(profile, {}, () => {});
  try {
    const one = await first.start(), two = await second.start();
    assert.ok(Buffer.byteLength(one.socketPath) <= 100);
    assert.notEqual(one.socketPath, two.socketPath);
    assert.equal(fs.statSync(require('node:path').dirname(one.socketPath)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(one.socketPath).mode & 0o777, 0o600);
    const a = await connect(one.socketPath), b = await connect(two.socketPath);
    a.destroy(); b.destroy();
    await first.stop();
    assert.equal(fs.existsSync(require('node:path').dirname(one.socketPath)), false);
    const peer = await connect(two.socketPath); peer.destroy();
    const third = new GauntletControlServer(profile, {}, () => {});
    try {
      const three = await third.start();
      const restarted = await connect(three.socketPath); restarted.destroy();
      assert.notEqual(three.socketPath, one.socketPath);
    } finally { await third.stop(); }
  } finally { await first.stop(); await second.stop(); }
});

test('one socket dispatches only one command while completion is pending', async () => {
  let calls = 0, release;
  const f = await fixture({ completeArtifact: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const socket = await connect(f.endpoint.socketPath);
  let output = ''; socket.on('data', chunk => { output += chunk; });
  try {
    socket.write(JSON.stringify(complete) + '\n'); await until(() => calls === 1);
    socket.write(JSON.stringify(complete) + '\n'); await sleep(30);
    assert.equal(calls, 1);
    release({ run: { id: 'run' } }); await until(() => output.includes('\n'));
    assert.equal(JSON.parse(output).ok, true);
  } finally { socket.destroy(); await f.server.stop(); }
});
test('stop closes idle and partial-request clients, is single-flight and rejects restart', async () => {
  const f = await fixture({}); const socket = await connect(f.endpoint.socketPath);
  socket.write('{"action":');
  const first = f.server.stop(); assert.equal(f.server.stop(), first);
  assert.deepEqual(await first, { drained: true, pending: 0 });
  await until(() => socket.destroyed);
  await assert.rejects(f.server.start(), /stopping/);
  await assert.rejects(connect(f.endpoint.socketPath));
});
test('stop aborts pending completion and suppresses transition observers after shutdown', async () => {
  let signal, observed = 0;
  const f = await fixture({ completeArtifact: (_input, abort) => {
    signal = abort; return new Promise((resolve, reject) => abort.addEventListener('abort', () => reject(abort.reason), { once: true }));
  } }, () => { observed++; });
  const socket = await connect(f.endpoint.socketPath);
  socket.write(JSON.stringify(complete) + '\n'); await until(() => signal);
  assert.deepEqual(await f.server.stop(), { drained: true, pending: 0 });
  assert.equal(signal.aborted, true); assert.equal(observed, 0);
});
test('a non-cooperative operation returns an explicit undrained deadline, never false success', async () => {
  let release, observed = 0;
  const f = await fixture({ completeArtifact: () => new Promise(resolve => { release = resolve; }) }, () => { observed++; });
  const socket = await connect(f.endpoint.socketPath);
  socket.write(JSON.stringify(complete) + '\n'); await until(() => release);
  assert.deepEqual(await f.server.stop(20), { drained: false, pending: 1 });
  release({ run: { id: 'run' } }); await sleep(20);
  assert.equal(observed, 0);
});
test('socket shutdown kills an actual offline frozen check without recording an artifact', { skip: process.platform !== 'darwin', timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'op-drain-git-'));
  const repository = join(root, 'repo'); fs.mkdirSync(repository);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(repository, 'init', '-b', 'main'); git(repository, 'config', 'user.name', 'Fixture'); git(repository, 'config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(join(repository, 'README.md'), 'base'); git(repository, 'add', '.'); git(repository, 'commit', '-m', 'base');
  const input = { stateRoot: join(root, 'state'), primitiveRoot: join(__dirname, '../vendor/agent-primitives') };
  const backend = new LocalGauntletBackend(input); backend.open();
  const run = backend.start({ repository, objective: 'Check shutdown fixture' }).run;
  backend.freeze(run.id, { objective: run.requestedObjective, criteria: ['Test interrupted completion'], checks: [
    { id: 'long', name: 'long', command: 'node holding.cjs', timeoutMs: 10000 }
  ], constraints: [], exclusions: [] });
  const worker = backend.prepareImplementer(run.id), cwd = worker.launch.worktreePath;
  fs.writeFileSync(join(cwd, 'holding.cjs'), "require('fs').writeFileSync('check-pid.txt',String(process.pid));setInterval(()=>{},1000);");
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'candidate');
  const server = new GauntletControlServer(input.stateRoot, backend, () => { throw Error('aborted completion must not publish'); });
  const endpoint = await server.start(); const socket = await connect(endpoint.socketPath);
  try {
    socket.write(JSON.stringify({ action: 'complete', runId: run.id, launchId: worker.launch.id, token: worker.token,
      payload: { sha: git(cwd, 'rev-parse', 'HEAD') } }) + '\n');
    await until(() => fs.existsSync(join(cwd, 'check-pid.txt')));
    const pid = Number(fs.readFileSync(join(cwd, 'check-pid.txt'), 'utf8'));
    assert.deepEqual(await server.stop(), { drained: true, pending: 0 });
    await until(() => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
    assert.equal(backend.status(run.id).artifacts.length, 0);
    assert.equal(backend.status(run.id).run.status, 'implementer_in_flight');
    assert.ok(fs.existsSync(cwd), 'interrupted worktree retained');
  } finally { socket.destroy(); await server.stop(); backend.close(); }
  const reopened = new LocalGauntletBackend(input); reopened.open();
  try {
    const recovered = reopened.reconcileAfterRestart().find(value => value.run.id === run.id);
    assert.equal(recovered.run.status, 'awaiting_implementation');
    assert.equal(recovered.artifacts.length, 0);
    assert.equal(recovered.launches[0].status, 'failed');
  } finally { reopened.close(); }
});
