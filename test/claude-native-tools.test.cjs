'use strict';
// Real native CLI tools, scripted local SSE responses, real disposable Git and
// SQLite. NOT model judgment, subscription inference, or production launch.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {join}=require('node:path'),{tmpdir}=require('node:os'),{Readable}=require('node:stream');
const {execFileSync,execFile}=require('node:child_process'),{createHash}=require('node:crypto');
const load=require('./load-ts.cjs');
const {ClaudeAccountAdmission}=load('src/main/claudeAccountAdmission.ts');
const {openClaudeSubscriptionGateway}=load('src/main/claudeSubscriptionGateway.ts');
const {prepareSubscriptionProfile}=load('src/main/subscriptionProfile.ts');
const {prepareSubscriptionSandbox}=load('src/main/subscriptionSandbox.ts');
const {copyPinnedNativeExecutable}=load('src/main/executableIdentity.ts');
const {LocalGauntletBackend}=load('src/main/gauntlet/localBackend.ts');
const {GauntletControlServer}=load('src/main/gauntlet/controlServer.ts');
const {prepareControlClient}=load('src/main/gauntlet/controlClient.ts');
const {ClaudeFreshSessionRuntime}=load('src/main/claudeFreshSession.ts');
const {ClaudeConductorSessionRuntime}=load('src/main/claudeConductorSession.ts');
const MODEL='claude-fable-5-1';
const git=(cwd,...args)=>execFileSync('/usr/bin/git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function stream(tool){
 const events=[{type:'message_start',message:{id:'msg_fixture',type:'message',role:'assistant',model:MODEL,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}},
  {type:'content_block_start',index:0,content_block:tool?{type:'tool_use',id:tool.id,name:tool.name,input:{}}:{type:'text',text:''}},
  {type:'content_block_delta',index:0,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(tool.input)}:{type:'text_delta',text:'Synthetic tool script finished. This is not model judgment.'}},
  {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}},
  {type:'message_stop'}];
 return Readable.from(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
}
test('persistent native Conductor freezes and acknowledges a fresh-worker repair/re-critique loop',{
 skip:process.platform!=='darwin'||!process.env.OPERATUS_CLAUDE_PROBE_PATH,timeout:90000
},async t=>{
 const disk=fs.statfsSync(tmpdir()),size=fs.statSync(process.env.OPERATUS_CLAUDE_PROBE_PATH).size;
 if(disk.bavail*disk.bsize<size+256*1024*1024){t.skip('Insufficient space for native copy plus reserve');return;}
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-native-tools-'))),binary=join(root,'claude'),repository=join(root,'repo');
 let backend,server,conductor;
 try{
  await copyPinnedNativeExecutable(process.env.OPERATUS_CLAUDE_PROBE_PATH,binary,process.env.OPERATUS_CLAUDE_PROBE_SHA256);
  fs.mkdirSync(repository);git(repository,'init','-b','main');git(repository,'config','user.name','Fixture');git(repository,'config','user.email','fixture@example.invalid');
  fs.writeFileSync(join(repository,'value.txt'),'base\n');git(repository,'add','.');git(repository,'commit','-m','base');
  backend=new LocalGauntletBackend({stateRoot:join(root,'state'),primitiveRoot:join(__dirname,'../vendor/agent-primitives')});backend.open();
  server=new GauntletControlServer(join(root,'state'),backend,()=>{});await server.start();
  const receipts=[],runtime=new ClaudeFreshSessionRuntime();
  for(const mode of ['inspection','implementer']){
   const run=backend.start({repository,objective:`Native ${mode} tool fixture`,providers:{critic:{provider:'claude',model:MODEL}}}).run;
   const contract={objective:run.requestedObjective,criteria:['value.txt says repaired by native CLI'],checks:[],constraints:['Synthetic provider only'],exclusions:['Live model acceptance']};
   if(mode==='implementer'){
    conductor=await startConductor({root,binary,server,run,backend});
    assert.equal((await conductor.freeze(contract)).ok,true);
    assert.equal(backend.status(run.id).run.status,'awaiting_implementation');
   }else backend.freeze(run.id,contract);
   const worker=backend.prepareImplementer(run.id),artifact=worker.launch.worktreePath;
   const profile=await prepareSubscriptionProfile(root,'claude',mode==='inspection'?undefined:'implementer');
   const helperSource=join(__dirname,'../resources/operatus-gauntlet.cjs');
   const client=prepareControlClient({profile,helperSource,expectedHelperSha256:createHash('sha256').update(fs.readFileSync(helperSource)).digest('hex'),
    socketPath:server.info().socketPath,nodePath:process.execPath,token:worker.token});
   const account=new ClaudeAccountAdmission({now:Date.now,
    readCredential:async()=>({claudeAiOauth:{accessToken:'synthetic-main-only',expiresAt:Date.now()+3600000,scopes:['user:profile','user:inference']}}),
    metadata:async path=>path.endsWith('profile')?{account:{uuid:'11111111-1111-4111-8111-111111111111',has_claude_max:true},organization:{
     uuid:'22222222-2222-4222-8222-222222222222',organization_type:'claude_max',subscription_status:'active',has_extra_usage_enabled:false}}:{extra_usage:{is_enabled:false}}});
   let calls=0;const results=new Map();let offeredTools=[];
   const command=`"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" commit --run ${run.id} --launch ${worker.launch.id} --expected-sha ${run.baseSha} --bar-digest ${backend.status(run.id).run.contract.digest} --message "Native tool fixture"`;
   const script=[{id:'toolu_read',name:'Read',input:{file_path:join(artifact,'value.txt')}},
    {id:'toolu_write',name:'Write',input:{file_path:join(artifact,'value.txt'),content:'changed by native CLI\n'}},
    ...(mode==='implementer'?[{id:'toolu_commit',name:'Bash',input:{command,timeout:10000,description:'Submit the assigned candidate through the main-owned helper'}}]:[])];
   const gateway=await openClaudeSubscriptionGateway({account,identity:(await account.verify()).receipt,model:MODEL,maxRequests:16,
    transport:async request=>{
     assert.equal(request.token,'synthetic-main-only');calls++;
     const body=JSON.parse(request.body.toString());offeredTools=(body.tools??[]).map(t=>t.name);
     for(const message of body.messages)for(const item of Array.isArray(message.content)?message.content:[]){
      if(item.type==='tool_result')results.set(item.tool_use_id,{id:item.tool_use_id,error:!!item.is_error,text:JSON.stringify(item.content).slice(0,1400)});
     }
     if(calls>8)throw Error('Native script failed to advance');
     return{status:200,contentType:'text/event-stream',body:stream(script.find(tool=>!results.has(tool.id)))};
    }});
   try{
    const credentials=JSON.parse(fs.readFileSync(join(__dirname,'fixtures/subscription-claude-synthetic.json'),'utf8'));
    credentials.claudeAiOauth.accessToken=gateway.localToken;
    fs.writeFileSync(join(profile.providerHome,'.credentials.json'),JSON.stringify(credentials),{flag:'wx',mode:0o600});
    const boundary=prepareSubscriptionSandbox({artifact,profile,executable:binary,role:'implementer',controlClient:client.capability,providerBrokerPort:gateway.port});
    const nativeExit=mode==='implementer'?await runtime.start({launchId:worker.launch.id,sessionId:worker.launch.sessionId,
     role:'implementer',model:MODEL,prompt:'OPERATUS_NATIVE_TOOL_FIXTURE: Read value.txt, change it, then submit the assigned commit helper. Only operate on this fixture.',
     artifact,profile,executable:binary,controlClient:client.capability,gateway,timeoutMs:30000,maxTurns:6}).completion:null;
    const result=nativeExit?{code:nativeExit.exitCode,signal:nativeExit.signal,stdout:nativeExit.stdout,stderr:nativeExit.stderr}:await new Promise(resolve=>{
     const child=execFile(boundary.command,[...boundary.args,...profile.args,'--session-id',worker.launch.sessionId,'--print','--model',MODEL,'--output-format','json','--max-turns','6',
      'OPERATUS_NATIVE_TOOL_FIXTURE: Read value.txt, change it, then submit the assigned commit helper. Only operate on this fixture.'],{
       cwd:artifact,env:{...client.env,ANTHROPIC_BASE_URL:gateway.url,CLAUDE_CODE_SUBPROCESS_ENV_SCRUB:'1'},timeout:30000,killSignal:'SIGKILL',encoding:'utf8',maxBuffer:65536
      },(e,stdout,stderr)=>resolve({code:e?e.code??null:0,signal:e?.signal,stdout,stderr}));child.stdin.end();
    });
    if(nativeExit){assert.equal(nativeExit.status,'completed');assert.equal(nativeExit.processExited,true);assert.equal(nativeExit.descendantsQuiescent,false);assert.equal(nativeExit.gatewayRevocation,'confirmed');}
    const status=backend.status(run.id);
    const receipt={mode,calls,offeredTools,results:[...results.values()],exit:result.code,signal:result.signal,phase:status.run.status,
     artifactSha:status.run.currentArtifactSha,sessionId:result.code===0?JSON.parse(result.stdout).session_id:null,root,launchAllowed:false};receipts.push(receipt);console.log(JSON.stringify(receipt));
    assert.equal(result.code,0,result.stderr+result.stdout.slice(0,1000));assert.ok(result.signal==null);
    assert.equal(JSON.parse(result.stdout).session_id,worker.launch.sessionId);
    assert.equal(results.get('toolu_read')?.error,false);
    if(mode==='inspection'){
     assert.equal(fs.readFileSync(join(artifact,'value.txt'),'utf8'),'base\n');assert.equal(results.get('toolu_write')?.error,true);
     assert.equal(status.run.currentArtifactSha,null);backend.cancel(run.id,'Inspection fixture complete');
    }else{
     assert.equal(results.get('toolu_write')?.error,false);assert.equal(results.get('toolu_commit')?.error,false);
     assert.equal(status.run.status,'awaiting_critic');assert.ok(status.run.currentArtifactSha);
     assert.equal(git(repository,'show',`${status.run.currentArtifactSha}:value.txt`),'changed by native CLI');
     assert.equal(git(repository,'rev-parse','main'),run.baseSha);assert.equal(fs.readFileSync(join(repository,'value.txt'),'utf8'),'base\n');
     const critic=backend.prepareCritic(run.id);
     const review=await runCritic({root,binary,server,runtime,critic,run,sha:status.run.currentArtifactSha,digest:status.run.contract.digest,revise:true});
     receipts.push(review);console.log(JSON.stringify(review));
     assert.equal(review.exit,0);assert.ok(review.signal==null);
     assert.equal(review.sessionId,critic.launch.sessionId);
     for(const id of ['artifact','manifest','patch','report','after-report'])assert.equal(review.results.find(r=>r.id===id)?.error,false,id);
     for(const id of ['write-artifact','write-evidence','impersonate'])assert.equal(review.results.find(r=>r.id===id)?.error,true,id);
     assert.match(review.results.find(r=>r.id==='manifest').text,new RegExp(status.run.currentArtifactSha));
     assert.match(review.results.find(r=>r.id==='patch').text,/changed by native CLI/);
     assert.match(review.results.find(r=>r.id==='after-report').text,/changed by native CLI/);
     assert.match(review.results.find(r=>r.id==='write-artifact').text,/operation not permitted/i);
     assert.match(review.results.find(r=>r.id==='write-evidence').text,/operation not permitted/i);
     assert.match(review.results.find(r=>r.id==='impersonate').text,/invalid Conductor authority/);
     const reviewed=backend.status(run.id);
     assert.equal(reviewed.run.status,'awaiting_lead_ack');assert.equal(reviewed.reports.length,1);
     assert.equal(reviewed.reports[0].artifactSha,status.run.currentArtifactSha);
     assert.equal(reviewed.acknowledgments.length,0);
     assert.equal(fs.readFileSync(join(critic.launch.worktreePath,'value.txt'),'utf8'),'changed by native CLI\n');
     assert.notEqual(critic.launch.sessionId,worker.launch.sessionId);
     assert.notEqual(review.profile,profile.directory);
     // Scripted decisions are executed by one persistent native Conductor,
     // through its scoped helper, across both rounds of this fixture.
     assert.ok(conductor,'Conductor persists from bar freeze through both reviews');
     const firstAck=await conductor.decide({reportId:reviewed.reports[0].id,decision:'repair',
      acceptedFindingIds:['repair-value'],rejectedFindings:[],rationale:'Scripted fixture acknowledgment',
      repairInstructions:['Set value.txt to repaired by native CLI']});
     assert.equal(firstAck.ok,true,JSON.stringify(firstAck));
     const packet=backend.status(run.id).repairPackets[0];
     assert.equal(packet.expectedSha,status.run.currentArtifactSha);
     assert.equal(packet.contractDigest,status.run.contract.digest);
     const repair=backend.prepareRepairer(run.id,packet);
     const repairReceipt=await runRepairer({root,binary,server,runtime,repair,run,digest:packet.contractDigest});
     receipts.push(repairReceipt);console.log(JSON.stringify(repairReceipt));
     const repaired=backend.status(run.id),repairedSha=repaired.run.currentArtifactSha;
     assert.equal(repaired.run.status,'awaiting_critic');assert.notEqual(repairedSha,status.run.currentArtifactSha);
     assert.equal(git(repository,'rev-parse',`${repairedSha}^`),status.run.currentArtifactSha);
     assert.equal(git(repository,'show',`${repairedSha}:value.txt`),'repaired by native CLI');
     assert.equal(repaired.run.contract.digest,status.run.contract.digest);
     const secondCritic=backend.prepareCritic(run.id);
     const secondReview=await runCritic({root,binary,server,runtime,critic:secondCritic,run,sha:repairedSha,digest:packet.contractDigest});
     receipts.push(secondReview);console.log(JSON.stringify(secondReview));
     for(const id of ['artifact','manifest','patch','report','after-report'])assert.equal(secondReview.results.find(r=>r.id===id)?.error,false,id);
     for(const id of ['write-artifact','write-evidence','impersonate'])assert.equal(secondReview.results.find(r=>r.id===id)?.error,true,id);
     assert.match(secondReview.results.find(r=>r.id==='manifest').text,new RegExp(repairedSha));
     assert.match(secondReview.results.find(r=>r.id==='after-report').text,/repaired by native CLI/);
     const awaitingAck=backend.status(run.id);
     assert.equal(awaitingAck.run.status,'awaiting_lead_ack');assert.equal(awaitingAck.acknowledgments.length,1);
     assert.equal(awaitingAck.reports.at(-1).artifactSha,repairedSha);
     assert.equal((await conductor.decide({reportId:awaitingAck.reports.at(-1).id,decision:'pass',
      acceptedFindingIds:[],rejectedFindings:[],rationale:'Scripted final acknowledgment'})).ok,true);
     const final=backend.status(run.id);
     assert.equal(final.run.status,'passed');assert.equal(final.artifacts.length,2);
     assert.equal(final.reports.length,2);assert.equal(final.acknowledgments.length,2);
     const sessions=[worker.launch.sessionId,critic.launch.sessionId,repair.launch.sessionId,secondCritic.launch.sessionId];
     assert.equal(new Set(sessions).size,4);
     assert.equal(repairReceipt.sessionId,repair.launch.sessionId);assert.equal(secondReview.sessionId,secondCritic.launch.sessionId);
     assert.equal(new Set([profile.directory,review.profile,repairReceipt.profile,secondReview.profile]).size,4);
     assert.equal(git(repository,'rev-parse','main'),run.baseSha);
     assert.equal(fs.readFileSync(join(repository,'value.txt'),'utf8'),'base\n');
     const leadReceipt=await conductor.finish();receipts.push(leadReceipt);console.log(JSON.stringify(leadReceipt));
     assert.equal(leadReceipt.turns,3);assert.equal(leadReceipt.lastTurnRetainedHistory,true);
     assert.equal(leadReceipt.result.reason,'finished');assert.equal(leadReceipt.result.turnsCompleted,3);
     const persistedLead=final.launches.find(l=>l.id===final.run.conductorLaunchId);
     assert.equal(persistedLead.sessionId,leadReceipt.sessionId);
     assert.equal(final.run.contract.frozenByLaunchId,persistedLead.id);
     assert.ok(final.acknowledgments.every(a=>a.launchId===persistedLead.id));
     receipts.push({mode:'scripted-loop',runId:run.id,status:final.run.status,artifacts:final.artifacts.map(a=>a.sha),
      sessions,acknowledgments:final.acknowledgments.map(a=>a.id),conductor:leadReceipt.sessionId,launchAllowed:false});
    }
   }finally{await gateway.close();}
  }
  fs.writeFileSync(join(root,'native-tool-receipt.json'),JSON.stringify(receipts,null,2));
 }finally{if(conductor)await conductor.stop();if(server)await server.stop();if(backend)backend.close();await fs.promises.unlink(binary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
});

// A fresh Claude Critic is a configurable-provider fixture, not a replacement
// for the production Codex default or a live independent model judgment.
async function runCritic({root,binary,server,runtime,critic,run,sha,digest,revise=false}){
 const profile=await prepareSubscriptionProfile(root,'claude','critic'),artifact=critic.launch.worktreePath;
 const helperSource=join(__dirname,'../resources/operatus-gauntlet.cjs');
 const client=prepareControlClient({profile,helperSource,expectedHelperSha256:createHash('sha256').update(fs.readFileSync(helperSource)).digest('hex'),
  socketPath:server.info().socketPath,nodePath:process.execPath,token:critic.token});
 const evidence=critic.launch.reviewEvidence.directory;
 const helper='"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER"';
 const report={artifactSha:sha,contractDigest:digest,verdict:revise?'REVISE':'PASS',summary:'Scripted native tool fixture, not model judgment',
  findings:revise?[{id:'repair-value',severity:'major',title:'Required value not yet present',
   evidence:'value.txt contains changed by native CLI, not repaired by native CLI',criterionIds:[]}]:[]};
 const bash=(id,command)=>({id,name:'Bash',input:{command,timeout:10000,description:'Exercise the assigned Critic boundary'}});
 const script=[{id:'artifact',name:'Read',input:{file_path:join(artifact,'value.txt')}},
  {id:'manifest',name:'Read',input:{file_path:join(evidence,'manifest.json')}},
  {id:'patch',name:'Read',input:{file_path:join(evidence,'changes.patch')}},
  bash('write-artifact','printf forbidden > value.txt'),
  bash('write-evidence',`printf forbidden > '${join(evidence,'manifest.json')}'`),
  bash('impersonate',`${helper} cancel --run ${run.id} --reason forbidden`),
  bash('report',`${helper} critic --run ${run.id} --launch ${critic.launch.id} --json '${JSON.stringify(report)}'`),
  bash('after-report','/bin/cat value.txt')];
 const account=new ClaudeAccountAdmission({now:Date.now,
  readCredential:async()=>({claudeAiOauth:{accessToken:'synthetic-main-only',expiresAt:Date.now()+3600000,scopes:['user:profile','user:inference']}}),
  metadata:async path=>path.endsWith('profile')?{account:{uuid:'11111111-1111-4111-8111-111111111111',has_claude_max:true},organization:{
   uuid:'22222222-2222-4222-8222-222222222222',organization_type:'claude_max',subscription_status:'active',has_extra_usage_enabled:false}}:{extra_usage:{is_enabled:false}}});
 let calls=0;const results=new Map();let offeredTools=[];
 const gateway=await openClaudeSubscriptionGateway({account,identity:(await account.verify()).receipt,model:MODEL,maxRequests:16,
  transport:async request=>{
   assert.equal(request.token,'synthetic-main-only');calls++;const body=JSON.parse(request.body.toString());
   offeredTools=(body.tools??[]).map(t=>t.name);
   for(const message of body.messages)for(const item of Array.isArray(message.content)?message.content:[]){
    if(item.type==='tool_result')results.set(item.tool_use_id,{id:item.tool_use_id,error:!!item.is_error,text:JSON.stringify(item.content).slice(0,4000)});
   }
   if(calls>12)throw Error('Native Critic script failed to advance');
   return{status:200,contentType:'text/event-stream',body:stream(script.find(tool=>!results.has(tool.id)))};
  }});
 try{
  const credentials=JSON.parse(fs.readFileSync(join(__dirname,'fixtures/subscription-claude-synthetic.json'),'utf8'));
  credentials.claudeAiOauth.accessToken=gateway.localToken;
  fs.writeFileSync(join(profile.providerHome,'.credentials.json'),JSON.stringify(credentials),{flag:'wx',mode:0o600});
  const result=await runtime.start({launchId:critic.launch.id,sessionId:critic.launch.sessionId,role:'critic',model:MODEL,
   prompt:'OPERATUS_NATIVE_CRITIC_FIXTURE: Inspect only the assigned artifact and review evidence.',artifact,profile,executable:binary,
   controlClient:client.capability,gateway,reviewEvidenceDirectory:evidence,timeoutMs:30000,maxTurns:12}).completion;
  assert.equal(result.status,'completed',result.stderr);assert.equal(result.processExited,true);assert.equal(result.descendantsQuiescent,false);assert.equal(result.gatewayRevocation,'confirmed');
  return{mode:'critic',profile:profile.directory,calls,offeredTools,results:[...results.values()],exit:result.exitCode,signal:result.signal,
   artifactSha:sha,sessionId:result.exitCode===0?JSON.parse(result.stdout).session_id:null,launchAllowed:false};
 }finally{await gateway.close();}
}

async function startConductor({root,binary,server,run,backend}){
 const {randomUUID}=require('node:crypto');
 const prepared=backend.prepareConductor(run.id);
 const profile=await prepareSubscriptionProfile(root,'claude','conductor'),helperSource=join(__dirname,'../resources/operatus-gauntlet.cjs');
 const client=prepareControlClient({profile,helperSource,expectedHelperSha256:createHash('sha256').update(fs.readFileSync(helperSource)).digest('hex'),
  socketPath:server.info().socketPath,nodePath:process.execPath,token:prepared.token});
 const account=new ClaudeAccountAdmission({now:Date.now,
  readCredential:async()=>({claudeAiOauth:{accessToken:'synthetic-main-only',expiresAt:Date.now()+3600000,scopes:['user:profile','user:inference']}}),
  metadata:async path=>path.endsWith('profile')?{account:{uuid:'11111111-1111-4111-8111-111111111111',has_claude_max:true},organization:{
   uuid:'22222222-2222-4222-8222-222222222222',organization_type:'claude_max',subscription_status:'active',has_extra_usage_enabled:false}}:{extra_usage:{is_enabled:false}}});
 let currentTool,calls=0,turns=0,lastTurnRetainedHistory=false,stdout='',stderr='';const results=new Map();
 const runtime=new ClaudeConductorSessionRuntime((command,args,options)=>{
  const child=require('node:child_process').spawn(command,args,options);
  child.stdout.on('data',data=>stdout=(stdout+data.toString()).slice(-4000));
  child.stderr.on('data',data=>stderr=(stderr+data.toString()).slice(-1000));return child;
 });
 const gateway=await openClaudeSubscriptionGateway({account,identity:(await account.verify()).receipt,model:MODEL,maxRequests:12,
  transport:async request=>{
   assert.equal(request.token,'synthetic-main-only');calls++;const body=JSON.parse(request.body.toString());
   assert.deepEqual((body.tools??[]).map(t=>t.name).sort(),['Bash','Glob','Grep','Read']);
   if(turns===3){const history=JSON.stringify(body.messages);lastTurnRetainedHistory=[1,2,3].every(n=>history.includes(`OPERATUS_DECISION_${n}`));}
   for(const message of body.messages)for(const item of Array.isArray(message.content)?message.content:[]){
    if(item.type==='tool_result')results.set(item.tool_use_id,{error:!!item.is_error,text:JSON.stringify(item.content)});
   }
   if(calls>10||!currentTool)throw Error('Unexpected Conductor request');
   return{status:200,contentType:'text/event-stream',body:stream(results.has(currentTool.id)?undefined:currentTool)};
  }});
 let handle;
 try{
  const credentials=JSON.parse(fs.readFileSync(join(__dirname,'fixtures/subscription-claude-synthetic.json'),'utf8'));
  credentials.claudeAiOauth.accessToken=gateway.localToken;
  fs.writeFileSync(join(profile.providerHome,'.credentials.json'),JSON.stringify(credentials),{flag:'wx',mode:0o600});
  handle=runtime.start({launchId:prepared.launch.id,sessionId:prepared.launch.sessionId,role:'conductor',model:MODEL,artifact:run.repository,
   profile,executable:binary,controlClient:client.capability,gateway,timeoutMs:60000,turnTimeoutMs:20000,maxMessages:3,maxTurns:6});
 }catch(error){await gateway.close();throw error;}
 async function decide(action,payload){
   turns++;const command=`"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" ${action} --run ${run.id} --launch ${prepared.launch.id} --json '${JSON.stringify(payload)}'`;
   currentTool={id:`lead-ack-${turns}`,name:'Bash',input:{command,timeout:10000,description:'Acknowledge the exact fixture report'}};
   const result=await handle.send(randomUUID(),`OPERATUS_DECISION_${turns}: Execute this scripted fixture decision: ${JSON.stringify(payload)}`);
   assert.equal(result.ok,true,JSON.stringify({result,calls,stdout:stdout.slice(-500),stderr}));assert.equal(results.get(currentTool.id)?.error,false);
   assert.match(results.get(currentTool.id).text,/ok/);return{ok:true};
 }
 return{
  freeze:payload=>decide('freeze',payload),
  decide:payload=>decide('acknowledge',payload),
  async finish(){handle.finish();const result=await handle.completion;return{mode:'conductor',pid:handle.pid,sessionId:handle.receipt.sessionId,
   profile:profile.directory,turns,calls,lastTurnRetainedHistory,result,launchAllowed:false};},
  async stop(){handle.stop();await handle.completion;await gateway.close();backend.releaseConductor(run.id,prepared.launch.id,'Native fixture Conductor exited');}
 };
}

async function runRepairer({root,binary,server,runtime,repair,run,digest}){
 const profile=await prepareSubscriptionProfile(root,'claude','repairer'),artifact=repair.launch.worktreePath;
 const helperSource=join(__dirname,'../resources/operatus-gauntlet.cjs');
 const client=prepareControlClient({profile,helperSource,expectedHelperSha256:createHash('sha256').update(fs.readFileSync(helperSource)).digest('hex'),
  socketPath:server.info().socketPath,nodePath:process.execPath,token:repair.token});
 const command=`"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" commit --run ${run.id} --launch ${repair.launch.id} --expected-sha ${repair.launch.expectedSha} --bar-digest ${digest} --message "Native scoped repair"`;
 const script=[{id:'repair-read',name:'Read',input:{file_path:join(artifact,'value.txt')}},
  {id:'repair-write',name:'Write',input:{file_path:join(artifact,'value.txt'),content:'repaired by native CLI\n'}},
  {id:'repair-commit',name:'Bash',input:{command,timeout:10000,description:'Submit only this repair artifact'}}];
 const account=new ClaudeAccountAdmission({now:Date.now,
  readCredential:async()=>({claudeAiOauth:{accessToken:'synthetic-main-only',expiresAt:Date.now()+3600000,scopes:['user:profile','user:inference']}}),
  metadata:async path=>path.endsWith('profile')?{account:{uuid:'11111111-1111-4111-8111-111111111111',has_claude_max:true},organization:{
   uuid:'22222222-2222-4222-8222-222222222222',organization_type:'claude_max',subscription_status:'active',has_extra_usage_enabled:false}}:{extra_usage:{is_enabled:false}}});
 let calls=0;const results=new Map();let offeredTools=[];
 const gateway=await openClaudeSubscriptionGateway({account,identity:(await account.verify()).receipt,model:MODEL,maxRequests:8,
  transport:async request=>{
   assert.equal(request.token,'synthetic-main-only');calls++;const body=JSON.parse(request.body.toString());
   offeredTools=(body.tools??[]).map(t=>t.name);
   for(const message of body.messages)for(const item of Array.isArray(message.content)?message.content:[]){
    if(item.type==='tool_result')results.set(item.tool_use_id,{id:item.tool_use_id,error:!!item.is_error,text:JSON.stringify(item.content).slice(0,2000)});
   }
   if(calls>6)throw Error('Native Repairer script failed to advance');
   return{status:200,contentType:'text/event-stream',body:stream(script.find(tool=>!results.has(tool.id)))};
  }});
 try{
  const credentials=JSON.parse(fs.readFileSync(join(__dirname,'fixtures/subscription-claude-synthetic.json'),'utf8'));
  credentials.claudeAiOauth.accessToken=gateway.localToken;
  fs.writeFileSync(join(profile.providerHome,'.credentials.json'),JSON.stringify(credentials),{flag:'wx',mode:0o600});
  const result=await runtime.start({launchId:repair.launch.id,sessionId:repair.launch.sessionId,role:'repairer',model:MODEL,
   prompt:'OPERATUS_NATIVE_REPAIR_FIXTURE: Repair only the assigned value.txt and submit through the scoped helper.',
   artifact,profile,executable:binary,controlClient:client.capability,gateway,timeoutMs:30000,maxTurns:6}).completion;
  assert.equal(result.status,'completed',result.stderr+result.stdout.slice(0,1000));
  assert.equal(result.processExited,true);assert.equal(result.gatewayRevocation,'confirmed');
  for(const item of script)assert.equal(results.get(item.id)?.error,false,item.id);
  assert.match(results.get('repair-read').text,/changed by native CLI/);
  assert.equal(git(artifact,'status','--porcelain'),'');
  return{mode:'repairer',profile:profile.directory,calls,offeredTools,results:[...results.values()],exit:result.exitCode,
   sessionId:JSON.parse(result.stdout).session_id,expectedSha:repair.launch.expectedSha,launchAllowed:false};
 }finally{await gateway.close();}
}
