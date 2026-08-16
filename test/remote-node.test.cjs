'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { OperatusRemoteNode, validatePortalUrl } = loadTs('src/main/remoteNode.ts');

const SHA = 'a'.repeat(40);

function snapshot(overrides = {}) {
  return {
    run: {
      id: 'run-remote-1', backend: 'local', repository: '/Users/private/Code/secret-repo',
      requestedObjective: 'private objective', branch: 'operatus/gauntlet/run-remote-1',
      baseSha: SHA, currentArtifactSha: SHA, currentLaunchId: null,
      currentCriticReportId: null, contract: null, status: 'awaiting_critic',
      repairRound: 0, infrastructureRetries: 0,
      providers: {
        conductor: { provider: 'claude' }, implementer: { provider: 'claude' },
        critic: { provider: 'codex' }, repairer: { provider: 'claude' }
      },
      limits: {
        maxRepairRounds: 3, maxInfrastructureRetries: 1,
        workerTimeoutMs: 1, criticTimeoutMs: 1, runTimeoutMs: 1
      },
      stopReason: null, version: 4, createdAt: 100, updatedAt: 200,
      ...overrides
    },
    artifacts: [], launches: [], reports: [], acknowledgments: [], repairPackets: [], events: []
  };
}

test('portal origins fail closed to HTTPS except explicit localhost development', () => {
  assert.equal(validatePortalUrl('https://operatus.example/path'), 'https://operatus.example');
  assert.equal(validatePortalUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.throws(() => validatePortalUrl('http://operatus.example'), /must use HTTPS/);
  assert.throws(() => validatePortalUrl('https://user:pass@operatus.example'), /only the portal origin/);
});

test('sync redacts local paths and executes only an exact-version bounded command', async () => {
  let cfg = { enabled: true, portalUrl: 'https://operatus.example', nodeId: 'node-1', nodeName: 'Studio Mac' };
  let current = snapshot();
  let syncBody;
  let acknowledgment;
  let cancelCount = 0;
  const fakeFetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/api/node/sync') {
      syncBody = JSON.parse(init.body);
      return Response.json({ acceptedAt: new Date().toISOString(), repositories: 1, runs: 1 });
    }
    if (path === '/api/node/commands') {
      return Response.json({ commands: [{
        id: 'command-1', operation: 'cancel_run', payload: {}, localRunId: current.run.id,
        expected_run_version: current.run.version,
        expires_at: new Date(Date.now() + 60_000).toISOString()
      }] });
    }
    if (path === '/api/node/commands/ack') {
      acknowledgment = JSON.parse(init.body);
      return Response.json({ acknowledgedAt: new Date().toISOString() });
    }
    throw new Error(`unexpected request: ${path}`);
  };
  const node = new OperatusRemoteNode({
    appVersion: () => '0.1.0', readConfig: () => cfg,
    writeConfig: (next) => { cfg = next; }, getToken: () => 'atn_secret',
    setToken: () => ({ ok: true }), deleteToken: () => {}, snapshots: () => [current],
    cancelRun: () => {
      cancelCount += 1;
      current = snapshot({ status: 'cancelled', version: 5, stopReason: 'remote cancel' });
      return current;
    },
    messageConductor: () => {}, fetch: fakeFetch
  });

  const status = await node.syncNow();
  assert.equal(status.state, 'online');
  assert.equal(cancelCount, 1);
  assert.equal(syncBody.repositories[0].displayName, 'secret-repo');
  assert.equal(syncBody.runs[0].snapshot.run.repositoryLabel, 'secret-repo');
  assert.equal(JSON.stringify(syncBody).includes('/Users/private'), false);
  assert.equal(JSON.stringify(syncBody).includes('private objective'), false);
  assert.deepEqual(acknowledgment, {
    commandId: 'command-1', status: 'accepted',
    acknowledgment: { runVersion: 5, status: 'cancelled' }
  });
});

test('stale remote commands are rejected without touching local authority', async () => {
  const current = snapshot();
  let acknowledgment;
  let cancelCount = 0;
  const node = new OperatusRemoteNode({
    appVersion: () => '0.1.0',
    readConfig: () => ({ enabled: true, portalUrl: 'https://operatus.example', nodeId: 'node-1' }),
    writeConfig: () => {}, getToken: () => 'atn_secret', setToken: () => ({ ok: true }),
    deleteToken: () => {}, snapshots: () => [current],
    cancelRun: () => { cancelCount += 1; return current; }, messageConductor: () => {},
    fetch: async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/node/sync') return Response.json({ ok: true });
      if (path === '/api/node/commands') return Response.json({ commands: [{
        id: 'command-stale', operation: 'cancel_run', payload: {}, localRunId: current.run.id,
        expected_run_version: current.run.version - 1,
        expires_at: new Date(Date.now() + 60_000).toISOString()
      }] });
      acknowledgment = JSON.parse(init.body);
      return Response.json({ ok: true });
    }
  });

  await node.syncNow();
  assert.equal(cancelCount, 0);
  assert.equal(acknowledgment.status, 'rejected');
  assert.equal(acknowledgment.acknowledgment.reason, 'stale_run_version');
});
