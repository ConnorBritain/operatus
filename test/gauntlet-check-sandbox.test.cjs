'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const loadTs = require('./load-ts.cjs');
const { runFrozenChecks } = loadTs('src/main/gauntlet/worktree.ts');
const { prepareCheckSandbox } = loadTs('src/main/gauntlet/checkSandbox.ts');
const mac = { skip: process.platform !== 'darwin' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'operatus-check-boundary-'));
  const workspace = join(root, 'artifact');
  mkdirSync(workspace);
  return { root, workspace, outside: join(root, 'original.txt') };
}
async function check(workspace, command) {
  return (await runFrozenChecks(workspace, [{ id: 'boundary', name: 'boundary', command, timeoutMs: 3000 }]))[0];
}
test('unsupported check platform fails closed', () => {
  assert.throws(() => prepareCheckSandbox('/unused', 'win32'), /unavailable/);
});
test('check allows local artifact evidence with canonical cwd', mac, async () => {
  const {workspace} = fixture();
  writeFileSync(join(workspace, 'evidence.txt'), 'fixture-ok');
  const result = await check(workspace, 'cat evidence.txt; pwd');
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /fixture-ok/);
  assert.ok(result.output.includes(realpathSync(workspace)));
  assert.equal(result.execution.boundary, 'macos-seatbelt-offline-v1');
  assert.match(result.execution.profileSha256, /^[a-f0-9]{64}$/);
});
test('check uses the host Node runtime for real in-worktree JavaScript tests', mac, async () => {
  const {workspace} = fixture();
  writeFileSync(join(workspace, 'sum.test.cjs'), "const test=require('node:test');const assert=require('node:assert/strict');test('sum',()=>assert.equal(2+3,5));");
  const result = await check(workspace, 'node --test sum.test.cjs');
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /pass 1/);
});
test('absolute-path and symlink escapes cannot read or change original checkout', mac, async () => {
  const {workspace, outside} = fixture();
  writeFileSync(outside, 'original-must-survive');
  symlinkSync(outside, join(workspace, 'escape'));
  for (const command of [`cat '${outside}'`, `printf mutation > '${outside}'`, 'cat escape', 'printf mutation > escape']) {
    const result = await check(workspace, command);
    assert.notEqual(result.exitCode, 0, command);
    assert.doesNotMatch(result.output, /original-must-survive/);
  }
  assert.equal(readFileSync(outside, 'utf8'), 'original-must-survive');
});
test('checks neither inherit credentials nor source login shell configuration', mac, async () => {
  const {workspace} = fixture();
  const prior = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'synthetic-not-a-key';
  try {
    const result = await check(workspace, 'test -z "$ANTHROPIC_API_KEY" && test -z "$BASH_ENV" && test -z "$NODE_OPTIONS" && test -z "$CODEX_HOME"');
    assert.equal(result.exitCode, 0, result.output);
    const config = prepareCheckSandbox(workspace);
    assert.ok(config.args('true').includes('--noprofile'));
    assert.ok(config.args('true').includes('--norc'));
  } finally {
    if (prior === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prior;
  }
});
test('checks cannot connect even to a local listening service', mac, async () => {
  const net = require('node:net');
  let connections = 0;
  const server = net.createServer(socket => { connections++; socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const {workspace} = fixture();
    const result = await check(workspace, `/usr/bin/curl --max-time 1 http://127.0.0.1:${server.address().port}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(connections, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
