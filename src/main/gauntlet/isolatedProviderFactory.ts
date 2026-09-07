import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,stat,statfs,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createIsolatedClaudeFactory} from './isolatedClaudeFactory';
import {CodexAccountAdmission} from '../codexAccountAdmission';
import {CodexFreshSessionRuntime} from '../codexFreshSession';
import {openCodexSubscriptionGateway} from '../codexSubscriptionGateway';
import {codexSubscriptionTransport} from '../codexSubscriptionTransport';
import {inspectSubscriptionSetup} from '../subscriptionPreflight';
import {copyPinnedNativeExecutable,hashExecutable} from '../executableIdentity';
import {prepareSubscriptionProfile} from '../subscriptionProfile';
import {prepareControlClient} from './controlClient';
import {prepareIsolatedSkills} from './isolatedSkills';
import {codexSubscriptionEvidence} from './subscriptionEvidence';
import type {IsolatedSessionFactory} from './isolatedRunner';
import type {PreparedLaunch} from './localBackend';
import {codexConductorModel} from '../../shared/codexConductor';

const CODEX_SHA='a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629';
const HOST_SHA='fdd977821def000939dd48da48b39d581845470671135bd4642584eeb0762a6b';
const MODEL='gpt-5.6-sol';

/** Main-only composition, still behind the global subscription hold. No CLI,
 * account lookup or filesystem preparation occurs during construction. */
