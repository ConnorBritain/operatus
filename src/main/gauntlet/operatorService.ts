import { createHash } from 'node:crypto';
import { isAbsolute, relative, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import type { LocalGauntletBackend } from './localBackend';
import type { IsolatedGauntletRunner } from './isolatedRunner';
import type { GauntletRunSnapshot, StartGauntletInput } from '../../shared/gauntlet';
import { codexConductorModel } from '../../shared/codexConductor';

export interface OperatorPolicy { enabled: true; repositoryRoots: string[] }
const terminal = (s: GauntletRunSnapshot) => ['passed','human_required','cancelled','infrastructure_failure'].includes(s.run.status);
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw Error('Invalid operator arguments');
  return value as Record<string, unknown>;
}
function str(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error(`Invalid ${name}`);
  return value;
}
function runId(value: unknown): string {
  const id = str(value,'runId',36);
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw Error('Invalid runId');
  return id;
}

/** Explicit output projection: never expose launch tokens, token hashes,
 * profiles, auth data or arbitrary filesystem reads through this interface. */
export function operatorSnapshot(s: GauntletRunSnapshot, evidence = false) {
  return {
    run: s.run,
    launches: s.launches.map(l => ({ id:l.id,role:l.role,provider:l.provider,model:l.model,
      sessionId:l.sessionId,status:l.status,expectedSha:l.expectedSha,createdAt:l.createdAt })),
    ...(evidence ? {artifacts:s.artifacts,reports:s.reports,acknowledgments:s.acknowledgments,
      repairPackets:s.repairPackets,events:s.events,runtimeObservations:s.runtimeObservations,skillLock:s.skillLock} : {})
  };
}

export function createOperatorService(input: {
  policy: OperatorPolicy; backend: LocalGauntletBackend; runner: IsolatedGauntletRunner;
  hold(): string | null; publish(s: GauntletRunSnapshot): unknown;
  conductor(): StartGauntletInput['providers'];
}) {
  const roots = input.policy.repositoryRoots.map(p => {
    if (!isAbsolute(p)) throw Error('Operator repository roots must be absolute');
    return realpathSync(p);
  });
  function allowed(path: string): string {
    if (!isAbsolute(path)) throw Error('Repository must be absolute');
    const canonical = realpathSync(path);
    if (!roots.some(root => { const r=relative(root,canonical); return r==='' || (!r.startsWith(`..${sep}`) && r!=='..' && !isAbsolute(r)); })) {
      throw Error('Repository is outside the configured operator roots');
    }
    return canonical;
  }
  return (method: string, args: unknown): unknown => {
    if (!input.policy.enabled) throw Error('Operator MCP is disabled');
    if (method === 'operatus_status') {
      object(args,[]);
      return { schema:1, platform:process.platform, hold:input.hold(), capacity:input.runner.capacity(),
        repositoryRoots:roots, runtime:'local-desktop', authority:'operator-only', billing:'subscription-only' };
    }
    if (method === 'operatus_runs') {
      const a=object(args,['repository']);
      const repository=a.repository===undefined ? undefined : allowed(str(a.repository,'repository',4096));
      const runs=input.backend.list();
      return {runs:runs.filter(r=>!repository || r.repository===repository),limit:100,
        note:'Bounded recent-run view plus app attention projections; not a complete historical export.'};
    }
    if (method === 'operatus_run') {
      const a=object(args,['runId','evidence']);
      if (a.evidence!==undefined && typeof a.evidence!=='boolean') throw Error('Invalid evidence flag');
      return operatorSnapshot(input.backend.status(runId(a.runId)),a.evidence===true);
    }
    if (method === 'operatus_start') {
      const a=object(args,['requestId','repository','objective','baseSha','conductorProvider','conductorModel']);
      const requestId=str(a.requestId,'requestId',128);
      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw Error('Use an 8–128 character stable requestId');
      const requestedRepository=allowed(str(a.repository,'repository',4096));
      // Git may discover a parent checkout. Check the actual root too, rather
      // than letting an allowed non-repository directory widen authority.
      const repository=allowed(input.backend.workspaces.resolveRepository(requestedRepository));
      const objective=str(a.objective,'objective',16000);
      const baseSha=str(a.baseSha,'baseSha',40);
      if(!/^[a-f0-9]{40}$/.test(baseSha))throw Error('baseSha must be a full 40-character Git commit');
      if(a.conductorProvider!==undefined && !['claude','codex'].includes(String(a.conductorProvider)))throw Error('Unsupported Conductor provider');
      if(a.conductorModel!==undefined)str(a.conductorModel,'conductorModel',128);
      if(a.conductorModel!==undefined && a.conductorProvider===undefined)throw Error('Specify provider when selecting a model');
      // Digest caller intent, not mutable defaults or live HEAD, for stable retries.
      const intent={repository,objective,baseSha,conductorProvider:a.conductorProvider??null,conductorModel:a.conductorModel??null};
      const digest=createHash('sha256').update(JSON.stringify(intent)).digest('hex');
      const receipt=input.backend.store.operatorStart(requestId,digest,()=>{
        const held=input.hold();if(held)throw Error(held);
        const providers=input.conductor();
        if(a.conductorProvider) {
          const provider=a.conductorProvider as 'claude'|'codex';
          providers!.conductor={provider,model:provider==='codex' ? codexConductorModel(a.conductorModel as string|undefined) : a.conductorModel as string|undefined};
        }
        return input.backend.start({repository,objective,baseRef:baseSha,providers}).run.id;
      });
      if(!receipt.replayed) {
        const failed=()=>{
          try {
            const s=input.backend.status(receipt.runId);
            if(!terminal(s))input.publish(input.backend.infrastructureFailure(receipt.runId,'Local MCP dispatch failed; inspect runtime before retrying',false));
          } catch { /* app teardown: durable start receipt remains inspectable */ }
        };
        try {input.publish(input.backend.status(receipt.runId));void input.runner.advance(receipt.runId).catch(failed);}catch{failed();}
      }
      return {...receipt,...operatorSnapshot(input.backend.status(receipt.runId))};
    }
    if(method==='operatus_cancel') {
      const a=object(args,['runId','expectedVersion','repository','reason']);
      const id=runId(a.runId),repository=allowed(str(a.repository,'repository',4096)),reason=str(a.reason,'reason',1000);
      if(!Number.isSafeInteger(a.expectedVersion) || Number(a.expectedVersion)<0)throw Error('Invalid expectedVersion');
      const s=input.backend.status(id);
      if(s.run.repository!==repository)throw Error('Run/repository mismatch');
      if(s.run.status==='cancelled')return operatorSnapshot(s);
      if(s.run.version!==a.expectedVersion)throw Error('Run changed; inspect it again before cancelling');
      if(terminal(s))throw Error('Cannot cancel a terminal run');
      const next=input.backend.cancel(id,`Local MCP operator: ${reason}`);input.publish(next);
      return operatorSnapshot(next);
    }
    throw Error('Unknown operator tool; role authority is not exposed');
  };
}
