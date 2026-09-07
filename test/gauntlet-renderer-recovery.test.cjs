'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('actual renderer store archives dead Gauntlet workers, retains live ones, restores ordinary workers', () => {
  const previous = global.window;
  const storage = new Map();
  const agent = (id, extra = {}) => ({ id, name: id, description: 'worker', cwd: '/fixture',
    character: 'operator', accent: 'coral', project: 'fixture', ptyId: id, ...extra });
  global.window = { addEventListener() {}, localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)
  }, cth: {
    rosterBootSync: () => ({home:'/fixture/home',roster:{ version: 1, savedAt: '', agents: [
      agent('live', { lifecycleOwner: 'gauntlet' }), agent('dead', { lifecycleOwner: 'gauntlet' }), agent('ordinary')
    ], archived: [], restorable: [agent('old', { description: 'Gauntlet repairer', note: 'preserve me' })], queues: {}, selectedId: 'dead' }}),
    rosterWrite: async () => ({ ok: true })
  } };
  try {
    const { useStore } = require('./load-ts.cjs')('src/renderer/src/store/store.ts');
    assert.equal(useStore.getState().restorableAgents.length, 0);
    assert.equal(useStore.getState().archivedAgents.find(a => a.id === 'old').note, 'preserve me');
    useStore.getState().reconcileWithLivePtys(['live']);
    const state = useStore.getState();
    assert.deepEqual(state.agents.map(a => a.id), ['live']);
    assert.deepEqual(state.restorableAgents.map(a => a.id), ['ordinary']);
    assert.deepEqual(state.archivedAgents.map(a => a.id), ['old', 'dead']);
    assert.equal(state.archivedAgents.find(a => a.id === 'dead').ptyId, undefined);
    assert.equal(state.selectedId, 'live');
    assert.deepEqual(JSON.parse(storage.get('operatus.roster.v1:%2Ffixture%2Fhome')).roster.restorable.map(a => a.id), ['ordinary']);
    assert.equal(storage.get('cth.restorableAgents'),undefined);
  } finally { global.window = previous; }
});
