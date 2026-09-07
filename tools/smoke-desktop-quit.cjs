'use strict';
// Manual real desktop smoke. No debugger, provider sessions, user profile,
// installation, or protocol association changes. Run after npm run build.
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const repo = resolve(__dirname, '..');
const load = require('../test/load-ts.cjs');
if (!load('src/shared/billingPolicy.ts').subscriptionLaunchError()) throw Error('Requires production launch hold');
const binary = require('electron');
async function smoke(mode, initialized) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'operatus-quit-smoke-')));
  const env = { ...process.env, OPERATUS_QUIT_FIXTURE_ROOT: root,
    OPERATUS_QUIT_FIXTURE_MODE: mode, OPERATUS_QUIT_FIXTURE_INITIALIZED: initialized ? '1' : '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  let stdout = '', stderr = '', timedOut = false;
  const child = spawn(binary, [join(repo, 'test/fixtures/desktop-quit.cjs')], {
    cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  // Only this smoke's child is killed if the native quit regression returns.
  const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 20000);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(deadline));
  fs.writeFileSync(join(root, 'stdout.log'), stdout);
  fs.writeFileSync(join(root, 'stderr.log'), stderr);
  const events = stdout.split('\n').filter(line => line.startsWith('QUIT_SMOKE '))
    .map(line => JSON.parse(line.slice('QUIT_SMOKE '.length)));
  const receipt = { root, mode, initialized, pid: child.pid, ...result, timedOut, events };
  fs.writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
  assert.equal(timedOut, false, `Quit hung; evidence: ${root}`);
  assert.equal(result.code, 0, stderr);
  assert.equal(events.find(event => event.kind === 'ready')?.ptyCount, 0);
  assert.ok(events.some(event => event.kind === 'will-quit' && event.prevented));
  assert.ok(events.some(event => event.kind === 'will-quit' && !event.prevented));
  assert.ok(events.some(event => event.kind === 'process-exit' && event.exitCode === 0));
  if (initialized) {
    assert.ok(events.some(event => event.kind === 'control-client-connected'));
    assert.ok(events.some(event => event.kind === 'control-client-closed'));
  }
  assert.ok(!events.some(event => event.kind === 'error' || event.kind === 'still-alive'));
}
(async () => {
  for (const initialized of [false, true]) {
    for (const mode of ['app-quit', 'confirmed']) await smoke(mode, initialized);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
