'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { ClaudeAccountAdmission, readClaudeMetadata, readClaudeKeychainCredential } = require('./load-ts.cjs')('src/main/claudeAccountAdmission.ts');

test('Keychain lookup selects the OS account, not the first stale service entry', {skip:process.platform!=='darwin'}, async()=>{
  const cp=require('node:child_process'),original=cp.execFile,username=require('node:os').userInfo().username;
  let observed;
  try {
    cp.execFile=(command,args,options,callback)=>{
      observed={command,args,options};callback(null,JSON.stringify({claudeAiOauth:{accessToken:'synthetic-only'}}));
    };
    assert.deepEqual(await readClaudeKeychainCredential(),{claudeAiOauth:{accessToken:'synthetic-only'}});
    assert.equal(observed.command,'/usr/bin/security');
    assert.deepEqual(observed.args,['find-generic-password','-a',/^[a-zA-Z0-9._-]+$/.test(username)?username:'claude-code-user','-s','Claude Code-credentials','-w']);
    assert.equal(observed.options.timeout,10000);
    cp.execFile=(_command,_args,_options,callback)=>callback(Error('private-provider-error'),'secret');
    await assert.rejects(readClaudeKeychainCredential(),/^Error: subscription credential unavailable$/);
  } finally {cp.execFile=original;}
});

function fixture() {
  const state = {now:100000, calls:[], token:'synthetic-oauth-token',
    profile:{account:{uuid:'11111111-1111-4111-8111-111111111111',has_claude_max:true},
      organization:{uuid:'22222222-2222-4222-8222-222222222222',organization_type:'claude_max',subscription_status:'active',has_extra_usage_enabled:false}},
    usage:{extra_usage:{is_enabled:false}}};
  const dependencies = {
    now:()=>state.now,
    readCredential:async()=>({claudeAiOauth:{accessToken:state.token,expiresAt:1000000,scopes:['user:profile','user:inference']}}),
    metadata:async(path,token)=>{state.calls.push({path,token});return path.endsWith('profile')?state.profile:state.usage;}
  };
  return {state,dependencies,admission:new ClaudeAccountAdmission(dependencies)};
}

