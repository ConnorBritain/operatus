'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync} = require('node:fs');
const {join} = require('node:path');
const {tmpdir} = require('node:os');
const {inspectSubscriptionSetup, classifyStoredAuth} = require('./load-ts.cjs')('src/main/subscriptionPreflight.ts');
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'operatus-auth-diag-'));
  mkdirSync(join(home,'.codex')); mkdirSync(join(home,'.claude'));
  return home;
}
test('auth hints distinguish subscription, API and conflicts without admitting any', () => {
  assert.equal(classifyStoredAuth('codex', {auth_mode:'chatgpt',tokens:{access_token:'synthetic'}}), 'subscription');
  assert.equal(classifyStoredAuth('codex', {auth_mode:'chatgpt',tokens:{},OPENAI_API_KEY:'synthetic'}), 'conflicting');
  assert.equal(classifyStoredAuth('codex', {OPENAI_API_KEY:'synthetic'}), 'api');
  assert.equal(classifyStoredAuth('claude', {claudeAiOauth:{accessToken:'synthetic'}}), 'subscription');
  for(const input of [null, [], 'secret', {auth_mode:'unknown'}]) assert.equal(classifyStoredAuth('codex',input), 'unknown');
});
test('diagnostic returns no credentials, helper commands or settings content', async () => {
  const home = fixture();
  writeFileSync(join(home,'.claude','.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'synthetic-secret'}}));
  writeFileSync(join(home,'.claude','settings.json'),JSON.stringify({apiKeyHelper:'do-not-execute-me',env:{ANTHROPIC_API_KEY:'synthetic-secret'}}));
  const result = await inspectSubscriptionSetup('claude',{home,env:{ANTHROPIC_API_KEY:'synthetic-secret'},executableDirectories:[]});
  assert.equal(result.storedAuthHint,'subscription');
  assert.equal(result.configRiskDetected,true);
  assert.equal(result.ambientCredentialOrRoutingDetected,true);
  assert.equal(result.launchAllowed,false);
  assert.equal(result.authenticationVerified,false);
  assert.equal(result.noPaidOverageVerified,false);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|do-not-execute-me/);
});
test('missing and symlinked auth never establish authentication', async () => {
  const home = fixture();
  const secret = join(home,'other.json');
  writeFileSync(secret,JSON.stringify({auth_mode:'chatgpt',tokens:{}}));
  symlinkSync(secret,join(home,'.codex','auth.json'));
  const result = await inspectSubscriptionSetup('codex',{home,env:{},executableDirectories:[]});
  assert.equal(result.storedAuthHint,'unknown');
  assert.equal(result.configState,'missing');
  assert.equal(result.launchAllowed,false);
});
test('custom routing and malformed settings are diagnostic risks, never helpers to execute', async () => {
  const home = fixture();
  writeFileSync(join(home,'.codex','config.toml'),'model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://private.invalid"');
  const result = await inspectSubscriptionSetup('codex',{home,env:{},executableDirectories:[]});
  assert.equal(result.configRiskDetected,true);
  assert.doesNotMatch(JSON.stringify(result), /private.invalid/);
  writeFileSync(join(home,'.claude','settings.json'),'{invalid');
  assert.equal((await inspectSubscriptionSetup('claude',{home,env:{},executableDirectories:[]})).configState,'unreadable');
});
test('duplicate executable paths collapse, different installations are flagged', async () => {
  const home = fixture();
  const a=join(home,'a'), b=join(home,'b'), c=join(home,'c');
  for(const dir of [a,b,c]) mkdirSync(dir);
  writeFileSync(join(a,'claude'),'first-unexecuted-binary');
  writeFileSync(join(b,'claude'),'second-unexecuted-binary');
  chmodSync(join(a,'claude'), 0o700);
  chmodSync(join(b,'claude'), 0o700);
  symlinkSync(join(a,'claude'),join(c,'claude'));
  const result = await inspectSubscriptionSetup('claude',{home,env:{},executableDirectories:[a,b,c]});
  assert.equal(result.executables.length,2);
  assert.equal(result.executableAmbiguous,true);
  for(const candidate of result.executables) assert.match(candidate.sha256,/^[a-f0-9]{64}$/);
});
