'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const { selectionAfterArrival, focusAfterRosterChange } = load('src/renderer/src/store/agentViewPolicy.ts');
const lead = { id: 'lead', ptyId: 'lead-pty', isGod: true };
const worker = { id: 'worker', ptyId: 'worker-pty' };
const synthetic = { id: 'synthetic' };

test('background arrivals preserve a valid selection; explicit arrival and empty floor resolve deliberately', () => {
  const agents = [lead, worker];
  assert.equal(selectionAfterArrival('lead', agents, 'worker'), 'lead');
  assert.equal(selectionAfterArrival('lead', agents, 'worker', true), 'worker');
  assert.equal(selectionAfterArrival(null, agents, 'worker'), 'worker');
  assert.equal(selectionAfterArrival('stale', agents, 'worker'), 'worker');
  assert.equal(selectionAfterArrival('lead', agents, 'missing', true), 'lead');
  assert.equal(selectionAfterArrival(null, [], 'missing'), null);
});

test('focus re-homes only to terminal-bearing survivors, without reviving an exited view', () => {
  assert.equal(focusAfterRosterChange('worker', [lead, worker], 'lead'), 'worker');
  assert.equal(focusAfterRosterChange('gone', [lead, worker], 'worker'), 'worker');
  assert.equal(focusAfterRosterChange('gone', [synthetic, worker, lead], 'synthetic'), 'lead');
  assert.equal(focusAfterRosterChange('gone', [synthetic, worker], 'synthetic'), 'worker');
  assert.equal(focusAfterRosterChange('gone', [synthetic, { ...worker, archived: true }], 'worker'), null);
  assert.equal(focusAfterRosterChange(null, [lead, worker], 'worker'), null);
  assert.equal(focusAfterRosterChange('worker', [{ ...worker, ptyId: undefined }], 'worker'), null);
});

test('actual store preserves selection and durable mirror through arrivals, duplicate hire race and removal', () => {
  const prior = global.window, values = new Map(), listeners = new Map(), writes = [];
  global.window = {
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    addEventListener: (name, cb) => listeners.set(name, cb),
    cth: { rosterBootSync: () => ({home:'/fixture/home',roster:null}), rosterWrite: snapshot => writes.push(structuredClone(snapshot)) }
  };
  try {
    const { useStore } = load('src/renderer/src/store/store.ts');
    const agent = a => ({ name: a.id, character: 'jim', accent: 'sky', description: 'fixture',
      project: 'fixture', cwd: '/fixture', status: 'idle', action: 'fixture', progress: 0, tmuxTarget: '', ...a });
    useStore.setState({ agents: [], selectedId: null, fullscreenAgentId: null, archivedAgents: [], restorableAgents: [], feeds: {}, messageQueues: {} });
    const state = () => useStore.getState();
    state().addAgent(agent(lead));
    state().setFullscreen('lead');
    state().addAgent(agent(worker));
    assert.equal(state().selectedId, 'lead');
    assert.equal(state().fullscreenAgentId, 'lead');
    state().addAgent(agent({ ...worker, name: 'must not overwrite first record' }), { select: true });
    assert.equal(state().selectedId, 'worker');
    assert.equal(state().agents.length, 2);
    assert.equal(state().agents[1].name, 'worker');
    state().addAgent(agent(lead)); // duplicate background event cannot steal selection
    assert.equal(state().selectedId, 'worker');
    listeners.get('beforeunload')();
    assert.equal(JSON.parse(values.get('operatus.roster.v1:%2Ffixture%2Fhome')).roster.selectedId, 'worker');
    assert.equal(values.get('cth.selectedId'), undefined);
    assert.equal(writes.at(-1).selectedId, 'worker');
    state().setFullscreen('worker');
    state().archiveAgent('worker');
    assert.equal(state().fullscreenAgentId, 'lead');
    assert.equal(state().selectedId, 'lead');
    state().addAgent(agent(worker));
    state().setFullscreen('worker');
    state().removeAgent('worker');
    assert.equal(state().fullscreenAgentId, 'lead');
    state().setFullscreen(null);
    state().addAgent(agent(worker));
    state().removeAgent('worker');
    assert.equal(state().fullscreenAgentId, null);
    state().setFullscreen('missing');
    assert.equal(state().fullscreenAgentId, null);
    state().setFullscreen('lead');
    state().updateAgent('lead', { ptyId: undefined });
    assert.equal(state().fullscreenAgentId, null);
    state().setFullscreen('lead');
    assert.equal(state().fullscreenAgentId, null, 'synthetic card cannot enter a terminal view');
    state().addAgent(agent({ ...worker, lifecycleOwner: 'gauntlet', gauntletRunId: 'fixture-run' }));
    state().setFullscreen('worker');
    state().reconcileWithLivePtys([]);
    assert.equal(state().fullscreenAgentId, null);
    assert.ok(!state().restorableAgents.some(a => a.id === 'worker'), 'focus policy must preserve managed-launch exclusion');
    assert.ok(state().archivedAgents.some(a => a.id === 'worker'));
    listeners.get('beforeunload')();
    assert.equal(writes.at(-1).selectedId, state().selectedId);
  } finally {
    listeners.get('beforeunload')?.();
    global.window = prior;
  }
});
