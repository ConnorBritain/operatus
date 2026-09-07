'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),net=require('node:net');
const {join}=require('node:path'),{tmpdir}=require('node:os'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const load=require('./load-ts.cjs');
const {prepareSubscriptionProfile}=load('src/main/subscriptionProfile.ts');
const {ClaudeFreshSessionRuntime}=load('src/main/claudeFreshSession.ts');
const mac={skip:process.platform!=='darwin',timeout:10000};
const processTreeSpawner=require('./fixtures/native-process-tree.cjs');
let fixturePort=14000;
async function fixture(t,role='implementer'){
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-fresh-session-'))),artifact=join(root,'artifact'),evidence=join(root,'evidence');
 fs.mkdirSync(artifact);fs.mkdirSync(evidence);
 const server=net.createServer(s=>s.destroy()),socket=join(root,'control.sock');
 await new Promise(r=>server.listen(socket,r));t.after(()=>new Promise(r=>server.close(r)));
 const profile=await prepareSubscriptionProfile(root,'claude',role),helperPath=join(root,'helper.cjs'),credentialPath=join(root,'capability.json');
 fs.writeFileSync(helperPath,'// inert test helper');fs.writeFileSync(credentialPath,'{}');
 const port=fixturePort++;
 return{launchId:randomUUID(),sessionId:randomUUID(),role,model:'claude-fable-5-1',prompt:'Fixture prompt only',artifact,profile,
  executable:'/bin/bash',controlClient:{socketPath:socket,nodePath:fs.realpathSync(process.execPath),helperPath,credentialPath},
  gateway:{port,url:`http://127.0.0.1:${port}`,close:async()=>{}},reviewEvidenceDirectory:role==='critic'?evidence:undefined,timeoutMs:3000,maxTurns:6};
}
test('root exit drains a real same-group child holding pipes without waiting for the role timeout',mac,async t=>{
 const input=await fixture(t),pidPath=join(input.artifact,'child.pid'),tickPath=join(input.artifact,'ticks');
 input.timeoutMs=7000;
 const handle=new ClaudeFreshSessionRuntime(processTreeSpawner({pidPath,tickPath})).start(input);
 t.after(()=>handle.stop());
 const began=Date.now(),exit=await handle.completion;
 assert.equal(exit.reason,'result');assert.equal(exit.processExited,true);assert.equal(exit.gatewayRevocation,'confirmed');
 assert.ok(Date.now()-began<2500,'normal root exit must drain children promptly rather than consume the role budget');
 const bytes=fs.existsSync(tickPath)?fs.statSync(tickPath).size:0;
 await new Promise(r=>setTimeout(r,150));
 assert.equal(fs.existsSync(tickPath)?fs.statSync(tickPath).size:0,bytes,'same-group child wrote after transport completion');
 assert.equal(exit.descendantsQuiescent,false,'one process-group test does not establish all-descendant containment');
});
test('cancellation stops an actual same-group child that ignores SIGTERM',mac,async t=>{
 const input=await fixture(t),pidPath=join(input.artifact,'child.pid'),tickPath=join(input.artifact,'ticks');
 const handle=new ClaudeFreshSessionRuntime(processTreeSpawner({pidPath,tickPath,waitForStop:true})).start(input);
 t.after(()=>handle.stop());
 const deadline=Date.now()+2000;
 while(!fs.existsSync(pidPath)){assert.ok(Date.now()<deadline,'child did not start');await new Promise(r=>setTimeout(r,20));}
 process.kill(Number(fs.readFileSync(pidPath,'utf8')),0);
 handle.stop();const exit=await handle.completion;
 assert.equal(exit.reason,'cancelled');assert.equal(exit.processExited,true);assert.equal(exit.gatewayRevocation,'confirmed');
 const bytes=fs.existsSync(tickPath)?fs.statSync(tickPath).size:0;
 await new Promise(r=>setTimeout(r,150));assert.equal(fs.existsSync(tickPath)?fs.statSync(tickPath).size:0,bytes);
});
// Exercises actual process/pipe/group lifecycle without executing a provider or
// using any network. Native sandbox + Claude are checked separately by the opt-in
// native tool test. The injected test spawner deliberately substitutes Node.
function fixtureSpawner(mode,inspect=()=>{}){
 return(command,args,options)=>{
  inspect(command,args,options);
  const id=args[args.indexOf('--session-id')+1];
  const result=JSON.stringify({type:'result',session_id:mode==='wrong-session'?randomUUID():id,is_error:mode==='provider-error',result:'fixture'});
  const events = [{type:'assistant',session_id:id,message:{content:[{type:'tool_use',id:'private-id',name:'Read',input:{file_path:'/private-path'}}]}},
    {type:'user',session_id:id,message:{content:[{type:'tool_result',tool_use_id:'private-id',content:'private-result'}]}}];
  const code=`let task='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>task+=x);process.stdin.on('end',()=>{
    if(${JSON.stringify(mode)}==='hang'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);return;}
    if(${JSON.stringify(mode)}==='overflow'){process.stdout.write('x'.repeat(1100000));return;}
    if(${JSON.stringify(mode)}==='long'){
      const line=JSON.stringify({type:'assistant',session_id:${JSON.stringify(id)},message:{content:[{type:'text',text:'long-fixture'.repeat(3000)}]}})+'\\n';
      for(let i=0;i<80;i++)process.stdout.write(line);
      process.stderr.write('diagnostic-fixture'.repeat(5000));
    }
    if(${JSON.stringify(mode)}==='session-overflow'){
      process.stderr.write('x'.repeat(65*1024*1024));return;
    }
    if(${JSON.stringify(mode)}==='malformed'){process.stdout.write('not json');return;}
    if(${JSON.stringify(mode)}==='nonzero'){process.exitCode=7;}
    if(${JSON.stringify(mode)}==='activity'){
      const stream=${JSON.stringify(events.map(e=>JSON.stringify(e)).join('\n')+'\n'+result+'\n')};
      process.stdout.write(stream.slice(0,37));setTimeout(()=>process.stdout.write(stream.slice(37)),20);return;
    }
    if(${JSON.stringify(mode)}==='duplicate-result'){process.stdout.write(${JSON.stringify(result+'\n'+result+'\n')});return;}
    if(${JSON.stringify(mode)}==='trailing-event'){process.stdout.write(${JSON.stringify(result+'\n'+JSON.stringify(events[0])+'\n')});return;}
    process.stdout.write(${JSON.stringify(result)});
  });`;
  return spawn(process.execPath,['-e',code],options);
 };
}
test('fresh NDJSON activity survives chunk boundaries without changing final-result compatibility',mac,async t=>{
 const input=await fixture(t),observed=[]; input.onActivity=event=>observed.push(event);
 const runtime=new ClaudeFreshSessionRuntime(fixtureSpawner('activity',(_command,args)=>{
  assert.equal(args[args.indexOf('--output-format')+1],'stream-json');assert.ok(args.includes('--verbose'));
 }));
 const exit=await runtime.start(input).completion;
 assert.equal(exit.reason,'result');assert.equal(JSON.parse(exit.stdout).session_id,input.sessionId);
 assert.deepEqual(observed,[{type:'tool_activity',ordinal:1,activity:'reading',stage:'requested'},
  {type:'tool_activity',ordinal:2,activity:'reading',stage:'result',outcome:'ok'}]);
 assert.equal(JSON.stringify(observed).includes('private'),false);
});
test('duplicate results and post-result activity fail closed',mac,async t=>{
 for(const mode of ['duplicate-result','trailing-event']){
  const input=await fixture(t),observed=[];input.onActivity=event=>observed.push(event);
  const exit=await new ClaudeFreshSessionRuntime(fixtureSpawner(mode)).start(input).completion;
  assert.equal(exit.reason,'invalid_result',mode);assert.equal(exit.gatewayRevocation,'confirmed');assert.deepEqual(observed,[]);
 }
});
test('fresh long verbose output returns the exact result with bounded diagnostics; session overflow revokes',mac,async t=>{
 const input=await fixture(t);let revoked=0;input.gateway.close=async()=>{revoked++;};
 const handle=new ClaudeFreshSessionRuntime(fixtureSpawner('long')).start(input),exit=await handle.completion;
 assert.equal(exit.status,'completed');assert.equal(JSON.parse(exit.stdout).session_id,input.sessionId);
 assert.ok(exit.output.stdoutBytes>2*1024*1024);assert.equal(exit.output.stdoutPreviewTruncated,true);
 assert.equal(exit.output.stderrPreviewTruncated,true);assert.ok(Buffer.byteLength(exit.stderr)<=65536);
 assert.equal(handle.receipt.outputLimits.sessionBytes,64*1024*1024);assert.equal(revoked,1);
 const overflowing=await fixture(t);overflowing.timeoutMs=5000;overflowing.gateway.close=async()=>{revoked++;};
 const failed=await new ClaudeFreshSessionRuntime(fixtureSpawner('session-overflow')).start(overflowing).completion;
 assert.equal(failed.reason,'output_limit');assert.equal(failed.gatewayRevocation,'confirmed');assert.equal(revoked,2);
 assert.ok(Buffer.byteLength(failed.stderr)<=65536);
});
test('dedicated launch preserves exact UUID/config and excludes mutable legacy environment and flags',mac,async t=>{
 const input=await fixture(t);input.profile.env.ANTHROPIC_API_KEY='ambient-forbidden';input.profile.env.HTTPS_PROXY='forbidden';
 input.profile.args.push('--resume','forbidden','--dangerously-skip-permissions');
 const runtime=new ClaudeFreshSessionRuntime(fixtureSpawner('success',(command,args,options)=>{
  assert.equal(command,'/usr/bin/sandbox-exec');assert.equal(options.detached,true);assert.equal(options.cwd,input.artifact);
  assert.equal(options.env.CLAUDE_CONFIG_DIR,input.profile.providerHome);assert.equal(options.env.HOME,input.profile.home);
  for(const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','HTTPS_PROXY','OPERATUS_GAUNTLET_TOKEN'])assert.equal(options.env[key],undefined);
  assert.equal(args[args.indexOf('--session-id')+1],input.sessionId);
  assert.equal(args[args.indexOf('--settings')+1],input.profile.configPath);
  for(const flag of ['--resume','--continue','--dangerously-skip-permissions','--bare'])assert.equal(args.includes(flag),false);
  assert.equal(args.includes(input.prompt),false,'prompt travels through stdin, not argv');
 }));
 const handle=runtime.start(input),exit=await handle.completion;
 assert.equal(exit.status,'completed');assert.equal(exit.reason,'result');assert.equal(exit.processExited,true);
 assert.equal(exit.gatewayRevocation,'confirmed');
 assert.equal(exit.descendantsQuiescent,false);assert.equal(handle.receipt.launchAllowed,false);
 assert.throws(()=>runtime.start(input),/already claimed/);handle.stop();
 assert.throws(()=>runtime.start({...input,launchId:input.launchId.toUpperCase(),sessionId:input.sessionId.toUpperCase()}),/already claimed/);
 for(const fields of [{launchId:randomUUID()},{launchId:randomUUID(),sessionId:randomUUID()}])assert.throws(()=>runtime.start({...input,...fields}),/already claimed/);
});
test('fresh Critic gets exact evidence grant; Repairer receives write tools in a new identity/profile',mac,async t=>{
 const runtime=new ClaudeFreshSessionRuntime(fixtureSpawner('success',(_command,args)=>{
  const tools=args[args.indexOf('--tools')+1];
  if(args.includes('--add-dir')){assert.equal(tools.includes('Write'),false);assert.equal(tools.includes('Edit'),false);}
  else{assert.equal(tools.includes('Write'),true);assert.equal(tools.includes('Edit'),true);}
 }));
 const critic=await fixture(t,'critic'),repairer=await fixture(t,'repairer');
 const handles=[runtime.start(critic),runtime.start(repairer)];
 const exits=await Promise.all(handles.map(h=>h.completion));assert.deepEqual(exits.map(x=>x.status),['completed','completed']);
 assert.notEqual(exits[0].sessionId,exits[1].sessionId);assert.notEqual(critic.profile.directory,repairer.profile.directory);
});
test('wrong session, malformed JSON, provider error and nonzero exit never become completion',mac,async t=>{
 for(const mode of ['wrong-session','malformed','provider-error','nonzero']){
  const input=await fixture(t),runtime=new ClaudeFreshSessionRuntime(fixtureSpawner(mode));
  const result=await runtime.start(input).completion;assert.equal(result.status,'failed',mode);
  assert.equal(result.reason,['wrong-session','malformed'].includes(mode)?'invalid_result':'provider_error');
 }
});
test('cancellation, timeout and output limits are bounded and cannot relaunch the same capability',mac,async t=>{
 for(const mode of ['cancel','timeout','overflow']){
  const input=await fixture(t);if(mode==='timeout')input.timeoutMs=100;
  const runtime=new ClaudeFreshSessionRuntime(fixtureSpawner(mode==='overflow'?'overflow':'hang'));
  const handle=runtime.start(input);if(mode==='cancel'){handle.stop();handle.stop();}
  const exit=await handle.completion;
  assert.equal(exit.reason,mode==='cancel'?'cancelled':mode==='overflow'?'output_limit':'timeout');
  assert.equal(exit.processExited,true);assert.ok(Buffer.byteLength(exit.stdout)+Buffer.byteLength(exit.stderr)<=1024*1024);
  assert.throws(()=>runtime.start(input),/already claimed/);
 }
});
test('failed OS spawn retains its claim and returns a redacted structured failure',mac,async t=>{
 const input=await fixture(t),runtime=new ClaudeFreshSessionRuntime((_command,_args,options)=>spawn('/nonexistent/operatus-fixture',[],options));
 const result=await runtime.start(input).completion;assert.equal(result.reason,'spawn_error');assert.equal(result.processExited,false);
 assert.throws(()=>runtime.start(input),/already claimed/);
 const syncInput=await fixture(t),syncRuntime=new ClaudeFreshSessionRuntime(()=>{throw Error('private diagnostic');});
 const syncResult=await syncRuntime.start(syncInput).completion;
 assert.equal(syncResult.reason,'spawn_error');assert.equal(syncResult.gatewayRevocation,'confirmed');assert.equal(syncResult.stderr,'');
 assert.throws(()=>syncRuntime.start(syncInput),/already claimed/);
});
test('unclosed transport drains return without claiming process or descendant termination',mac,async t=>{
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
 const input=await fixture(t),child=new EventEmitter();
 Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
 const runtime=new ClaudeFreshSessionRuntime(()=>child),handle=runtime.start(input);
 handle.stop();const result=await handle.completion;
 assert.equal(result.status,'cancelled');assert.equal(result.processExited,false);assert.equal(result.descendantsQuiescent,false);
 assert.equal(child.stdout.destroyed,true);assert.equal(child.stderr.destroyed,true);
});
test('invalid role, profile, gateway, limits and missing Critic evidence fail before spawn',mac,async t=>{
 const input=await fixture(t),runtime=new ClaudeFreshSessionRuntime(()=>{throw Error('must not spawn');});
 for(const fields of [{role:'conductor'},{sessionId:'old-session'},{timeoutMs:0},{maxTurns:0},{prompt:''},{model:'--bad'},
  {gateway:{port:12345,url:'https://api.anthropic.com'}},{role:'critic'}]){
  assert.throws(()=>runtime.start({...input,...fields}),/invalid fresh|mismatched isolated/);
 }
 const critic=await fixture(t,'critic');assert.throws(()=>runtime.start({...critic,reviewEvidenceDirectory:undefined}),/mismatched isolated/);
 fs.chmodSync(input.profile.configPath,0o600);fs.appendFileSync(input.profile.configPath,' ');
 assert.throws(()=>runtime.start(input),/mismatched isolated/);
});

test('every terminal path revokes its launch gateway exactly once',mac,async t=>{
 for(const mode of ['success','malformed','wrong-session','provider-error','nonzero','overflow','cancel','timeout','spawn-error','sync-error']){
  const input=await fixture(t);let closes=0;
  input.gateway.close=async()=>{closes++;};if(mode==='timeout')input.timeoutMs=100;
  const spawner=mode==='spawn-error'?(_c,_a,o)=>spawn('/nonexistent/operatus-fixture',[],o)
   :mode==='sync-error'?()=>{throw Error('private');}:fixtureSpawner(['cancel','timeout'].includes(mode)?'hang':mode);
  const runtime=new ClaudeFreshSessionRuntime(spawner),handle=runtime.start(input);
  if(mode==='cancel'){handle.stop();assert.equal(closes,1,'revoke starts synchronously on cancellation');}
  const result=await handle.completion;assert.equal(result.gatewayRevocation,'confirmed',mode);
  handle.stop();handle.stop();assert.equal(closes,1,mode);
 }
});

test('failed or stuck gateway revocation is a bounded failure, never successful completion',mac,async t=>{
 for(const mode of ['throw','reject','hang']){
  const input=await fixture(t);let closes=0,release;
  input.gateway.close=()=>{closes++;if(mode==='throw')throw Error('private close error');
   if(mode==='reject')return Promise.reject(Error('private close error'));
   return new Promise(r=>release=r);};
  const runtime=new ClaudeFreshSessionRuntime(fixtureSpawner('success')),handle=runtime.start(input);
  const result=await handle.completion;
  assert.equal(result.status,'failed');assert.equal(result.reason,'gateway_revocation_failed');assert.equal(result.gatewayRevocation,'unconfirmed');
  assert.equal(result.processExited,true);assert.equal(closes,1);assert.doesNotMatch(JSON.stringify(result),/private close error/);
  release?.();await new Promise(r=>setImmediate(r));assert.equal(result.gatewayRevocation,'unconfirmed','late close cannot rewrite the reported outcome');
 }
});

test('concurrent launches cannot share a gateway, including through a copied descriptor',mac,async t=>{
 const first=await fixture(t),second=await fixture(t);second.gateway={...first.gateway};
 let launches=0;
 const runtime=new ClaudeFreshSessionRuntime((...args)=>fixtureSpawner(++launches===1?'hang':'success')(...args));
 const handle=runtime.start(first);
 assert.throws(()=>runtime.start(second),/gateway already claimed/);assert.equal(launches,1);
 handle.stop();assert.equal((await handle.completion).gatewayRevocation,'confirmed');
 // Models OS port reuse by a new main-owned gateway after confirmed closure.
 second.gateway={...second.gateway,close:async()=>{}};
 assert.equal((await runtime.start(second).completion).status,'completed');
});

test('cancellation closes a real local gateway and aborts forwarding before an unclosed child drains',mac,async t=>{
 const {ClaudeAccountAdmission}=load('src/main/claudeAccountAdmission.ts');
 const {openClaudeSubscriptionGateway}=load('src/main/claudeSubscriptionGateway.ts');
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),http=require('node:http');
 const input=await fixture(t),account=new ClaudeAccountAdmission({now:Date.now,
  readCredential:async()=>({claudeAiOauth:{accessToken:'synthetic-main-only',expiresAt:Date.now()+3600000,scopes:['user:profile','user:inference']}}),
  metadata:async path=>path.endsWith('profile')?{account:{uuid:'11111111-1111-4111-8111-111111111111',has_claude_max:true},organization:{
   uuid:'22222222-2222-4222-8222-222222222222',organization_type:'claude_max',subscription_status:'active',has_extra_usage_enabled:false}}:{extra_usage:{is_enabled:false}}});
 let began,aborted=false,forwarded=0;
 const started=new Promise(r=>began=r),gateway=await openClaudeSubscriptionGateway({account,identity:(await account.verify()).receipt,
  model:input.model,transport:async request=>{
   assert.equal(request.token,'synthetic-main-only');forwarded++;began();
   return new Promise((_resolve,reject)=>request.signal.addEventListener('abort',()=>{aborted=true;reject(Error('synthetic abort'));},{once:true}));
  }});
 t.after(()=>gateway.close());input.gateway=gateway;
 const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
 const handle=new ClaudeFreshSessionRuntime(()=>child).start(input);t.after(()=>handle.stop());
 let settled=false;void handle.completion.then(()=>{settled=true;});
 const request=()=>new Promise(resolve=>{
  const req=http.request(`${gateway.url}/v1/messages`,{method:'POST',headers:{Authorization:`Bearer ${gateway.localToken}`,'Content-Type':'application/json'}},res=>{
   res.resume();res.on('end',()=>resolve({status:res.statusCode}));res.on('error',()=>resolve({error:true}));});
  req.on('error',()=>resolve({error:true}));req.setTimeout(2000,()=>req.destroy());
  req.end(JSON.stringify({model:input.model,stream:true,messages:[]}));
 });
 const pending=request();await started;handle.stop();
 assert.equal(aborted,true,'in-flight forwarding is aborted by stop, not by later caller cleanup');
 assert.equal(settled,false,'child transport has not drained yet');
 await pending;assert.deepEqual(await request(),{error:true});assert.equal(forwarded,1);
 const result=await handle.completion;assert.equal(result.gatewayRevocation,'confirmed');assert.equal(result.status,'cancelled');
 assert.equal(result.processExited,false);assert.equal(result.descendantsQuiescent,false);
});
