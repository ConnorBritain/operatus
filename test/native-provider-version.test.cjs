'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, existsSync, symlinkSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const { createServer } = require('node:net');
const load = require('./load-ts.cjs');
const { inspectNativeProviderVersion, parseProviderVersion } = load('src/main/nativeProviderVersion.ts');
const { hashExecutable } = load('src/main/executableIdentity.ts');
const macOnly = { skip: process.platform !== 'darwin' };

test('version parser returns only exact provider-version shapes, never arbitrary CLI output', () => {
  assert.equal(parseProviderVersion('claude', '2.1.263 (Claude Code)\n'), '2.1.263');
  assert.equal(parseProviderVersion('codex', 'codex-cli 0.115.0-alpha.2\n'), '0.115.0-alpha.2');
  for (const value of ['fake-secret', '2.1.263 (Claude Code)\ncredential', 'codex-cli garbage']) {
    assert.equal(parseProviderVersion('claude', value), undefined);
    assert.equal(parseProviderVersion('codex', value), undefined);
  }
});

test('unsupported platforms never probe or fall back to unsandboxed execution', async () => {
  assert.deepEqual(await inspectNativeProviderVersion('claude', '/not/read', 'a'.repeat(64), 'win32'), { status: 'unsupported-platform' });
  assert.deepEqual(await inspectNativeProviderVersion('codex', '/not/read', 'a'.repeat(64), 'linux'), { status: 'unsupported-platform' });
});

test('scripts and symlinked entrypoints are not executed', macOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'operatus-version-script-'));
  const path = join(dir, 'claude'), marker = join(dir, 'executed');
  writeFileSync(path, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
  assert.deepEqual(await inspectNativeProviderVersion('claude', path, await hashExecutable(path)), { status: 'unsupported-entrypoint' });
  symlinkSync(path, join(dir, 'alias'));
  assert.deepEqual(await inspectNativeProviderVersion('claude', join(dir, 'alias'), await hashExecutable(path)), { status: 'unavailable' });
  assert.equal(existsSync(marker), false);
});

test('changed native bytes cannot produce a version receipt', macOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'operatus-version-change-'));
  const path = join(dir, 'native');
  writeFileSync(path, Buffer.from('cffaedfe00000000', 'hex'));
  assert.deepEqual(await inspectNativeProviderVersion('claude', path, '0'.repeat(64)), { status: 'identity-changed' });
});

test('real native probe receives only --version and cannot read an outside file, inherited keys or loopback network', macOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'operatus-native-probe-test-'));
  const secret = join(dir, 'outside-profile'), binary = join(dir, 'provider');
  writeFileSync(secret, 'synthetic-only-not-a-credential');
  let connections = 0;
  const server = createServer(socket => { connections++; socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.ANTHROPIC_API_KEY;
  try {
    execFileSync('/usr/bin/clang', [join(__dirname, 'fixtures/native-provider-version.c'), '-o', binary,
      `-DPROTECTED_PATH=${JSON.stringify(secret)}`, `-DPROBE_PORT=${server.address().port}`]);
    process.env.ANTHROPIC_API_KEY = 'synthetic-should-not-be-inherited';
    const digest = await hashExecutable(binary);
    assert.deepEqual(await inspectNativeProviderVersion('claude', binary, digest), { status: 'reported', version: '2.1.263' });
    assert.equal(await hashExecutable(binary), digest, 'source installation unchanged');
    assert.equal(connections, 0);
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
    await new Promise(resolve => server.close(resolve));
  }
});
