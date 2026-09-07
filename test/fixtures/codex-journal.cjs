'use strict';
const { randomUUID } = require('node:crypto');
const load = require('../load-ts.cjs');
const { createGauntletRun, freezeContract } = load('src/main/gauntlet/core.ts');

// Synthetic preceding protocol stages. This fixture is not implementation or
// model acceptance; it lets actual native identities exercise the real journal.
module.exports = function codexJournal(store, repository = '/fixture') {
  const run = createGauntletRun({repository,objective:'Inspect exact evidence',branch:randomUUID(),baseSha:'a'.repeat(40)});
  store.createRun(run); let version = 0;
  const advance = (event, records = {}) => store.transition(run.id,version++,{...event,at:Date.now()},records);
  const makeLaunch = (role, provider, model, expectedSha) => ({id:randomUUID(),runId:run.id,role,provider,model,
    sessionId:randomUUID(),worktreePath:repository,expectedSha,tokenHash:'a'.repeat(64),status:'created',createdAt:Date.now(),
    capability:{filesystem:'advisory',cleanContext:'advisory',toolRestrictions:'advisory',notes:['Synthetic fixture launch']}});
  const lead = makeLaunch('conductor','claude','claude-fable-5-1',run.baseSha);
  advance({type:'CONDUCTOR_PREPARED',launchId:lead.id},{launch:lead});
  const contract = freezeContract({objective:'Inspect exact evidence',criteria:['Read exact evidence'],checks:[],constraints:[],exclusions:[]},lead.id);
  advance({type:'BAR_FROZEN',contract},{contract});
  const builder = makeLaunch('implementer','claude','claude-fable-5-1',run.baseSha);
  advance({type:'IMPLEMENTER_LAUNCHED',launchId:builder.id,expectedSha:run.baseSha},{launch:builder});
  const artifact = {id:randomUUID(),runId:run.id,sha:'b'.repeat(40),parentSha:run.baseSha,producedByLaunchId:builder.id,
    branch:run.branch,createdAt:Date.now(),checks:[],diffSummary:'Synthetic artifact identity'};
  advance({type:'ARTIFACT_RECORDED',launchId:builder.id,role:'implementer',artifactSha:artifact.sha,parentSha:run.baseSha},{artifact});
  const launch = makeLaunch('critic','codex','gpt-5.6-sol',artifact.sha);
  advance({type:'CRITIC_LAUNCHED',launchId:launch.id,artifactSha:artifact.sha},{launch});
  const observation = event => ({runId:run.id,launchId:launch.id,sessionId:launch.sessionId,at:Date.now(),event});
  return {store,run,launch,observation,record:event=>store.recordRuntimeObservation(observation(event))};
};
