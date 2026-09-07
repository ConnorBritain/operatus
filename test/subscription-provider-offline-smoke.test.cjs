'use strict';
// Opt-in genuine CLI tests. No inference, real credentials, or network access.
// Exact executable digests are required; no PATH resolution or auto-updates.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, copyFileSync, chmodSync, writeFileSync, mkdirSync, existsSync, realpathSync } = require('node:fs');
const { unlink } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFile } = require('node:child_process');
const load = require('./load-ts.cjs');
const { prepareSubscriptionProfile, classifyClaudeAuthStatus } = load('src/main/subscriptionProfile.ts');
const { prepareSubscriptionSandbox } = load('src/main/subscriptionSandbox.ts');
const { copyPinnedNativeExecutable } = load('src/main/executableIdentity.ts');

function run(boundary, binary, args, env, cwd) {
  assert.equal(boundary.args.at(-1), binary);
  return new Promise(resolve => execFile(boundary.command, [...boundary.args, ...args], {
    cwd, env, encoding:'utf8', timeout:10000, killSignal:'SIGKILL', maxBuffer:16384
  }, (error, stdout, stderr) => resolve({ code:error?.code ?? 0, signal:error?.signal, stdout, stderr })));
}

function initializeCodex(boundary, binary, profile, cwd) {
  return new Promise(resolve => {
    let buffer = '', response;
    assert.equal(boundary.args.at(-1), binary);
    const child = execFile(boundary.command, [...boundary.args, ...profile.args, 'app-server'], {
      cwd, env:profile.env, encoding:'utf8', timeout:10000, killSignal:'SIGKILL', maxBuffer:16384
    }, (error, _stdout, stderr) => resolve({code:error?.code ?? 0, response, stderr}));
    child.stdout.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.id === 1) { response = message; child.stdin.end(); }
        } catch { /* the final response assertion rejects malformed output */ }
      }
    });
    // A configuration/protocol handshake only. Never creates a thread or turn.
    child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{
      clientInfo:{name:'operatus-offline-config-smoke',version:'0.1.0'},capabilities:{experimentalApi:true}
    }}) + '\n');
  });
}

for (const provider of ['claude', 'codex']) {
  const prefix = `OPERATUS_${provider.toUpperCase()}_PROBE`;
  const source = process.env[`${prefix}_PATH`];
  const digest = process.env[`${prefix}_SHA256`];
  test(`${provider}: actual CLI parses app-owned profile and exposes synthetic API auth without admitting it`, {
    skip: process.platform !== 'darwin' || !source, timeout:60000
  }, async () => {
    assert.match(digest ?? '', /^[a-f0-9]{64}$/, 'an explicit inspected digest is required');
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'operatus-auth-smoke-')));
    const binary = join(root, 'provider');
    try {
      await copyPinnedNativeExecutable(source, binary, digest);
      const profile = await prepareSubscriptionProfile(root, provider);
      const cwd = join(root, 'untrusted-project');
      mkdirSync(cwd);
      const boundary = prepareSubscriptionSandbox({artifact:cwd, profile, executable:binary, role:'critic'});
      assert.equal(boundary.receipt.launchAllowed, false);
      assert.equal(boundary.receipt.network, 'denied');
      const marker = join(cwd, 'helper-ran');
      const args = provider === 'claude' ? [...profile.args, 'auth','status'] : ['login','status'];
      if (provider === 'claude') {
        mkdirSync(join(cwd,'.claude'));
        writeFileSync(join(cwd,'.claude','settings.json'), JSON.stringify({apiKeyHelper:`touch '${marker}'`,env:{ANTHROPIC_API_KEY:'synthetic-project-key'}}));
        const empty = await run(boundary, binary, args, profile.env, cwd);
        assert.equal(empty.code, 1);
        assert.equal(classifyClaudeAuthStatus(JSON.parse(empty.stdout)), 'not-logged-in');
        assert.equal(existsSync(marker), false);
        copyFileSync(join(__dirname,'fixtures/subscription-claude-synthetic.json'),join(profile.providerHome,'.credentials.json'));
        chmodSync(join(profile.providerHome,'.credentials.json'), 0o600);
        const fakeOAuth = await run(boundary, binary, args, profile.env, cwd);
        assert.equal(fakeOAuth.code, 0, JSON.stringify({stdout:fakeOAuth.stdout,stderr:fakeOAuth.stderr}));
        const oauthShape = JSON.parse(fakeOAuth.stdout);
        assert.equal(oauthShape.authMethod, 'claude.ai');
        assert.equal(oauthShape.loggedIn, true);
        assert.equal(oauthShape.apiProvider, 'firstParty');
        assert.equal(classifyClaudeAuthStatus(oauthShape), 'subscription-hint');
        assert.equal(profile.receipt.launchAllowed, false, 'even token-shaped synthetic data is not authentication proof');
        const api = await run(boundary, binary, args, {...profile.env,ANTHROPIC_API_KEY:'synthetic-only-not-a-real-key'},cwd);
        assert.equal(api.code, 0, 'auth status succeeds even for invalid synthetic API credentials');
        assert.equal(classifyClaudeAuthStatus(JSON.parse(api.stdout)), 'forbidden-auth');
        assert.equal(existsSync(marker), false);
        console.log(JSON.stringify({provider,authMethod:oauthShape.authMethod,forcedLoginMethod:oauthShape.forcedLoginMethod,launchAllowed:false}));
      } else {
        const initialized = await initializeCodex(boundary,binary,profile,cwd);
        assert.equal(initialized.code, 0, initialized.stderr);
        assert.equal(initialized.response?.result?.codexHome, profile.providerHome, 'strict config parser accepts the exact controlled profile');
        const empty = await run(boundary,binary,args,profile.env,cwd);
        assert.equal(empty.code, 1, empty.stderr);
        assert.match(empty.stderr + empty.stdout, /not logged in/i);
        writeFileSync(join(profile.providerHome,'auth.json'),JSON.stringify({OPENAI_API_KEY:'synthetic-only-not-a-real-key',auth_mode:'apikey'}),{mode:0o600});
        const api = await run(boundary,binary,args,profile.env,cwd);
        // This pinned Codex version rejects the API profile under forced ChatGPT
        // login. Claude differs; never infer one provider's behavior from another.
        assert.equal(api.code, 1);
        assert.match(api.stderr + api.stdout, /API key|not logged in|login method/i);
        console.log(JSON.stringify({provider,apiStatusExit:api.code,launchAllowed:false}));
      }
    } finally { await unlink(binary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  });
}
