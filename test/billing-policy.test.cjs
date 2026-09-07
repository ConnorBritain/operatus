'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const policy = loadTs('src/shared/billingPolicy.ts');

test('legacy launches and API inference stay blocked while the isolated Mac runner can perform admission', () => {
  assert.equal(policy.BILLING_POLICY, 'subscriptions-only');
  for (const provider of [undefined, 'claude', 'codex', 'custom', 'grok', 'openai']) {
    assert.equal(typeof policy.subscriptionLaunchError(provider), 'string');
    assert.ok(policy.subscriptionLaunchError(provider).length > 0);
  }
  assert.ok(policy.apiInferenceError());
  assert.equal(policy.isolatedGauntletLaunchError('darwin'),null);
  for(const platform of ['win32','linux','unknown']) assert.match(policy.isolatedGauntletLaunchError(platform),/require macOS/);
});

test('credential scrubber handles casing, gateways, shell injection and final-merge overrides', () => {
  const original = {
    PATH: '/usr/bin', HOME: '/test', TERM: 'xterm', HIVE_ROOT: '/hive', AGENT_ID: 'a',
    ANTHROPIC_API_KEY: 'never-print-this', openai_api_key: 'never-print-this',
    ANTHROPIC_AUTH_TOKEN: 'x', CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'paid',
    CODEX_HOME: '/unreviewed', OPENAI_BASE_URL: 'https://gateway.invalid',
    GROQ_API_KEY: 'x', SOME_APIKEY: 'x', NODE_OPTIONS: '--require bad.js',
    NODE_PATH: '/injected', BASH_ENV: '/rc', HTTPS_PROXY: 'https://proxy.invalid',
    DYLD_INSERT_LIBRARIES: '/injected', OPTIONAL: undefined
  };
  assert.deepEqual(policy.withoutInferenceCredentials(original), {
    PATH: '/usr/bin', HOME: '/test', TERM: 'xterm', HIVE_ROOT: '/hive', AGENT_ID: 'a'
  });
  assert.equal(original.ANTHROPIC_API_KEY, 'never-print-this'); // no global/user mutation
});

test('API chat and transcription deny before network, even with a valid-looking key', async () => {
  const { groqChat } = loadTs('src/main/groq.ts');
  const { transcribeWithGroq } = loadTs('src/main/freeflow.ts');
  const previous = global.fetch;
  let requests = 0;
  global.fetch = async () => { requests++; throw new Error('must not reach network'); };
  try {
    const chat = await groqChat({ apiKey: 'synthetic-key', messages: [{ role: 'user', content: 'hello' }] });
    const audio = await transcribeWithGroq({ apiKey: 'synthetic-key', audio: new Uint8Array([1,2]) });
    assert.deepEqual(chat, { ok: false, error: policy.API_INFERENCE_ERROR });
    assert.deepEqual(audio, { ok: false, error: policy.API_INFERENCE_ERROR });
    assert.equal(requests, 0);
  } finally { global.fetch = previous; }
});

test('visible and hidden PTYs refuse before executable discovery or process creation', async () => {
  const Module = require('node:module');
  const original = Module._load;
  let spawns = 0;
  Module._load = function(request, ...args) {
    if (request === 'node-pty') return { spawn() { spawns++; throw new Error('unexpected spawn'); } };
    return original.call(this, request, ...args);
  };
  try {
    const { PtyManager } = loadTs('src/main/pty.ts');
    const { runHiddenClaude } = loadTs('src/main/hiddenClaude.ts');
    const manager = new PtyManager();
    manager.resolveCommand = () => { throw new Error('must not resolve unverified command'); };
    const visible = manager.spawn({ id: 'safety-test', cwd: '/not-real', command: 'claude', env: { ANTHROPIC_API_KEY: 'synthetic' } });
    const hidden = await runHiddenClaude('hello', { cwd: '/not-real', model: 'unverified' });
    assert.deepEqual(visible, { ok: false, error: policy.SUBSCRIPTION_LAUNCH_HOLD });
    assert.deepEqual(hidden, { ok: false, error: policy.SUBSCRIPTION_LAUNCH_HOLD });
    assert.equal(spawns, 0);
  } finally { Module._load = original; }
});

test('secondary entrypoints retain a billing guard before credentials or execution', () => {
  // Wiring regression checks supplement behavioral boundary tests above.
  const root = path.resolve(__dirname, '..');
  for (const [file, start, guard, effect] of [
    ['src/main/realtime.ts', 'export async function mintRealtimeToken', 'apiInferenceError()', 'getSecret('],
    ['src/main/index.ts', 'async function spawnAgentCore', 'subscriptionLaunchError(', 'opts.cwd ='],
    ['src/main/index.ts', "ipcMain.handle('integrations:test'", 'apiInferenceError()', 'getSecret('],
    ['src/main/hive.ts', 'private startProxyBridge(', 'apiInferenceError()', 'this.stopProxyBridge('],
    ['src/main/memory.ts', 'private runCli(', 'subscriptionLaunchError()', 'this.bin('],
    ['src/main/integrationBroker.ts', 'private handle(', 'apiInferenceError()', 'this.resolveCapability(']
  ]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const section = text.slice(text.indexOf(start));
    assert.ok(text.includes(start), `${file}: entrypoint exists`);
    assert.ok(section.indexOf(guard) >= 0 && section.indexOf(guard) < section.indexOf(effect), `${file}: guard precedes effect`);
  }
});

test('ambient movement stays off; only directed state changes should move workers', () => {
  assert.equal(loadTs('src/shared/officeMotion.ts').ambientOfficeMotionEnabled(), false);
});

test('realtime voice cannot mint a token or advertise an API key', async () => {
  const { hasOpenAiKey, mintRealtimeToken } = loadTs('src/main/realtime.ts');
  const previous = global.fetch;
  let requests = 0;
  global.fetch = async () => { requests++; throw new Error('must not reach network'); };
  try {
    assert.equal(hasOpenAiKey(), false);
    assert.deepEqual(await mintRealtimeToken(), {
      ok: false, error: policy.API_INFERENCE_ERROR, code: 'subscriptions_only'
    });
    assert.equal(requests, 0);
  } finally { global.fetch = previous; }
});

test('credentialed broker rejects over loopback before looking up secrets or forwarding', async () => {
  const { IntegrationBroker } = loadTs('src/main/integrationBroker.ts');
  const broker = new IntegrationBroker({
    getRecord() { throw new Error('must not look up a credentialed route'); },
    getSecret() { throw new Error('must not decrypt a key'); }
  });
  const previous = global.fetch;
  let requests = 0;
  global.fetch = async () => { requests++; throw new Error('must not forward'); };
  try {
    const started = await broker.start();
    assert.equal(started.ok, true);
    const result = await new Promise((resolve, reject) => {
      require('node:http').get(`http://127.0.0.1:${started.port}/integrations/paid/test`, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });
    assert.equal(result.status, 403);
    assert.match(result.body, /subscriptions_only/);
    assert.equal(requests, 0);
  } finally { broker.stop(); global.fetch = previous; }
});
