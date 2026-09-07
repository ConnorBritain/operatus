'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {Readable}=require('node:stream'),{EventEmitter}=require('node:events'),https=require('node:https');
const load=require('./load-ts.cjs');
const {ClaudeAccountAdmission}=load('src/main/claudeAccountAdmission.ts');
const {openClaudeSubscriptionGateway}=load('src/main/claudeSubscriptionGateway.ts');
const MODEL='claude-fable-5-1',SSE='event: message_stop\ndata: {"type":"message_stop"}\n\n';
async function fixture(options={}){
 const state={token:'synthetic-real-side-oauth',now:100000,metadataCalls:0,forwarded:[],enabled:false,
  account:'11111111-1111-4111-8111-111111111111',wait:null};
 const account=new ClaudeAccountAdmission({now:()=>state.now,
  readCredential:async()=>({claudeAiOauth:{accessToken:state.token,expiresAt:1000000,scopes:['user:profile','user:inference']}}),
  metadata:async path=>{state.metadataCalls++;if(state.wait)await state.wait;
   return path.endsWith('profile')?{account:{uuid:state.account,has_claude_max:true},organization:{
    uuid:'22222222-2222-4222-8222-222222222222',organization_type:'claude_max',subscription_status:'active',has_extra_usage_enabled:state.enabled}}
    :{extra_usage:{is_enabled:state.enabled}};}});
 const identity=(await account.verify()).receipt;
 const input={account,identity,model:MODEL,transport:async request=>{
  state.forwarded.push(request);return {status:200,contentType:'text/event-stream',body:Readable.from([SSE])};},...options};
 const gateway=await openClaudeSubscriptionGateway(input);
 return {state,account,identity,input,gateway};
}
function send(gateway,options={}){
 const body=options.body??JSON.stringify({model:MODEL,stream:true,messages:[{role:'user',content:'Synthetic fixture'}]});
 return new Promise((resolve,reject)=>{
  const req=http.request(gateway.url,{path:options.path??'/v1/messages?beta=true',method:options.method??'POST',
   headers:{Authorization:`Bearer ${gateway.localToken}`,'Content-Type':'application/json',...options.headers}},res=>{
    let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers}));res.on('error',reject);
   });req.setTimeout(3000,()=>req.destroy(Error('Test client timed out')));req.on('error',reject);req.end(body);
 });
}
test('local bearer is replaced outside the worker after fresh account admission',async()=>{
 const f=await fixture();try{
  const hello=await send(f.gateway,{method:'HEAD',path:'/api/hello',body:''});assert.equal(hello.status,204);assert.equal(f.state.forwarded.length,0);
  const response=await send(f.gateway,{headers:{'anthropic-beta':'oauth-2025-04-20','x-untrusted-routing':'ignored'}});
  assert.equal(response.status,200);assert.equal(response.text,SSE);assert.equal(f.state.metadataCalls,2);
  const forwarded=f.state.forwarded[0];assert.equal(forwarded.token,f.state.token);assert.notEqual(forwarded.token,f.gateway.localToken);
  assert.deepEqual(forwarded.headers,{'anthropic-beta':'oauth-2025-04-20'});
  assert.equal(f.gateway.receipt.launchAllowed,false);assert.doesNotMatch(JSON.stringify(f.gateway.receipt)+response.text,/synthetic-real-side-oauth/);
  f.input.model='claude-other'; // Caller mutation cannot broaden a running assignment.
  assert.equal((await send(f.gateway,{body:JSON.stringify({model:'claude-other',messages:[],stream:true})})).status,403);
 }finally{await f.gateway.close();}
});
test('alternate credentials, browser origins, routes and models never reach account or provider',async()=>{
 const f=await fixture();try{
  for(const options of [
   {headers:{Authorization:'Bearer wrong'}},{headers:{'x-api-key':'synthetic-api-key'}},
   {headers:{Origin:'https://attacker.invalid'}},{headers:{Host:'attacker.invalid'}},
   {headers:{'Proxy-Authorization':'Bearer other'}},{headers:{'Content-Encoding':'gzip'}},
   {path:'https://api.other.invalid/v1/messages'},{path:'/v1/messages?url=https://other.invalid'},
   {method:'GET'},{body:'not json'},{body:'null'},
   {body:JSON.stringify({model:'claude-other',messages:[],stream:true})},
   {body:JSON.stringify({model:MODEL,messages:[],stream:false})},
   {headers:{'Content-Type':'text/plain'}}]){
   assert.ok((await send(f.gateway,options)).status>=400,JSON.stringify(options));
  }
  assert.equal(f.state.forwarded.length,0);assert.equal(f.state.metadataCalls,2);
 }finally{await f.gateway.close();}
});
test('changed identity and enabled extra usage are refused when the bounded observation refreshes',async()=>{
 for(const mutate of [state=>{state.enabled=true},state=>{state.account='33333333-3333-4333-8333-333333333333'}]){
  const f=await fixture();try{mutate(f.state);f.state.now+=300000;assert.equal((await send(f.gateway)).status,403);assert.equal(f.state.forwarded.length,0);}
  finally{await f.gateway.close();}
 }
});
test('request bound, redirect/error redaction and malformed responses never trigger fallback',async()=>{
 const f=await fixture({maxRequests:1});try{
  assert.equal((await send(f.gateway)).status,200);assert.equal((await send(f.gateway)).status,429);assert.equal(f.state.forwarded.length,1);
 }finally{await f.gateway.close();}
 for(const status of [302,401,429]){
  let calls=0;const f=await fixture({transport:async()=>{calls++;return{status,contentType:'text/event-stream',body:Readable.from(['synthetic-upstream-secret'])};}});
  try{const r=await send(f.gateway);assert.equal(r.status,status>=400?status:502);assert.doesNotMatch(r.text,/synthetic-upstream-secret/);assert.equal(calls,1);}
  finally{await f.gateway.close();}
 }
});
test('request size, copied identity and invalid configuration fail closed',async()=>{
 const f=await fixture();try{
  assert.equal((await send(f.gateway,{body:'x'.repeat(4*1024*1024+1)})).status,413);
  assert.equal(f.state.forwarded.length,0);assert.equal(f.state.metadataCalls,2);
  await assert.rejects(openClaudeSubscriptionGateway({...f.input,identity:{...f.identity}}),/unknown/);
  for(const options of [{model:'https://other.invalid'},{maxRequests:0},{requestTimeoutMs:Infinity}]){
   await assert.rejects(openClaudeSubscriptionGateway({...f.input,...options}),/invalid/);
  }
 }finally{await f.gateway.close();}
});
test('close during account verification prevents later forwarding; close is idempotent',async()=>{
 const f=await fixture();let release;
 try{
  f.state.wait=new Promise(r=>release=r);
  f.state.now+=300000;
  const pending=send(f.gateway).catch(()=>null);
  for(let attempts=0;attempts<100&&f.state.metadataCalls<3;attempts++)await new Promise(r=>setTimeout(r,5));
  assert.ok(f.state.metadataCalls>=3,'request reached account verification');
  const first=f.gateway.close();assert.equal(f.gateway.close(),first);await first;release();await pending;
  await new Promise(r=>setImmediate(r));assert.equal(f.state.forwarded.length,0);
 }finally{release?.();await f.gateway.close();}
});
test('deadline aborts in-flight transport and concurrent calls are refused',async()=>{
 let began,aborted=false;const started=new Promise(r=>began=r);
 const f=await fixture({requestTimeoutMs:150,transport:async request=>{
  began();await new Promise((_r,reject)=>request.signal.addEventListener('abort',()=>{aborted=true;reject(Error('synthetic-secret'));},{once:true}));
 }});
 try{
  const pending=send(f.gateway).catch(()=>null);await started;
  assert.equal((await send(f.gateway)).status,429);
  const response=await pending;if(response){assert.equal(response.status,504);assert.doesNotMatch(response.text,/synthetic-secret/);}
  assert.equal(aborted,true);
 }finally{await f.gateway.close();}
});
test('default transport pins HTTPS destination and never forwards the local bearer or API headers',async()=>{
 const original=https.request;const requests=[];
 https.request=(options,callback)=>{
  requests.push(options);const req=new EventEmitter();
  req.end=()=>queueMicrotask(()=>{const response=Readable.from([SSE]);response.statusCode=200;response.headers={'content-type':'text/event-stream'};callback(response);});
  return req;
 };
 let f;try{
  f=await fixture({transport:undefined});assert.equal((await send(f.gateway)).status,200);
  assert.equal(requests.length,1);const options=requests[0];
  assert.equal(options.hostname,'api.anthropic.com');assert.equal(options.port,443);assert.equal(options.rejectUnauthorized,true);
  assert.equal(options.path,'/v1/messages?beta=true');assert.equal(options.headers.Authorization,'Bearer synthetic-real-side-oauth');
  assert.equal(options.headers['x-api-key'],undefined);assert.ok(!JSON.stringify(options.headers).includes(f.gateway.localToken));
 }finally{if(f)await f.gateway.close();https.request=original;}
});
test('unexpected MIME and oversized provider streams are not passed through',async()=>{
 let aborted=false;
 const wrong=await fixture({transport:async()=>({status:200,contentType:'text/html',body:Readable.from(['secret'])})});
 try{const result=await send(wrong.gateway);assert.equal(result.status,502);assert.doesNotMatch(result.text,/secret/);}
 finally{await wrong.gateway.close();}
 const huge=await fixture({transport:async request=>{
  request.signal.addEventListener('abort',()=>{aborted=true;},{once:true});
  return{status:200,contentType:'text/event-stream',body:Readable.from([Buffer.alloc(16*1024*1024+1)])};
 }});
 try{await assert.rejects(send(huge.gateway));assert.equal(aborted,true);}
 finally{await huge.gateway.close();}
});
