'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { CodexAccountAdmission, readCodexMetadata, readPrivateCodexCredential } = require('./load-ts.cjs')('src/main/codexAccountAdmission.ts');

const jwt = payload => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c3ludGhldGlj`;
function fixture() {
  const state = {now:100000,calls:[],credential:{auth_mode:'chatgpt',OPENAI_API_KEY:null,tokens:{account_id:'synthetic-account',
    access_token:jwt({exp:1000,'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-account'}})}},
    usage:{account_id:'synthetic-account',plan_type:'pro',credits:{has_credits:false,unlimited:false,balance:'0.0000'},
      rate_limit:{allowed:true,limit_reached:false},rate_limit_reached_type:null}};
  const dependencies = {now:()=>state.now,readCredential:async()=>state.credential,
    metadata:async(...args)=>{state.calls.push(args);return state.usage}};
  return {state,dependencies,admission:new CodexAccountAdmission(dependencies)};
}
test('matching server account with no credits yields evidence, never launch permission or top-up assurance',async()=>{
  const {state,admission}=fixture();const result=await admission.verify();assert.equal(result.ok,true);
  assert.equal(result.receipt.launchAllowed,false);assert.equal(result.receipt.topUps,'not-programmatically-verified');
  assert.equal(result.receipt.credits,'none-observed');assert.equal(result.receipt.validUntil-state.now,30000);
  assert.equal(Object.isFrozen(result.receipt),true);
  assert.equal(admission.credentialFor(result.receipt).accessToken,state.credential.tokens.access_token);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-account|c3ludGhldGlj/);
  assert.deepEqual(state.calls,[[state.credential.tokens.access_token,'synthetic-account']]);
});
test('receipt copies, other issuers, revocation, expiry and clock rollback fail closed',async()=>{
  const {state,admission}=fixture();const {receipt}=await admission.verify();
  assert.throws(()=>admission.credentialFor({...receipt}),/unknown/);
  assert.throws(()=>new CodexAccountAdmission().credentialFor(receipt),/unknown/);
  state.now=receipt.validUntil;assert.throws(()=>admission.credentialFor(receipt),/expired/);
  state.now=100000;const next=(await admission.verify()).receipt;admission.revoke(next);
  assert.throws(()=>admission.credentialFor(next),/unknown/);
  const third=(await admission.verify()).receipt;state.now--;assert.throws(()=>admission.credentialFor(third),/expired/);
});
test('API credentials, invalid token shapes, expired tokens and local account mismatch never reach transport',async()=>{
  for(const mutate of [s=>{s.credential=null},s=>{s.credential.auth_mode='apikey'},s=>{s.credential.OPENAI_API_KEY='synthetic-api'},
    s=>{s.credential.tokens.access_token='bad\r\nheader'},s=>{s.credential.tokens.account_id='other-account'},
    s=>{s.credential.tokens.access_token=jwt({exp:1,'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-account'}})}]) {
    const {state,admission}=fixture();mutate(state);assert.equal((await admission.verify()).ok,false);assert.equal(state.calls.length,0);
  }
});
test('server mismatch, unsupported plans and unavailable subscription capacity are rejected',async()=>{
  for(const mutate of [s=>{s.usage.account_id='different'},s=>{delete s.usage.account_id},s=>{s.usage.plan_type='business'},
    s=>{s.usage.plan_type='free'},s=>{s.usage.rate_limit.allowed=false},s=>{s.usage.rate_limit.limit_reached=true},
    s=>{delete s.usage.rate_limit},s=>{s.usage.rate_limit_reached_type={type:'unknown'}}]) {
    const {state,admission}=fixture();mutate(state);assert.equal((await admission.verify()).ok,false);
  }
});
test('credit metadata is recorded, not mistaken for API authentication or top-up assurance',async()=>{
  for(const credits of [undefined,null,{}, {has_credits:true,unlimited:false,balance:'239.4014550000'},
    {has_credits:false,unlimited:true,balance:'0'}, {has_credits:false,unlimited:false,balance:'1'},
    {has_credits:false,unlimited:false,balance:null},{has_credits:false,unlimited:false,balance:''},
    {has_credits:false,unlimited:false,balance:'-1'}, {has_credits:'false',unlimited:false,balance:0}]) {
    const {state,admission}=fixture();state.usage.credits=credits;
    const result=await admission.verify();assert.equal(result.ok,true);
    assert.equal(result.receipt.credits,credits?.has_credits===true || credits?.unlimited===true?'available':'unknown');
    assert.equal(result.receipt.topUps,'not-programmatically-verified');
    assert.equal(result.receipt.launchAllowed,false);
  }
});
test('credits never authorize a request once a subscription window is exhausted',async()=>{
  for(const window of ['primary_window','secondary_window']) {
    const {state,admission}=fixture();state.usage.credits={has_credits:true,unlimited:false,balance:'25'};
    state.usage.rate_limit[window]={used_percent:100};
    assert.deepEqual(await admission.verify(),{ok:false,reason:'subscription-limit-unavailable'});
  }
});
test('slow verification, clock rollback and private transport errors cannot mint valid receipts',async()=>{
  for(const delta of [-1,30001]) {const {state,dependencies}=fixture();dependencies.metadata=async()=>{state.now+=delta;return state.usage};
    assert.deepEqual(await new CodexAccountAdmission(dependencies).verify(),{ok:false,reason:'credential-expired'});}
  const first=fixture();first.dependencies.readCredential=async()=>{throw Error('synthetic-secret')};
  assert.deepEqual(await new CodexAccountAdmission(first.dependencies).verify(),{ok:false,reason:'credential-unavailable'});
  const second=fixture();second.dependencies.metadata=async()=>{throw Error('synthetic-secret')};
  assert.deepEqual(await new CodexAccountAdmission(second.dependencies).verify(),{ok:false,reason:'metadata-unavailable'});
});
test('credential reads are private, bounded, regular-file-only and reject symlink aliases', {skip:process.platform==='win32'},async()=>{
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'operatus-codex-reader-')));const path=join(root,'auth.json');
  try {
    fs.writeFileSync(path,JSON.stringify({synthetic:true}),{mode:0o600});
    assert.deepEqual(await readPrivateCodexCredential(path),{synthetic:true});
    fs.symlinkSync(path,join(root,'alias'));await assert.rejects(readPrivateCodexCredential(join(root,'alias')),/unavailable/);
    await assert.rejects(readPrivateCodexCredential(root),/unavailable/);
    fs.chmodSync(path,0o644);await assert.rejects(readPrivateCodexCredential(path),/unavailable/);fs.chmodSync(path,0o600);
    fs.writeFileSync(path,'x'.repeat(131073));await assert.rejects(readPrivateCodexCredential(path),/unavailable/);
    fs.writeFileSync(path,'synthetic-secret');await assert.rejects(readPrivateCodexCredential(path),/^Error: subscription credential unavailable$/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('metadata is one fixed TLS GET, rejects redirects/body overflow and does not expose failures',async()=>{
  const original=https.request;const requests=[];
  try {
    for(const sample of [{status:200,body:'{"safe":true}',success:true},{status:302,body:'{}'},
      {status:401,body:'synthetic-secret'},{status:200,body:'not-json'},{status:200,body:'x'.repeat(131073)}]) {
      https.request=(options,callback)=>{requests.push(options);const req=new EventEmitter();req.destroy=()=>{};
        req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=sample.status;res.destroy=()=>{};
          callback(res);res.emit('data',Buffer.from(sample.body));res.emit('end')});return req};
      if(sample.success)assert.deepEqual(await readCodexMetadata('synthetic-token','synthetic-account'),{safe:true});
      else await assert.rejects(readCodexMetadata('synthetic-token','synthetic-account'),/^Error: subscription metadata unavailable$/);
    }
    for(const options of requests) {
      assert.equal(options.hostname,'chatgpt.com');assert.equal(options.path,'/backend-api/wham/usage');
      assert.equal(options.port,443);assert.equal(options.method,'GET');assert.equal(options.rejectUnauthorized,true);
      assert.equal(options.headers.Authorization,'Bearer synthetic-token');assert.equal(options.headers['ChatGPT-Account-ID'],'synthetic-account');
      assert.equal(options.headers['X-Api-Key'],undefined);assert.ok(options.agent instanceof https.Agent);
    }
    const before=requests.length;
    await assert.rejects(readCodexMetadata('bad\r\nheader','synthetic-account'),/invalid/);
    await assert.rejects(readCodexMetadata('synthetic-token','bad\r\nheader'),/invalid/);
    assert.equal(requests.length,before);
    https.request=()=>{throw Error('synthetic-secret')};
    await assert.rejects(readCodexMetadata('synthetic-token','synthetic-account'),/^Error: subscription metadata unavailable$/);
  } finally {https.request=original;}
});