export function createIsolatedProviderFactory(input:Parameters<typeof createIsolatedClaudeFactory>[0], dependencies:{
  claude?:Parameters<typeof createIsolatedClaudeFactory>[1];
  codex?:{account?:CodexAccountAdmission;inspect?:typeof inspectSubscriptionSetup;
    gateway?:(input:Parameters<typeof openCodexSubscriptionGateway>[0],prepared:PreparedLaunch)=>ReturnType<typeof openCodexSubscriptionGateway>};
}={}):IsolatedSessionFactory {
  const claude=createIsolatedClaudeFactory(input,dependencies.claude);
  const account=dependencies.codex?.account ?? new CodexAccountAdmission();
  const runtime=new CodexFreshSessionRuntime();
  let pinned:Promise<{executable:string;codeModeHost:string}>|undefined;
  const binaries=()=>pinned ??= (async()=>{
    const inspected=await (dependencies.codex?.inspect ?? inspectSubscriptionSetup)('codex');
    const match=inspected.executables.find(item=>item.sha256===CODEX_SHA &&
      item.versionObservation.status==='reported' && item.versionObservation.version==='0.153.4');
    if(!match) throw Error('The verified native Codex pilot executable is unavailable; no fallback was launched');
    const sourceHost=join(dirname(match.path),'codex-code-mode-host');
    if(await hashExecutable(sourceHost)!==HOST_SHA) throw Error('The verified Codex companion is unavailable');
    await mkdir(input.root,{recursive:true,mode:0o700});
    const space=await statfs(input.root),sizes=await Promise.all([stat(match.path),stat(sourceHost)]);
    const required=sizes.reduce((sum,item)=>sum+item.size,256*1024*1024);
    if(!Number.isFinite(space.bavail*space.bsize) || space.bavail*space.bsize<required) throw Error('Insufficient space for pinned Codex and diagnostic reserve');
    const directory=await mkdtemp(join(input.root,'native-codex-'));
    const executable=join(directory,'codex'),codeModeHost=join(directory,'codex-code-mode-host');
    await copyPinnedNativeExecutable(match.path,executable,CODEX_SHA);
    await copyPinnedNativeExecutable(sourceHost,codeModeHost,HOST_SHA);
    return {executable,codeModeHost};
  })();
  async function prepareCodex(...[prepared,signal,beforeSpawn,_budget,_onActivity,onAdmission,onIdentity]:Parameters<IsolatedSessionFactory['worker']>) {
      input.assertAdmissionOpen();signal.throwIfAborted();beforeSpawn();
      const launch=prepared.launch;
      const conductor=launch.role==='conductor';
      if(process.platform!=='darwin' || launch.provider!=='codex' || (!conductor && (launch.role!=='critic' ||
        (launch.model && launch.model!==MODEL) || !launch.reviewEvidence?.directory))) {
        throw Error('This isolated Codex pilot requires the inspected macOS Critic model and exact review evidence; no fallback is allowed');
      }
      const model=conductor ? codexConductorModel(launch.model) : MODEL;
      if(typeof onAdmission!=='function' || typeof onIdentity!=='function') throw Error('Durable subscription and native identity writers are required');
      if(!/^[a-f0-9-]{36}$/i.test(launch.runId)) throw Error('Invalid run identity');
      const native=await binaries();signal.throwIfAborted();input.assertAdmissionOpen();beforeSpawn();
      const profile=await prepareSubscriptionProfile(input.root,'codex',launch.role);
      const guidance=prepareIsolatedSkills({lock:prepared.skillLock,runId:launch.runId,launchId:launch.id,role:launch.role,providerHome:profile.providerHome,depot:input.skills});
      const reviewEvidenceDirectory=conductor ? join(input.reviewEvidenceRoot,launch.runId) : launch.reviewEvidence!.directory;
      if(conductor) await mkdir(reviewEvidenceDirectory,{recursive:true,mode:0o700});
      const client=prepareControlClient({profile,helperSource:input.helperSource,
        expectedHelperSha256:createHash('sha256').update(await readFile(input.helperSource)).digest('hex'),
        nodePath:input.nodePath,socketPath:input.socketPath(),token:prepared.token});
      signal.throwIfAborted();input.assertAdmissionOpen();beforeSpawn();
      const admitted=await account.verify();
      if(!admitted.ok) throw Error(`Codex subscription admission failed: ${admitted.reason}`);
      let gateway:Awaited<ReturnType<typeof openCodexSubscriptionGateway>>|undefined;
      try {
        signal.throwIfAborted();input.assertAdmissionOpen();beforeSpawn();
        const config={account,identity:admitted.receipt,model,transport:codexSubscriptionTransport,maxRequests:512};
        gateway=await (dependencies.codex?.gateway ? dependencies.codex.gateway(config,prepared) : openCodexSubscriptionGateway(config));
        // Local routing hints only; no real account identity, access/refresh
        // token, API key or global config enters the provider home.
        await writeFile(join(profile.providerHome,'auth.json'),JSON.stringify({auth_mode:'chatgpt',OPENAI_API_KEY:null,
          tokens:{id_token:gateway.localToken,access_token:gateway.localToken,refresh_token:'invalid-local-refresh',account_id:gateway.localAccountId},
          last_refresh:new Date().toISOString()}),{flag:'wx',mode:0o400});
        if(await hashExecutable(native.executable)!==CODEX_SHA || await hashExecutable(native.codeModeHost)!==HOST_SHA) throw Error('Private Codex executable identity changed');
        signal.throwIfAborted();input.assertAdmissionOpen();beforeSpawn();
        const result:unknown=onAdmission(codexSubscriptionEvidence(admitted.receipt,{version:'0.153.4',sha256:CODEX_SHA,companionSha256:HOST_SHA,
          model,source:dependencies.codex && Object.keys(dependencies.codex).length ? 'injected-dependencies' : 'provider-metadata'}));
        if(result && typeof (result as {then?:unknown}).then==='function') {
          void Promise.resolve(result).catch(()=>{});throw Error('Subscription evidence must be persisted synchronously');
        }
        signal.throwIfAborted();input.assertAdmissionOpen();beforeSpawn();
        return {...native,profile,controlClient:client.capability,gateway,model,
          launchId:launch.id,sessionId:launch.sessionId,artifact:launch.worktreePath,reviewEvidenceDirectory,
          guidance,onIdentity:(identity:{threadId:string;turnId:string|null})=>onIdentity({type:'native_identity',provider:'codex',...identity})};
      } catch(error) {await gateway?.close();throw error;}
      finally {account.revoke(admitted.receipt);}
  }
  return {
    supportsLockedSkills:true,supportsCodexCritic:true,supportsCodexConductor:true,
    async conductor(...args) {
      const [prepared,signal,beforeSpawn,budget,onActivity]=args;
      input.assertAdmissionOpen();signal.throwIfAborted();beforeSpawn();
      if(prepared.launch.provider==='claude') return claude.conductor(...args);
      if(prepared.launch.role!=='conductor') throw Error('Expected Conductor launch');
      const common=await prepareCodex(...args);
      try {
        input.assertAdmissionOpen();signal.throwIfAborted();beforeSpawn();
        return {...runtime.startConductor({...common,role:'conductor',...budget(),maxMessages:64,onActivity}),
          orientationPrompt:prepared.prompt+common.guidance};
      } catch(error) {await common.gateway.close();throw error;}
    },
    async worker(...args) {
      const [prepared,signal,beforeSpawn,budget,onActivity]=args;
      input.assertAdmissionOpen();signal.throwIfAborted();beforeSpawn();
      if(prepared.launch.provider==='claude') return claude.worker(...args);
      if(prepared.launch.role!=='critic') throw Error('Codex workers require Critic role; no fallback is allowed');
      const common=await prepareCodex(...args);
      try {
        input.assertAdmissionOpen();signal.throwIfAborted();beforeSpawn();
        return runtime.start({...common,role:'critic',prompt:prepared.prompt+common.guidance,timeoutMs:budget().timeoutMs,onActivity});
      } catch(error) {await common.gateway.close();throw error;}
    },
  };
}