test('live-shaped Max profile plus disabled usage creates only a short-lived account component', async()=>{
  const {state,admission}=fixture();const result=await admission.verify();assert.equal(result.ok,true);
  assert.equal(result.receipt.launchAllowed,false);assert.equal(result.receipt.plan,'max');
  assert.equal(result.receipt.extraUsage,'disabled');assert.equal(result.receipt.validUntil-state.now,30000);
  assert.equal(Object.isFrozen(result.receipt),true);
  assert.equal(admission.credentialFor(result.receipt),state.token);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-oauth|11111111|22222222/);
  assert.deepEqual(state.calls.map(c=>c.path),['/api/oauth/profile','/api/oauth/usage']);
});
test('forged, copied, expired, backwards-clock and revoked receipts cannot retrieve credentials', async()=>{
  const {state,admission}=fixture();const {receipt}=await admission.verify();
  assert.throws(()=>admission.credentialFor({...receipt}),/unknown/);
  assert.throws(()=>new ClaudeAccountAdmission().credentialFor(receipt),/unknown/);
  state.now=receipt.validUntil;assert.throws(()=>admission.credentialFor(receipt),/expired/);
  state.now=100000;const next=(await admission.verify()).receipt;admission.revoke(next);
  assert.throws(()=>admission.credentialFor(next),/unknown/);
  const third=(await admission.verify()).receipt;state.now--;
  assert.throws(()=>admission.credentialFor(third),/expired/);
});
test('malformed or expiring credentials stop before any metadata request',async()=>{
  for(const credential of [null,{OPENAI_API_KEY:'synthetic-api'}, {claudeAiOauth:{accessToken:'bad\r\nheader',expiresAt:1000000,scopes:['user:profile','user:inference']}},
    {claudeAiOauth:{accessToken:'synthetic',expiresAt:100001,scopes:['user:profile','user:inference']}},
    {claudeAiOauth:{accessToken:'synthetic',expiresAt:1000000,scopes:['user:inference']}}]) {
    const {state,dependencies}=fixture();dependencies.readCredential=async()=>credential;
    assert.equal((await new ClaudeAccountAdmission(dependencies).verify()).ok,false);assert.equal(state.calls.length,0);
  }
});
test('tool turns reuse bounded metadata but still read credentials, refresh at five minutes, and never serve stale on error',async()=>{
  const {state,dependencies,admission}=fixture();
  const read=dependencies.readCredential;let reads=0;
  dependencies.readCredential=async()=>{reads++;return read();};
  const first=await admission.verify();assert.equal(first.ok,true);
  for(let i=0;i<20;i++){
    state.now+=1000;const next=await admission.verify();assert.equal(next.ok,true);
    assert.equal(next.receipt.metadataObservedAt,first.receipt.observedAt);
    assert.equal(next.receipt.observedAt,state.now);
    assert.ok(next.receipt.validUntil<=first.receipt.observedAt+300000);
    admission.revoke(next.receipt);
  }
  assert.equal(reads,21);assert.equal(state.calls.length,2);
  state.now=399999;const last=await admission.verify();assert.equal(last.receipt.validUntil,400000);
  state.now=400000;dependencies.metadata=async()=>{throw Error('rate limited, private body')};
  assert.deepEqual(await admission.verify(),{ok:false,reason:'profile-unavailable'});
  assert.throws(()=>admission.credentialFor(last.receipt),/expired/);
  assert.deepEqual(await admission.verify(),{ok:false,reason:'profile-unavailable'});
});
test('credential rotation, expiration and removal cannot use an old metadata observation',async()=>{
  const f=fixture();await f.admission.verify();f.state.token='rotated-subscription-token';
  assert.equal((await f.admission.verify()).ok,true);assert.equal(f.state.calls.length,4);
  f.dependencies.readCredential=async()=>null;
  assert.deepEqual(await f.admission.verify(),{ok:false,reason:'credential-unavailable'});
  f.dependencies.readCredential=async()=>({claudeAiOauth:{accessToken:f.state.token,expiresAt:f.state.now+100,scopes:['user:profile','user:inference']}});
  assert.deepEqual(await f.admission.verify(),{ok:false,reason:'credential-expired'});
});
test('non-Max, inactive, malformed, and enabled or ambiguous overage are rejected',async()=>{
  for(const mutate of [s=>{s.profile.account.has_claude_max=false},s=>{s.profile.organization.subscription_status='canceled'},
    s=>{s.profile.organization.organization_type='api'},s=>{s.profile.account.uuid='not-an-id'},
    s=>{s.profile.organization.has_extra_usage_enabled=true},s=>{delete s.profile.organization.has_extra_usage_enabled},
    s=>{s.usage.extra_usage.is_enabled=true},s=>{s.usage.extra_usage.is_enabled='false'},s=>{s.usage={}}]) {
    const {state,admission}=fixture();mutate(state);assert.equal((await admission.verify()).ok,false);
  }
});
test('transport/keychain errors return fixed failures without raw secrets or provider messages',async()=>{
  const {dependencies}=fixture();dependencies.readCredential=async()=>{throw Error('synthetic-secret')};
  assert.deepEqual(await new ClaudeAccountAdmission(dependencies).verify(),{ok:false,reason:'credential-unavailable'});
  const second=fixture();second.dependencies.metadata=async()=>{throw Error('synthetic-secret')};
  assert.deepEqual(await new ClaudeAccountAdmission(second.dependencies).verify(),{ok:false,reason:'profile-unavailable'});
});

test('metadata transport permits only fixed TLS GETs and never follows redirects or accepts oversized/malformed bodies',async()=>{
  const original=https.request;const requests=[];
  try {
    for(const sample of [{status:200,body:'{"safe":true}',success:true},{status:302,body:'{}'},
      {status:401,body:'synthetic-secret'}, {status:200,body:'not-json'}, {status:200,body:'x'.repeat(131073)}]) {
      https.request=(options,callback)=>{
        requests.push(options);const req=new EventEmitter();req.destroy=()=>{};
        req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=sample.status;res.destroy=()=>{};
          callback(res);res.emit('data',Buffer.from(sample.body));res.emit('end');});return req;
      };
      if(sample.success)assert.deepEqual(await readClaudeMetadata('/api/oauth/profile','synthetic-token'),{safe:true});
      else await assert.rejects(readClaudeMetadata('/api/oauth/usage','synthetic-token'),/^Error: subscription metadata unavailable$/);
    }
    for(const options of requests) {
      assert.equal(options.hostname,'api.anthropic.com');assert.equal(options.method,'GET');assert.equal(options.port,443);
      assert.equal(options.rejectUnauthorized,true);assert.equal(options.headers.Authorization,'Bearer synthetic-token');
      assert.equal(options.headers['X-Api-Key'],undefined);assert.ok(options.agent instanceof https.Agent);
      assert.ok(['/api/oauth/profile','/api/oauth/usage'].includes(options.path));
    }
    const before=requests.length;
    await assert.rejects(readClaudeMetadata('/v1/messages','synthetic-token'),/unsupported/);
    await assert.rejects(readClaudeMetadata('/api/oauth/profile','invalid\r\nheader'),/invalid/);
    assert.equal(requests.length,before);
  } finally {https.request=original;}
});
test('synchronous request failure is redacted and its deadline is cleared',async()=>{
  const original=https.request;
  try {https.request=()=>{throw Error('synthetic-secret')};await assert.rejects(readClaudeMetadata('/api/oauth/profile','synthetic-token'),/^Error: subscription metadata unavailable$/);}
  finally {https.request=original;}
});
