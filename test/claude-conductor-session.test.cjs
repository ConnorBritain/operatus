'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),net=require('node:net');
const {join}=require('node:path'),{tmpdir}=require('node:os'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const load=require('./load-ts.cjs');
const {prepareSubscriptionProfile}=load('src/main/subscriptionProfile.ts');
const {ClaudeConductorSessionRuntime}=load('src/main/claudeConductorSession.ts');
const mac={skip:process.platform!=='darwin',timeout:15000};let port=23000;
const processTreeSpawner=require('./fixtures/native-process-tree.cjs');
async function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-conductor-'))),artifact=join(root,'artifact');fs.mkdirSync(artifact);
 const server=net.createServer(s=>s.destroy()),socket=join(root,'control.sock');await new Promise(r=>server.listen(socket,r));
 t.after(()=>new Promise(r=>server.close(r)));
 const profile=await prepareSubscriptionProfile(root,'claude','conductor');
 const helperPath=join(root,'helper.cjs'),credentialPath=join(root,'capability.json');fs.writeFileSync(helperPath,'// fixture');fs.writeFileSync(credentialPath,'{}');
 const selectedPort=port++;
 return {launchId:randomUUID(),sessionId:randomUUID(),role:'conductor',model:'claude-fable-5-1',artifact,profile,
  executable:'/bin/bash',controlClient:{socketPath:socket,nodePath:fs.realpathSync(process.execPath),helperPath,credentialPath},
  gateway:{port:selectedPort,url:`http://127.0.0.1:${selectedPort}`,close:async()=>{}},timeoutMs:5000,turnTimeoutMs:1500,maxTurns:6,maxMessages:3};
}
test('finishing the real root drains same-group pipe holders promptly',mac,async t=>{
 const input=await fixture(t),pidPath=join(input.profile.scratch,'child.pid'),tickPath=join(input.profile.scratch,'ticks');
 input.timeoutMs=8000;
 const handle=new ClaudeConductorSessionRuntime(processTreeSpawner({pidPath,tickPath,persistent:true})).start(input);
 t.after(()=>handle.stop());
 assert.equal((await handle.send(randomUUID(),'Synthetic child fixture')).ok,true);
 const began=Date.now();handle.finish();const exit=await handle.completion;
 assert.equal(exit.reason,'finished');assert.equal(exit.processExited,true);assert.equal(exit.gatewayRevocation,'confirmed');
 assert.ok(Date.now()-began<2500,'normal root exit must not wait for the three-second finish timeout');
 const bytes=fs.existsSync(tickPath)?fs.statSync(tickPath).size:0;
 await new Promise(r=>setTimeout(r,150));
 assert.equal(fs.existsSync(tickPath)?fs.statSync(tickPath).size:0,bytes);
 assert.equal(exit.descendantsQuiescent,false);
});
test('cancelling a real Conductor stops its SIGTERM-ignoring same-group tool child',mac,async t=>{
 const input=await fixture(t),pidPath=join(input.profile.scratch,'child.pid'),tickPath=join(input.profile.scratch,'ticks');
 const handle=new ClaudeConductorSessionRuntime(processTreeSpawner({pidPath,tickPath,persistent:true,waitForStop:true})).start(input);
 t.after(()=>handle.stop());const turn=handle.send(randomUUID(),'Synthetic cancellation');
 const deadline=Date.now()+2000;
 while(!fs.existsSync(pidPath)){assert.ok(Date.now()<deadline,'child did not start');await new Promise(r=>setTimeout(r,20));}
 process.kill(Number(fs.readFileSync(pidPath,'utf8')),0);
 handle.stop();assert.equal((await turn).ok,false);const exit=await handle.completion;
 assert.equal(exit.reason,'cancelled');assert.equal(exit.processExited,true);assert.equal(exit.gatewayRevocation,'confirmed');
 const bytes=fs.existsSync(tickPath)?fs.statSync(tickPath).size:0;
 await new Promise(r=>setTimeout(r,150));assert.equal(fs.existsSync(tickPath)?fs.statSync(tickPath).size:0,bytes);
});
// Actual pipes/process lifecycle, deliberately substitutes Node for the native
// CLI. The separately opted-in native fixture verifies real Claude behavior.
function spawner(mode,inspect=()=>{}){return (command,args,options)=>{
 inspect(command,args,options);const id=args[args.indexOf('--session-id')+1];
 const code=`const rl=require('readline').createInterface({input:process.stdin});let turns=0;
 rl.on('line',line=>{const message=JSON.parse(line);turns++;
 if(${JSON.stringify(mode)}==='hang')return;
 if(${JSON.stringify(mode)}==='exit'){process.exit(0);return;}
 if(${JSON.stringify(mode)}==='malformed'){process.stdout.write('broken\\n');return;}
 if(${JSON.stringify(mode)}==='overflow'){process.stdout.write('a'.repeat(1100000));return;}
 if(${JSON.stringify(mode)}==='long'){
   const record=JSON.stringify({type:'assistant',session_id:${JSON.stringify(id)},message:{content:[{type:'text',text:'long-lead-fixture'.repeat(3000)}]}})+'\\n';
   for(let i=0;i<180;i++)process.stdout.write(record);
 }
 const out=JSON.stringify({type:'result',session_id:${JSON.stringify(mode==='wrong-session'?randomUUID():id)},
 is_error:${JSON.stringify(mode==='provider-error')},result:'turn '+turns+': '+message.message.content})+'\\n';
 const b=Buffer.from(out);process.stdout.write(b.subarray(0,7));setImmediate(()=>process.stdout.write(b.subarray(7)));
 });`;
 return spawn(process.execPath,['-e',code],options);
};}
test('persistent Conductor exceeds its old total cap across three turns without retaining verbose text',mac,async t=>{
 const input=await fixture(t);input.timeoutMs=10000;input.turnTimeoutMs=3000;
 const handle=new ClaudeConductorSessionRuntime(spawner('long')).start(input);t.after(()=>handle.stop());
 for(let i=0;i<3;i++)assert.equal((await handle.send(randomUUID(),'Bounded fixture turn')).ok,true);
 handle.finish();const exit=await handle.completion;
 assert.equal(exit.reason,'finished');assert.equal(exit.turnsCompleted,3);assert.ok(exit.output.stdoutBytes>16*1024*1024);
 assert.equal(exit.output.stdoutPreviewTruncated,true);assert.equal(handle.receipt.outputLimits.lineBytes,1024*1024);
 assert.equal(exit.gatewayRevocation,'confirmed');
});
test('one Conductor process keeps its identity and stdin open across two bounded turns',mac,async t=>{
 const input=await fixture(t);let spawned=0,closed=0;
 input.profile.env.ANTHROPIC_API_KEY='forbidden';input.profile.args.push('--dangerously-skip-permissions');
 input.gateway.close=async()=>{closed++;};
 const runtime=new ClaudeConductorSessionRuntime(spawner('ok',(command,args,options)=>{
  spawned++;assert.equal(command,'/usr/bin/sandbox-exec');assert.equal(args[args.indexOf('--input-format')+1],'stream-json');
  assert.match(args[1],new RegExp(`localhost:${input.gateway.port}`),'outer boundary must admit exactly the owned gateway');
  assert.equal(args[args.indexOf('--tools')+1],'Read,Glob,Grep,Bash');assert.equal(options.env.ANTHROPIC_API_KEY,undefined);
  assert.equal(options.env.HOME,input.profile.home);assert.equal(args.includes('--dangerously-skip-permissions'),false);
 }));
 const handle=runtime.start(input);t.after(()=>handle.stop());
 const messageId=randomUUID(),first=handle.send(messageId,'Orient the run');
 assert.throws(()=>handle.send(randomUUID(),'Not yet'),/in-flight/);assert.throws(()=>handle.finish(),/turn completes/);
 assert.equal((await first).text,'turn 1: Orient the run');assert.equal(closed,0);
 assert.throws(()=>handle.send(messageId,'Duplicate'),/duplicate/);
 const second=await handle.send(randomUUID(),'Review new evidence 💎');
 assert.equal(second.text,'turn 2: Review new evidence 💎');assert.equal(second.sessionId,input.sessionId);
 assert.equal(spawned,1);assert.equal(closed,0);handle.finish();
 const exit=await handle.completion;assert.equal(exit.reason,'finished');assert.equal(exit.turnsCompleted,2);
 assert.equal(exit.processExited,true);assert.equal(exit.descendantsQuiescent,false);assert.equal(closed,1);
 assert.throws(()=>runtime.start(input),/claimed/);assert.throws(()=>handle.send(randomUUID(),'Too late'),/closed/);
});
test('malformed, wrong-session, provider-error, oversized and premature-exit streams cannot finish a turn',mac,async t=>{
 for(const [mode,reason]of [['malformed','invalid_stream'],['wrong-session','invalid_stream'],['provider-error','provider_error'],['overflow','output_limit'],['exit','unexpected_exit']]){
  const input=await fixture(t);let closed=0;input.gateway.close=async()=>{closed++;};
  const handle=new ClaudeConductorSessionRuntime(spawner(mode)).start(input);t.after(()=>handle.stop());
  const turn=await handle.send(randomUUID(),'Fixture');assert.equal(turn.ok,false,mode);
  assert.equal((await handle.completion).reason,reason,mode);assert.equal(closed,1);
 }
});
test('cancellation and turn timeout revoke the gateway and settle pending delivery',mac,async t=>{
 for(const mode of ['cancel','timeout']){
  const input=await fixture(t);if(mode==='timeout')input.turnTimeoutMs=50;
  let closed=0;input.gateway.close=async()=>{closed++;};
  const handle=new ClaudeConductorSessionRuntime(spawner('hang')).start(input);t.after(()=>handle.stop());
  const turn=handle.send(randomUUID(),'Fixture');if(mode==='cancel'){handle.stop();assert.equal(closed,1);}
  assert.equal((await turn).ok,false);assert.equal((await handle.completion).reason,mode==='cancel'?'cancelled':'timeout');
  assert.equal(closed,1);
 }
});
test('invalid ownership, profile and message bounds fail without accepting new authority',mac,async t=>{
 const input=await fixture(t);const runtime=new ClaudeConductorSessionRuntime(spawner('ok'));
 for(const fields of [{role:'implementer'},{sessionId:'wrong'},{maxMessages:0},{turnTimeoutMs:0},{timeoutMs:0},{maxTurns:0}]){
  assert.throws(()=>runtime.start({...input,...fields}),/invalid/);
 }
 const handle=runtime.start(input);t.after(()=>handle.stop());
 for(const [id,text]of [['bad','test'],[randomUUID(),''],[randomUUID(),'a'.repeat(270000)]])assert.throws(()=>handle.send(id,text),/invalid/);
 for(let i=0;i<input.maxMessages;i++)assert.equal((await handle.send(randomUUID(),'Fixture')).ok,true);
 assert.throws(()=>handle.send(randomUUID(),'Over limit'),/invalid/);handle.finish();assert.equal((await handle.completion).reason,'finished');
 const changed=await fixture(t);fs.chmodSync(changed.profile.configPath,0o600);fs.appendFileSync(changed.profile.configPath,' ');
 assert.throws(()=>runtime.start(changed),/invalid/);
});
test('gateway sharing, spawn failure and unconfirmed revocation remain fail-closed',mac,async t=>{
 const input=await fixture(t),second=await fixture(t);second.gateway={...input.gateway};
 const runtime=new ClaudeConductorSessionRuntime(spawner('hang')),first=runtime.start(input);t.after(()=>first.stop());
 assert.throws(()=>runtime.start(second),/claimed/);first.stop();await first.completion;
 for(const mode of ['sync','async','revoke']){
  const input=await fixture(t);if(mode==='revoke')input.gateway.close=async()=>{throw Error('private');};
  const fn=mode==='sync'?()=>{throw Error('private');}:mode==='async'?(_c,_a,o)=>spawn('/nonexistent/conductor',[],o):spawner('ok');
  const handle=new ClaudeConductorSessionRuntime(fn).start(input);t.after(()=>handle.stop());
  if(mode==='revoke'){await handle.send(randomUUID(),'Fixture');handle.finish();}
  const exit=await handle.completion;assert.equal(exit.reason,mode==='revoke'?'gateway_revocation_failed':'spawn_error');
  assert.doesNotMatch(exit.stderr,/private/);
 }
});
