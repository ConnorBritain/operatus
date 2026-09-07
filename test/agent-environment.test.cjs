'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const load = require('./load-ts.cjs');
const policy = load('src/shared/billingPolicy.ts');

test('ambient environment is allowlisted, not guessed from secret-looking names', () => {
  const input = { HOME: '/private/home', PATH: '/usr/bin', LANG: 'en_US.UTF-8',
    SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    PIGEON: 'unrecognizable-credential', CUSTOM_SETTINGS: 'opaque-provider-config',
    SSH_AUTH_SOCK: '/agent.sock', NODE_OPTIONS: '--require injected',
    ANTHROPIC_API_KEY: 'synthetic', CLAUDE_CONFIG_DIR: '/ambient', CODEX_HOME: '/ambient',
    HTTPS_PROXY: 'https://proxy.invalid', HIVE_ROOT: '/ambient/hive', AGENT_ID: 'old-agent' };
  assert.deepEqual(policy.minimalHostEnvironment(input), {
    HOME: '/private/home', PATH: '/usr/bin', LANG: 'en_US.UTF-8',
    SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe'
  });
  assert.equal(input.PIGEON, 'unrecognizable-credential');
  const child = policy.withoutInferenceCredentials({ ...policy.minimalHostEnvironment(input),
    HIVE_ROOT: '/explicit/hive', AGENT_ID: 'fresh-agent', ANTHROPIC_API_KEY: 'injected-late' });
  assert.equal(child.HIVE_ROOT, '/explicit/hive');
  assert.equal(child.AGENT_ID, 'fresh-agent');
  assert.equal(child.ANTHROPIC_API_KEY, undefined);
});

test('actual visible and hidden PTY wiring excludes unknown ambient variables and scrubs final overrides', async () => {
  const originalLoad = Module._load, originalHold = policy.subscriptionLaunchError;
  const poisonKey = 'OPERATUS_TEST_OPAQUE_PAYLOAD';
  const originalPoison = process.env[poisonKey];
  const calls = [];
  // Only a fake node-pty primitive is admitted in this test process. Production
  // policy is unchanged, and no subprocess, CLI, credential or network is used.
  Module._load = function(request, ...args) {
    if (request === 'node-pty') return { spawn(file, argv, options) {
      calls.push({ file, argv, options }); throw Error('captured fake PTY boundary');
    } };
    return originalLoad.call(this, request, ...args);
  };
  process.env[poisonKey] = 'must-not-inherit';
  policy.subscriptionLaunchError = () => null;
  try {
    const { PtyManager } = load('src/main/pty.ts');
    const { runHiddenClaude } = load('src/main/hiddenClaude.ts');
    const env = { AGENT_ID: 'explicit-agent', ANTHROPIC_API_KEY: 'synthetic', NODE_OPTIONS: '--require forbidden' };
    const result = new PtyManager().spawn({ id: 'fake-boundary', cwd: __dirname, command: '/usr/bin/true', env });
    assert.equal(result.ok, false);
    const hidden = await runHiddenClaude('Never sent', { cwd: __dirname, command: '/usr/bin/true', model: 'test-only', env });
    assert.equal(hidden.ok, false);
    assert.equal(calls.length, 2);
    for (const { options } of calls) {
      assert.equal(options.env[poisonKey], undefined);
      assert.equal(options.env.ANTHROPIC_API_KEY, undefined);
      assert.equal(options.env.NODE_OPTIONS, undefined);
      assert.equal(options.env.AGENT_ID, 'explicit-agent');
      assert.ok(options.env.PATH);
    }
  } finally {
    policy.subscriptionLaunchError = originalHold;
    Module._load = originalLoad;
    if (originalPoison === undefined) delete process.env[poisonKey]; else process.env[poisonKey] = originalPoison;
  }
  assert.ok(policy.subscriptionLaunchError(), 'production hold restored');
});
