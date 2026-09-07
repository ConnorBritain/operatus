import type { GauntletRun } from './gauntlet';

/** A pass is not delivery. Keep the result in the operator's inbox until an
 * explicit disposition covers this exact candidate. Runtime warnings are separate. */
export function needsCandidateHandoff(run: GauntletRun): boolean {
  return run.status === 'passed' && (!run.currentArtifactSha ||
    !/^[a-f0-9]{40}$/.test(run.currentArtifactSha) ||
    !run.candidateHandoff?.reviewed || run.candidateHandoff.artifactSha !== run.currentArtifactSha);
}
