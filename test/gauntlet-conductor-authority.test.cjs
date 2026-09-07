'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const load = require('./load-ts.cjs');
const { LocalGauntletBackend } = load('src/main/gauntlet/localBackend.ts');
const { GauntletControlServer } = load('src/main/gauntlet/controlServer.ts');
const contract = { objective: 'Scoped lead fixture', criteria: ['Exact artifact'], checks: [], constraints: [], exclusions: [] };

async function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'op-conductor-authority-'));
  const repository = join(root, 'repo'); fs.mkdirSync(repository);
  const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: repository, stdio: 'pipe' });
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(join(repository, 'value.txt'), 'base'); git('add', '.'); git('commit', '-m', 'base');
  const backend = new LocalGauntletBackend({ stateRoot: join(root, 'state'), primitiveRoot: join(__dirname, '../vendor/agent-primitives') });
  backend.open();
  const a = backend.start({ repository, objective: contract.objective }).run;
  const b = backend.start({ repository, objective: 'Independent project' }).run;
  const leadA = backend.prepareConductor(a.id), leadB = backend.prepareConductor(b.id);
  // A leftover legacy secret must not regain control after upgrading.
  fs.mkdirSync(join(root, 'state', 'control'));
  const oldToken = 'old-global-token-that-must-never-work';
  fs.writeFileSync(join(root, 'state', 'control', 'conductor-token'), oldToken);
  const server = new GauntletControlServer(join(root, 'state'), backend, () => {}); await server.start();
  t.after(async () => { await server.stop(); backend.close(); });
  const request = (payload) => new Promise((resolve, reject) => {
    const socket = net.createConnection(server.info().socketPath); let output = '';
    socket.setTimeout(5000, () => socket.destroy(Error('fixture request timed out')));
    socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on('data', data => { output += data; });
    socket.on('error', reject); socket.on('end', () => { try { resolve(JSON.parse(output)); } catch (e) { reject(e); } });
  });
  const freeze = { action: 'freeze', runId: a.id, launchId: leadA.launch.id, token: leadA.token, payload: contract };
  return { root, backend, server, a, b, leadA, leadB, oldToken, request, freeze };
}

test('two concurrent leads have distinct durable identities and cannot control each other', async t => {
  const f = await fixture(t);
  assert.notEqual(f.leadA.launch.id, f.leadB.launch.id);
  assert.notEqual(f.leadA.launch.sessionId, f.leadB.launch.sessionId);
  assert.equal(f.server.info().conductorToken, undefined);
  assert.throws(() => f.backend.prepareConductor(f.a.id), /once/);
  for (const changed of [
    { runId: f.b.id }, { launchId: f.leadB.launch.id }, { token: f.leadB.token },
    { token: f.oldToken }, { launchId: undefined }, { token: 'wrong' }
  ]) {
    assert.equal((await f.request({ ...f.freeze, ...changed })).ok, false);
    assert.equal(f.backend.status(f.a.id).run.status, 'orienting');
    assert.equal(f.backend.status(f.b.id).run.status, 'orienting');
  }
  const result = await f.request(f.freeze);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.run.contract.frozenByLaunchId, f.leadA.launch.id);
  assert.equal(result.snapshot.run.currentLaunchId, null);
  assert.equal(result.snapshot.launches[0].sessionId, f.leadA.launch.sessionId);
  assert.equal(JSON.stringify(result.snapshot).includes(f.leadA.token), false);
  assert.equal(result.snapshot.events[0].event.type, 'CONDUCTOR_PREPARED');
  assert.equal((await f.request(f.freeze)).ok, false);
  assert.equal(f.backend.status(f.a.id).events.length, 2);
});

test('worker token cannot cancel, freeze, acknowledge or escalate, even with the correct lead id', async t => {
  const f = await fixture(t); assert.equal((await f.request(f.freeze)).ok, true);
  const worker = f.backend.prepareImplementer(f.a.id);
  for (const action of ['cancel', 'freeze', 'acknowledge', 'escalate']) {
    const result = await f.request({ ...f.freeze, action, token: worker.token });
    assert.equal(result.ok, false); assert.match(result.error, /Conductor authority/);
  }
  assert.equal(f.backend.status(f.a.id).run.currentLaunchId, worker.launch.id);
  assert.equal(f.backend.status(f.a.id).run.status, 'implementer_in_flight');
});

test('authorized command failures roll back the entire SQLite transition', async t => {
  const f = await fixture(t);
  assert.throws(() => f.backend.withConductorAuthority(f.a.id, f.leadA.launch.id, f.leadA.token, () => {
    f.backend.freeze(f.a.id, contract, f.leadA.launch.id);
    throw Error('fixture crash before commit');
  }), /fixture crash/);
  assert.equal(f.backend.status(f.a.id).run.contract, null);
  assert.equal(f.backend.status(f.a.id).events.length, 1);
  assert.equal((await f.request(f.freeze)).ok, true);
});

test('closing and reopening rejects old credentials before reconciliation and escalates lost lead ownership', async t => {
  const f = await fixture(t); assert.equal((await f.request(f.freeze)).ok, true);
  const worker = f.backend.prepareImplementer(f.a.id);
  f.backend.close(); f.backend.open();
  assert.equal((await f.request({ ...f.freeze, action: 'cancel' })).ok, false);
  const recovered = f.backend.reconcileAfterRestart();
  assert.equal(recovered.length, 2);
  assert.ok(recovered.every(s => s.run.status === 'human_required'));
  const snapshot = f.backend.status(f.a.id);
  assert.match(snapshot.run.stopReason, /Conductor session.*restart/);
  assert.equal(snapshot.launches.find(l => l.id === worker.launch.id).status, 'cancelled');
  assert.equal(fs.existsSync(worker.launch.worktreePath), true);
  assert.equal(snapshot.run.contract.frozenByLaunchId, f.leadA.launch.id);
  assert.equal(snapshot.launches.find(l => l.id === f.leadA.launch.id).sessionId, f.leadA.launch.sessionId);
  assert.deepEqual(f.backend.reconcileAfterRestart(), []);
});

test('lead exit revokes its capability, records escalation once, and leaves the other run usable', async t => {
  const f = await fixture(t);
  const ended = f.backend.releaseConductor(f.a.id, f.leadA.launch.id, 'Native lead exited');
  assert.equal(ended.run.status, 'human_required');
  assert.equal(f.backend.releaseConductor(f.a.id, f.leadA.launch.id, 'duplicate').run.version, ended.run.version);
  assert.equal((await f.request(f.freeze)).ok, false);
  assert.equal((await f.request({ ...f.freeze, runId: f.b.id, launchId: f.leadB.launch.id, token: f.leadB.token })).ok, true);
});

test('Conductor stop decisions retain their actor, and terminal runs reject further commands', async t => {
  const f = await fixture(t);
  for (const [run, lead, action, status] of [[f.a, f.leadA, 'cancel', 'cancelled'], [f.b, f.leadB, 'escalate', 'human_required']]) {
    const command = { ...f.freeze, runId: run.id, launchId: lead.launch.id, token: lead.token, action, payload: { reason: 'Scoped decision' } };
    const result = await f.request(command);
    assert.equal(result.ok, true); assert.equal(result.snapshot.run.status, status);
    assert.equal(result.snapshot.events.at(-1).event.conductorLaunchId, lead.launch.id);
    assert.equal((await f.request(command)).ok, false);
  }
});
