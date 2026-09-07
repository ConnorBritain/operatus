'use strict';
// Copy completed, synthetic-provider native evidence into a disposable desktop
// profile. Never opens the user's application profile or launches a provider.
const fs = require('node:fs'), { join, basename } = require('node:path'), { tmpdir } = require('node:os');
const Database = require('better-sqlite3');
async function main() {
  const source = fs.realpathSync(process.argv[2]);
  if (!basename(source).startsWith('op-native-runner-')) throw Error('Native fixture root required');
  const receipt = JSON.parse(fs.readFileSync(join(source, 'receipt.json'), 'utf8'));
  if (receipt.realInference !== false || receipt.snapshot.run.status !== 'passed' || receipt.snapshot.runtimeObservations?.filter(r=>r.event.type!=='tool_activity'&&r.event.type!=='subscription_admission').length !== 16) throw Error('Completed native runtime evidence required');
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'operatus-run-control-'))), profile = join(root, 'profile'), home = join(root, 'harness');
  fs.mkdirSync(profile); fs.mkdirSync(home);
  const db = new Database(join(source, 'state', 'gauntlet.db'), { readonly: true });
  try { await db.backup(join(profile, 'gauntlet.db')); } finally { db.close(); }
  const repositories = [receipt.snapshot.run.repository];
  fs.writeFileSync(join(profile, 'config.json'), JSON.stringify({ onboardingComplete: true, harnessHome: home, recentHives: [home], registeredRepos: repositories,
    missions: [], opsStandupSeeded: true, heartbeatSeeded: true, semanticMemory: false, reflectEnabled: false, notifications: false,
    telemetryEnabled: false, autoUpdate: false, freeflowEnabled: false, realtimeVoiceEnabled: false }));
  const output = { root, profile, home, repositories, ids: { native: receipt.snapshot.run.id }, source, kind: 'native-runtime-evidence-with-synthetic-provider' };
  fs.writeFileSync(join(root, 'receipt.json'), JSON.stringify(output, null, 2)); console.log(JSON.stringify(output));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
