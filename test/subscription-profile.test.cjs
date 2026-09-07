'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { prepareSubscriptionProfile, classifyClaudeAuthStatus } = require('./load-ts.cjs')('src/main/subscriptionProfile.ts');

test('new subscription profiles are private, independent, credential-free and app-authored', async () => {
  const root = mkdtempSync(join(tmpdir(), 'operatus-profile-test-'));
  const a = await prepareSubscriptionProfile(root, 'claude');
  const b = await prepareSubscriptionProfile(root, 'claude');
  const c = await prepareSubscriptionProfile(root, 'codex');
  assert.notEqual(a.directory, b.directory);
  for (const profile of [a,b,c]) {
    assert.equal(profile.receipt.launchAllowed, false);
    assert.equal(profile.receipt.credentialState, 'absent');
    assert.equal(statSync(profile.directory).mode & 0o777, 0o700);
    assert.equal(statSync(profile.home).mode & 0o777, 0o700);
    assert.equal(statSync(profile.configPath).mode & 0o777, 0o400);
    assert.equal(readdirSync(profile.providerHome).length, 1);
    assert.equal(createHash('sha256').update(readFileSync(profile.configPath)).digest('hex'), profile.receipt.configSha256);
    assert.equal(profile.env.NODE_OPTIONS, undefined);
    assert.equal(profile.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(profile.env.OPENAI_API_KEY, undefined);
    assert.doesNotMatch(readFileSync(profile.configPath, 'utf8'), /apiKeyHelper|base_url|notify\s*=|mcp_servers|refresh_token/);
  }
  const claude = JSON.parse(readFileSync(a.configPath, 'utf8'));
  assert.equal(claude.forceLoginMethod, 'claudeai');
  assert.equal(claude.disableAllHooks, true);
  assert.ok(a.args.includes('--restricted'));
  assert.ok(a.args.includes('--strict-mcp-config'));
  assert.ok(!a.args.includes('--bare'));
  assert.equal(a.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST, undefined);
  assert.equal(a.env.CLAUDE_CODE_TMPDIR, a.scratch);
  assert.match(readFileSync(c.configPath, 'utf8'), /forced_login_method = "chatgpt"/);
  assert.match(readFileSync(c.configPath, 'utf8'), /\[features\][\s\S]*\nplugins = false\n/);
  assert.match(readFileSync(c.configPath, 'utf8'), /\[analytics\]\nenabled = false/);
  assert.match(readFileSync(c.configPath, 'utf8'), /enable_request_compression = false/);
  assert.equal(c.env.CODEX_HOME, c.providerHome);
  assert.deepEqual(c.args, ['--strict-config']);
});

test('profile preparation rejects unsupported providers and relative roots', async () => {
  await assert.rejects(prepareSubscriptionProfile('/unused', 'groq'), /unsupported/);
  await assert.rejects(prepareSubscriptionProfile('.', 'claude'), /absolute/);
  await assert.rejects(prepareSubscriptionProfile('/unused', 'claude', 'unknown'), /unsupported provider role/);
  await assert.rejects(prepareSubscriptionProfile('/unused', 'codex', 'implementer'), /unsupported provider role/);
});

test('explicit Claude roles use preapproved tools without auto classifiers or permission bypass',async()=>{
 const root=mkdtempSync(join(tmpdir(),'operatus-role-profile-'));
 for(const role of ['conductor','critic','implementer','repairer']){
  const profile=await prepareSubscriptionProfile(root,'claude',role);
  const permissions=JSON.parse(readFileSync(profile.configPath,'utf8')).permissions;
  assert.equal(permissions.defaultMode,'dontAsk');assert.equal(permissions.disableAutoMode,'disable');
  assert.equal(permissions.disableBypassPermissionsMode,'disable');assert.ok(permissions.allow.includes('Bash'));
  assert.ok(permissions.deny.includes('Agent'));assert.ok(permissions.deny.includes('WebFetch'));
  assert.ok(permissions.deny.includes('Bash(run_in_background:true)'));
  assert.equal(permissions.allow.includes('Write'),['implementer','repairer'].includes(role));
  assert.equal(permissions.deny.includes('Write'),['conductor','critic'].includes(role));
  assert.equal(profile.receipt.role,role);assert.equal(profile.receipt.launchAllowed,false);
  const tools=profile.args[profile.args.indexOf('--tools')+1].split(',');
  assert.ok(tools.includes('Bash'));assert.ok(!tools.includes('default'));
  assert.equal(tools.includes('Write'),['implementer','repairer'].includes(role));
 }
 const inspection=await prepareSubscriptionProfile(root,'claude');
 assert.equal(JSON.parse(readFileSync(inspection.configPath,'utf8')).permissions.defaultMode,'plan');
});

test('successful CLI auth status cannot admit API credentials or establish a verified subscription', () => {
  assert.equal(classifyClaudeAuthStatus({ loggedIn:true, authMethod:'api_key', apiProvider:'firstParty', forcedLoginMethod:'claudeai', apiKeySource:'ANTHROPIC_API_KEY' }), 'forbidden-auth');
  assert.equal(classifyClaudeAuthStatus({ loggedIn:true, authMethod:'oauth_token', apiProvider:'bedrock' }), 'forbidden-auth');
  assert.equal(classifyClaudeAuthStatus({ loggedIn:false, authMethod:'none', apiProvider:'firstParty' }), 'not-logged-in');
  assert.equal(classifyClaudeAuthStatus({ loggedIn:true, authMethod:'oauth_token', apiProvider:'firstParty' }), 'subscription-hint');
  assert.equal(classifyClaudeAuthStatus({ loggedIn:true, authMethod:'claude.ai', apiProvider:'firstParty' }), 'subscription-hint');
  assert.equal(classifyClaudeAuthStatus({ loggedIn:true, authMethod:'unknown', apiProvider:'firstParty' }), 'unknown');
  assert.equal(classifyClaudeAuthStatus(null), 'unknown');
});
