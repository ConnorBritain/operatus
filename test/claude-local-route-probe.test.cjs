'use strict';
// Opt-in, pinned native CLI; only synthetic credentials and a rejecting local
// server. No request is forwarded. This is NOT successful auth or inference.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs');
const {join}=require('node:path'),{tmpdir}=require('node:os'),{execFile}=require('node:child_process');
const load=require('./load-ts.cjs');
const {prepareSubscriptionProfile}=load('src/main/subscriptionProfile.ts');
const {prepareSubscriptionSandbox}=load('src/main/subscriptionSandbox.ts');
const {copyPinnedNativeExecutable}=load('src/main/executableIdentity.ts');
test('native Claude subscription-shaped route reaches only a rejecting local observer',{
 skip:process.platform!=='darwin'||!process.env.OPERATUS_CLAUDE_PROBE_PATH,timeout:45000
},async t=>{
 const disk=fs.statfsSync(tmpdir()),size=fs.statSync(process.env.OPERATUS_CLAUDE_PROBE_PATH).size;
 if(disk.bavail*disk.bsize<size+256*1024*1024){t.skip('Insufficient free space for native copy plus 256 MiB reserve');return;}
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'op-claude-route-'))),binary=join(root,'claude');
 const records=[];
 const server=http.createServer((request,response)=>{
  let body='';request.on('data',chunk=>{body+=chunk;if(body.length>1024*1024)request.destroy();});
  request.on('end',()=>{
   let data;try{data=JSON.parse(body);}catch{}
   records.push({path:request.url,method:request.method,headerNames:Object.keys(request.headers).sort(),
    authKind:request.headers.authorization?.startsWith('Bearer ')?'bearer':request.headers.authorization?'other':'none',
    syntheticBearer:request.headers.authorization==='Bearer synthetic-only-not-a-real-access-token',
    apiKeyPresent:!!request.headers['x-api-key'],model:data?.model,bodyKeys:data?Object.keys(data).sort():[]});
   response.writeHead(401,{'content-type':'application/json'});response.end(JSON.stringify({type:'error',error:{type:'authentication_error',message:'Offline synthetic route probe refuses all requests'}}));
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  await copyPinnedNativeExecutable(process.env.OPERATUS_CLAUDE_PROBE_PATH,binary,process.env.OPERATUS_CLAUDE_PROBE_SHA256);
  const profile=await prepareSubscriptionProfile(root,'claude'),artifact=join(root,'artifact');fs.mkdirSync(artifact);
  fs.copyFileSync(join(__dirname,'fixtures/subscription-claude-synthetic.json'),join(profile.providerHome,'.credentials.json'));
  fs.chmodSync(join(profile.providerHome,'.credentials.json'),0o600);
  const boundary=prepareSubscriptionSandbox({artifact,profile,executable:binary,role:'critic',providerBrokerPort:server.address().port});
  const result=await new Promise(resolve=>{const child=execFile(boundary.command,[...boundary.args,...profile.args,'--print','--model','claude-fable-5-1',
   '--output-format','json','--max-turns','1','Reply with the word probe. Do not use tools.'],{
    cwd:artifact,env:{...profile.env,ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,CLAUDE_CODE_SUBPROCESS_ENV_SCRUB:'1'},
    encoding:'utf8',timeout:25000,killSignal:'SIGKILL',maxBuffer:32768
   },(e,stdout,stderr)=>resolve({code:e?e.code??null:0,signal:e?.signal,stdout,stderr}));child.stdin.end();});
  console.log(JSON.stringify({records,exit:result.code,signal:result.signal,launchAllowed:false}));
  assert.ok(records.some(r=>r.path==='/v1/messages?beta=true'&&r.method==='POST'&&r.syntheticBearer&&r.model==='claude-fable-5-1'&&!r.apiKeyPresent),
   `no subscription-shaped message reached local observer; exit=${result.code}, stdout=${result.stdout.slice(0,800)}, stderr=${result.stderr.slice(0,800)}`);
  assert.ok(records.every(r=>!r.apiKeyPresent&&(r.authKind==='none'||r.syntheticBearer)));
  assert.ok(result.signal==null,'CLI must exit normally after rejection, not be killed');assert.notEqual(result.code,0);
  assert.equal(boundary.receipt.launchAllowed,false);
 }finally{
  await fs.promises.unlink(binary).catch(e=>{if(e.code!=='ENOENT')throw e;});server.closeAllConnections();await new Promise(r=>server.close(r));
 }
});
