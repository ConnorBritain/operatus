'use strict';
// Actual pinned Claude, synthetic OAuth on both sides, rejecting fake upstream.
// No real credential, external provider connection, or model response.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {join}=require('node:path'),{tmpdir}=require('node:os'),{execFile}=require('node:child_process'),{Readable}=require('node:stream');
const load=require('./load-ts.cjs');
const {ClaudeAccountAdmission}=load('src/main/claudeAccountAdmission.ts');
const {openClaudeSubscriptionGateway}=load('src/main/claudeSubscriptionGateway.ts');
const {prepareSubscriptionProfile}=load('src/main/subscriptionProfile.ts');
const {prepareSubscriptionSandbox}=load('src/main/subscriptionSandbox.ts');
const {copyPinnedNativeExecutable}=load('src/main/executableIdentity.ts');
test('native Claude uses only its local bearer while the gateway injects main-only synthetic OAuth',{
 skip:process.platform!=='darwin'||!process.env.OPERATUS_CLAUDE_PROBE_PATH,timeout:45000
},async t=>{
 const disk=fs.statfsSync(tmpdir()),size=fs.statSync(process.env.OPERATUS_CLAUDE_PROBE_PATH).size;
 if(disk.bavail*disk.bsize<size+256*1024*1024){t.skip('Insufficient free space for native copy plus 256 MiB reserve');return;}
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-native-gateway-'))),binary=join(root,'claude');
 const account=new ClaudeAccountAdmission({now:Date.now,
  readCredential:async()=>({claudeAiOauth:{accessToken:'synthetic-main-only-oauth',expiresAt:Date.now()+3600000,scopes:['user:profile','user:inference']}}),
  metadata:async path=>path.endsWith('profile')?{account:{uuid:'11111111-1111-4111-8111-111111111111',has_claude_max:true},
   organization:{uuid:'22222222-2222-4222-8222-222222222222',organization_type:'claude_max',subscription_status:'active',has_extra_usage_enabled:false}}
   :{extra_usage:{is_enabled:false}}});
 const records=[];let gateway;
 try{
  await copyPinnedNativeExecutable(process.env.OPERATUS_CLAUDE_PROBE_PATH,binary,process.env.OPERATUS_CLAUDE_PROBE_SHA256);
  gateway=await openClaudeSubscriptionGateway({account,identity:(await account.verify()).receipt,model:'claude-fable-5-1',maxRequests:3,
   transport:async request=>{
    records.push({model:JSON.parse(request.body.toString()).model,mainOnlyCredential:request.token==='synthetic-main-only-oauth',
     containsLocalBearer:request.token===gateway.localToken,headerNames:Object.keys(request.headers).sort()});
    return{status:401,contentType:'application/json',body:Readable.from(['Synthetic upstream rejection'])};
   }});
  const profile=await prepareSubscriptionProfile(root,'claude'),artifact=join(root,'artifact');fs.mkdirSync(artifact);
  const credential=JSON.parse(fs.readFileSync(join(__dirname,'fixtures/subscription-claude-synthetic.json'),'utf8'));
  credential.claudeAiOauth.accessToken=gateway.localToken;
  fs.writeFileSync(join(profile.providerHome,'.credentials.json'),JSON.stringify(credential),{flag:'wx',mode:0o600});
  const boundary=prepareSubscriptionSandbox({artifact,profile,executable:binary,role:'critic',providerBrokerPort:gateway.port});
  const result=await new Promise(resolve=>{
   const child=execFile(boundary.command,[...boundary.args,...profile.args,'--print','--model','claude-fable-5-1','--output-format','json','--max-turns','1',
    'Reply probe. Do not use tools.'],{cwd:artifact,env:{...profile.env,ANTHROPIC_BASE_URL:gateway.url,CLAUDE_CODE_SUBPROCESS_ENV_SCRUB:'1'},
     timeout:25000,killSignal:'SIGKILL',encoding:'utf8',maxBuffer:32768},(error,stdout,stderr)=>resolve({code:error?error.code??null:0,signal:error?.signal,stdout,stderr}));
   child.stdin.end();
  });
  console.log(JSON.stringify({records,exit:result.code,signal:result.signal,launchAllowed:gateway.receipt.launchAllowed}));
  assert.ok(records.length>0,`No request forwarded to fake upstream; exit=${result.code}; stderr=${result.stderr.slice(0,400)}`);
  assert.ok(records.every(r=>r.model==='claude-fable-5-1'&&r.mainOnlyCredential&&!r.containsLocalBearer&&!r.headerNames.includes('x-api-key')));
  assert.ok(result.signal==null);assert.notEqual(result.code,0);
  assert.doesNotMatch(result.stdout+result.stderr,/synthetic-main-only-oauth/);
  assert.ok(!fs.readFileSync(join(profile.providerHome,'.credentials.json'),'utf8').includes('synthetic-main-only-oauth'));
  assert.equal(gateway.receipt.launchAllowed,false);
 }finally{if(gateway)await gateway.close();await fs.promises.unlink(binary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
});
