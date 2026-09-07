'use strict';
// Explicitly live, bounded authentication/startup probe. Not a Gauntlet verdict.
// Uses the production factory, account checks, transport and native sandbox.
const fs = require('node:fs');
const net = require('node:net');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID, randomBytes } = require('node:crypto');
const load = require('../test/load-ts.cjs');

async function main() {
  const provider = process.argv[3];
  if (process.argv[2] !== '--live' || !['claude','codex'].includes(provider) || process.platform !== 'darwin') {
    throw Error('Usage: ELECTRON_RUN_AS_NODE=1 electron tools/smoke-subscription-startup.cjs --live claude|codex');
  }
  const { createIsolatedProviderFactory } = load('src/main/gauntlet/isolatedProviderFactory.ts');
  const { isolatedGauntletLaunchError } = load('src/shared/billingPolicy.ts');
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'op-live-startup-')));
  const artifact = join(root,'artifact'), evidence = join(root,'evidence');
  fs.mkdirSync(artifact); fs.mkdirSync(evidence);
  const receiptPath = join(root,'receipt.json'), journalPath = join(root,'admission.jsonl');
  const socketPath = join(root,'control.sock');
  // This probe grants no run commands. Any attempted helper connection closes.
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(socketPath,resolve); });
  let handle, result;
  const append = entry => fs.appendFileSync(journalPath,JSON.stringify(entry)+'\n',{mode:0o600});
  const write = value => fs.writeFileSync(receiptPath,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  try {
    const factory = createIsolatedProviderFactory({ root:join(root,'profiles'),
      helperSource:join(__dirname,'../resources/operatus-gauntlet.cjs'),nodePath:process.execPath,
      socketPath:()=>socketPath,reviewEvidenceRoot:evidence,
      assertAdmissionOpen:()=>{const error=isolatedGauntletLaunchError(process.platform);if(error)throw Error(error);} });
    const launch = { id:randomUUID(),runId:randomUUID(),sessionId:randomUUID(),provider,
      role:provider==='claude'?'implementer':'critic',model:provider==='claude'?'claude-fable-5-1':'gpt-5.6-sol',
      worktreePath:artifact,reviewEvidence:{directory:evidence} };
    const input = {launch,token:randomBytes(32).toString('base64url'),
      prompt:'This is only a subscription CLI startup connectivity check. Do not use any tools, read files, or make changes. Reply with exactly OPERATUS_SUBSCRIPTION_READY.'};
    handle = await factory.worker(input,new AbortController().signal,()=>{},()=>({timeoutMs:90000}),()=>{},append,append);
    const exit = await handle.completion;
    result = {kind:'live-cli-startup-only',provider,model:launch.model,realInference:true,
      launchId:launch.id,sessionId:launch.sessionId,status:exit.status,reason:exit.reason,
      processExited:exit.processExited,gatewayRevocation:exit.gatewayRevocation,
      responseMarkerObserved:exit.stdout.includes('OPERATUS_SUBSCRIPTION_READY'),
      threadId:exit.threadId??null,turnId:exit.turnId??null};
    write(result);
    console.log(JSON.stringify({...result,receiptPath}));
    if(exit.status!=='completed' || !result.responseMarkerObserved) process.exitCode=1;
  } catch(error) {
    result={kind:'live-cli-startup-only',provider,status:'not-started-or-failed',reason:String(error.message)};
    write(result);console.log(JSON.stringify({...result,receiptPath}));process.exitCode=1;
  } finally {
    handle?.stop(); if(handle) await handle.completion;
    await new Promise(resolve=>server.close(resolve));
    // Keep the small diagnostic receipts/profile. Remove only this probe's
    // pinned binary copies after the runtime confirms process exit/revocation.
    if(result?.processExited && result.gatewayRevocation==='confirmed') {
      const profiles=join(root,'profiles');
      for(const entry of fs.readdirSync(profiles,{withFileTypes:true})) {
        if(!entry.isDirectory() || !entry.name.startsWith('native-'))continue;
        for(const name of ['claude','codex','codex-code-mode-host']) {
          const file=join(profiles,entry.name,name);if(fs.existsSync(file))fs.unlinkSync(file);
        }
      }
    }
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
