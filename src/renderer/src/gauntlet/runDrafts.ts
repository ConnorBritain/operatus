import type { GauntletRun, OperatorPriority } from '@shared/gauntlet';

export interface RunDraft {
  handoff: { note:string; basis:{version:number;sha:string|null}|null; edit:number };
  review: { note:string; basis:{version:number;sequence:number}|null; edit:number };
  priority: { level:OperatorPriority['level']; note:string; revision:number; edit:number; edited:boolean };
}

/** UI-only, lifetime of the Runs surface. Never persists or changes authority.
 * Shared across detail remounts, but keyed by both run and repository. */
export class RunDrafts {
  private readonly entries = new Map<string,RunDraft>();
  private readonly listeners = new Map<string,Set<()=>void>>();
  private key(run: Pick<GauntletRun,'id'|'repository'>): string { return JSON.stringify([run.id,run.repository]); }

  read(run: GauntletRun): RunDraft {
    const key = this.key(run);
    let draft = this.entries.get(key);
    if (!draft) {
      draft = {review:{note:'',basis:null,edit:0},handoff:{note:'',basis:null,edit:0},
        priority:{level:run.operatorPriority?.level ?? 'normal',note:'',revision:run.operatorPriority?.revision ?? 0,edit:0,edited:false}};
      this.entries.set(key,draft);
    }
    return draft;
  }

  subscribe(run: GauntletRun, notify:()=>void): ()=>void {
    const key = this.key(run), listeners = this.listeners.get(key) ?? new Set<()=>void>();
    listeners.add(notify);this.listeners.set(key,listeners);
    return ()=>{listeners.delete(notify);if(!listeners.size)this.listeners.delete(key);};
  }

  private write(run: GauntletRun, draft: RunDraft): void {
    const key = this.key(run);this.entries.set(key,draft);
    for (const notify of this.listeners.get(key) ?? []) notify();
  }

  review(run: GauntletRun, note: string): void {
    const draft = this.read(run);
    this.write(run,{...draft,review:{note,basis:{version:run.version,sequence:run.runtimeAttention?.sequence ?? 0},edit:draft.review.edit+1}});
  }

  handoff(run: GauntletRun, note: string): void {
    const draft = this.read(run);
    this.write(run,{...draft,handoff:{note,basis:{version:run.version,sha:run.currentArtifactSha},edit:draft.handoff.edit+1}});
  }

  clearHandoff(run: GauntletRun, savedEdit: number): boolean {
    const draft = this.read(run);
    if (draft.handoff.edit !== savedEdit) return false;
    this.write(run,{...draft,handoff:{note:'',basis:null,edit:savedEdit+1}});return true;
  }

  priority(run: GauntletRun, patch: Partial<Pick<RunDraft['priority'],'level'|'note'>>): void {
    const draft = this.read(run);
    this.write(run,{...draft,priority:{...draft.priority,
      level:draft.priority.edited ? draft.priority.level : run.operatorPriority?.level ?? 'normal',
      ...patch,revision:run.operatorPriority?.revision ?? 0,edit:draft.priority.edit+1,edited:true}});
  }

  clearReview(run: GauntletRun, savedEdit: number): boolean {
    const draft = this.read(run);
    if (draft.review.edit !== savedEdit) return false;
    this.write(run,{...draft,review:{note:'',basis:null,edit:savedEdit+1}});return true;
  }

  clearPriority(run: GauntletRun, savedEdit: number): boolean {
    const draft = this.read(run);
    if (draft.priority.edit !== savedEdit) return false;
    this.write(run,{...draft,priority:{...draft.priority,note:'',edit:savedEdit+1,edited:false}});return true;
  }
}
