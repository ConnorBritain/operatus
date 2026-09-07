'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFile } = require('node:child_process');
const load = require('./load-ts.cjs');
const { prepareSubscriptionProfile } = load('src/main/subscriptionProfile.ts');
const { prepareSubscriptionSandbox } = load('src/main/subscriptionSandbox.ts');
const mac = { skip:process.platform !== 'darwin' };
async function fixture(role='critic') {
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'operatus-provider-boundary-')));
  const artifact=join(root,'artifact');fs.mkdirSync(artifact);fs.mkdirSync(join(artifact,'.git'));
  fs.writeFileSync(join(artifact,'evidence.txt'),'evidence-ok');
  fs.writeFileSync(join(artifact,'.git','HEAD'),'git-must-survive');
  const secret=join(root,'ambient-api-key');fs.writeFileSync(secret,'synthetic-secret-must-not-leak');
  fs.symlinkSync(secret,join(artifact,'escape'));
  const profile=await prepareSubscriptionProfile(root,'claude');
  const input={artifact,profile,executable:'/bin/bash',role};
  const boundary=prepareSubscriptionSandbox(input);
  const run=command=>new Promise(resolve=>execFile(boundary.command,[...boundary.args,'--noprofile','--norc','-c',command],
    {cwd:artifact,env:profile.env,timeout:3000,encoding:'utf8',maxBuffer:16384},(error,stdout,stderr)=>resolve({code:error?.code??0,stdout,stderr})));
  return {root,artifact,secret,profile,boundary,input,run};
}
test('provider boundary rejects unsupported platform before touching caller paths',()=>{
  assert.throws(()=>prepareSubscriptionSandbox({},'win32'),/unavailable/);
});
test('actual Critic process can read artifact evidence but cannot mutate it or read ambient credentials',mac,async()=>{
  const f=await fixture();
  assert.match((await f.run('cat evidence.txt')).stdout,/evidence-ok/);
  for(const command of ['printf changed > evidence.txt','touch created.txt','rm evidence.txt',`cat '${f.secret}'`,'cat escape',`printf changed > '${f.secret}'`]) {
    const result=await f.run(command);assert.notEqual(result.code,0,command);assert.doesNotMatch(result.stdout,/synthetic-secret/);
  }
  assert.equal(fs.readFileSync(join(f.artifact,'evidence.txt'),'utf8'),'evidence-ok');
  assert.equal(f.boundary.receipt.launchAllowed,false);
});
test('actual Implementer writes working files but cannot replace settings, alter Git metadata, or escape via symlink',mac,async()=>{
  const f=await fixture('implementer');const before=fs.readFileSync(f.profile.configPath,'utf8');
  assert.equal((await f.run('printf changed > evidence.txt && mkdir src && printf code > src/new.txt')).code,0);
  for(const command of ['printf changed > .git/HEAD','rm -r .git',`printf altered > '${f.profile.configPath}'`,
    `rm '${f.profile.configPath}'`,`mv '${f.profile.providerHome}' '${f.profile.providerHome}-moved'`,'printf leak > escape']) {
    assert.notEqual((await f.run(command)).code,0,command);
  }
  assert.equal(fs.readFileSync(f.profile.configPath,'utf8'),before);
  assert.equal(fs.readFileSync(join(f.artifact,'.git','HEAD'),'utf8'),'git-must-survive');
  assert.equal(fs.readFileSync(f.secret,'utf8'),'synthetic-secret-must-not-leak');
  assert.equal((await f.run(`printf runtime > '${f.profile.providerHome}/runtime-cache'`)).code,0,'provider can create runtime state without replacing protected config');
});
test('child processes inherit offline boundary and cannot contact even a local listener',mac,async()=>{
  const net=require('node:net');let connections=0;
  const server=net.createServer(socket=>{connections++;socket.destroy();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const f=await fixture();const result=await f.run(`/bin/bash --noprofile --norc -c 'exec 3<>/dev/tcp/127.0.0.1/${server.address().port}'`);
    assert.notEqual(result.code,0);assert.equal(connections,0);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('hard links cannot turn protected provider configuration or Git metadata into writable aliases',mac,async()=>{
  const f=await fixture('implementer');const before=fs.readFileSync(f.profile.configPath,'utf8');
  assert.notEqual((await f.run(`ln '${f.profile.configPath}' alias-settings && printf changed > alias-settings`)).code,0);
  assert.equal(fs.readFileSync(f.profile.configPath,'utf8'),before);
  assert.notEqual((await f.run('ln .git/HEAD alias-head && printf changed > alias-head')).code,0);
  assert.equal(fs.readFileSync(join(f.artifact,'.git','HEAD'),'utf8'),'git-must-survive');
});
test('writable profiles, artifacts and executable roots must not overlap',mac,async()=>{
  const f=await fixture();
  assert.throws(()=>prepareSubscriptionSandbox({...f.input,artifact:f.root}),/overlap/);
  assert.throws(()=>prepareSubscriptionSandbox({...f.input,executable:join(f.artifact,'evidence.txt')}),/overlap/);
  assert.throws(()=>prepareSubscriptionSandbox({...f.input,role:'unknown'}),/unsupported/);
});
test('optional local gateway permits its port only, including for child tools',mac,async()=>{
  const http=require('node:http');let allowed=0,denied=0;
  const gateway=http.createServer((_q,r)=>{allowed++;r.end('local-only');});
  const unrelated=http.createServer((_q,r)=>{denied++;r.end('must-not-reach');});
  await Promise.all([gateway,unrelated].map(s=>new Promise(r=>s.listen(0,'127.0.0.1',r))));
  try {
    const f=await fixture();
    for(const port of [0,-1,65536,1.5,NaN,'80']) assert.throws(()=>prepareSubscriptionSandbox({...f.input,providerBrokerPort:port}),/invalid provider broker port/);
    const boundary=prepareSubscriptionSandbox({...f.input,providerBrokerPort:gateway.address().port});
    const run=(host,port)=>new Promise(resolve=>execFile(boundary.command,[...boundary.args,'--noprofile','--norc','-c',
      `exec 3<>/dev/tcp/${host}/${port} || exit 1; printf 'GET / HTTP/1.0\r\nHost: localhost\r\n\r\n' >&3; /bin/cat <&3`],
      {cwd:f.artifact,env:f.profile.env,timeout:3000,encoding:'utf8'},(e,stdout,stderr)=>resolve({code:e?e.code??null:0,stdout,stderr})));
    const response=await run('127.0.0.1',gateway.address().port);
    assert.equal(response.code,0,response.stderr);assert.match(response.stdout,/local-only/);
    assert.notEqual((await run('127.0.0.1',unrelated.address().port)).code,0);
    assert.notEqual((await run('192.0.2.1',80)).code,0);
    assert.equal(allowed,1);assert.equal(denied,0);
    assert.equal(boundary.receipt.network,'scoped-local-gateways-only');assert.equal(boundary.receipt.launchAllowed,false);
  } finally {await Promise.all([gateway,unrelated].map(s=>new Promise(r=>s.close(r))));}
});
test('Codex companion grants only the exact read-only sibling, never its containing directory',mac,async()=>{
  const f=await fixture();
  const profile=await prepareSubscriptionProfile(f.root,'codex');
  const executable=join(f.root,'codex'),companion=join(f.root,'codex-code-mode-host');
  fs.writeFileSync(executable,'identity-placeholder',{mode:0o500});
  fs.writeFileSync(companion,'pinned-companion-fixture',{mode:0o500});
  const input={artifact:f.artifact,profile,executable,role:'critic',codexCodeModeHost:companion};
  const boundary=prepareSubscriptionSandbox(input);
  // Exercise the generated policy with the system shell; actual pinned native
  // companion execution is covered separately by codex-native-tools.test.cjs.
  const run=command=>new Promise(resolve=>execFile(boundary.command,[...boundary.args.slice(0,-1),'/bin/bash','--noprofile','--norc','-c',command],
    {cwd:f.artifact,env:profile.env,timeout:3000,encoding:'utf8',maxBuffer:16384},(error,stdout,stderr)=>resolve({code:error?(error.code??error.signal??'unknown'):0,stdout,stderr})));
  const read=await run(`/bin/cat '${companion}'`);assert.equal(read.code,0,JSON.stringify(read));
  assert.equal(read.stdout,'pinned-companion-fixture');
  for(const command of [`/bin/cat '${f.secret}'`,`/bin/chmod 700 '${companion}'`,`/usr/bin/touch '${companion}'`]) {
    const result=await run(command);assert.notEqual(result.code,0,command);assert.doesNotMatch(result.stdout,/synthetic-secret/);
  }
  assert.equal(fs.readFileSync(companion,'utf8'),'pinned-companion-fixture');
  assert.equal(fs.statSync(companion).mode&0o777,0o500);
  assert.throws(()=>prepareSubscriptionSandbox({...input,profile:f.profile}),/invalid Codex/);
  assert.throws(()=>prepareSubscriptionSandbox({...input,executable:companion}),/invalid Codex/);
  assert.throws(()=>prepareSubscriptionSandbox({...input,codexCodeModeHost:f.secret}),/invalid Codex/);
  assert.throws(()=>prepareSubscriptionSandbox({...input,codexCodeModeHost:''}),/invalid sandbox path/);
  const other=join(f.root,'other');fs.mkdirSync(other);fs.writeFileSync(join(other,'codex-code-mode-host'),'other');
  assert.throws(()=>prepareSubscriptionSandbox({...input,codexCodeModeHost:join(other,'codex-code-mode-host')}),/invalid Codex/);
  const writable=join(profile.home,'codex-code-mode-host');fs.writeFileSync(writable,'writable');
  fs.writeFileSync(join(profile.home,'codex'),'writable');
  assert.throws(()=>prepareSubscriptionSandbox({...input,executable:join(profile.home,'codex'),codexCodeModeHost:writable}),/invalid Codex/);
  const alias=join(f.root,'alias');fs.symlinkSync(companion,alias);
  assert.throws(()=>prepareSubscriptionSandbox({...input,codexCodeModeHost:alias}),/invalid Codex/);
  assert.equal(boundary.receipt.network,'denied');assert.equal(boundary.receipt.launchAllowed,false);
});
