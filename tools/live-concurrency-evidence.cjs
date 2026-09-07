'use strict';
// Pure evidence analysis. Synthetic unit tests do not establish live acceptance.
function analyze(snapshots, samples, ids) {
  const intervals = snapshots.flatMap(s => s.runtimeObservations.filter(o => o.event.type === 'process_started').map(start => {
    const exit = s.runtimeObservations.find(o => o.launchId === start.launchId && o.event.type === 'process_exited');
    return { runId: s.run.id, launchId: start.launchId, pid: start.event.pid, start: start.at, end: exit?.at,
      clean: !!exit?.event.processExited && exit.event.gatewayRevocation === 'confirmed' };
  }));
  const overlap = intervals.flatMap((a,i) => intervals.slice(i+1).filter(b => a.runId !== b.runId &&
    [a.end,b.end].every(Number.isFinite) && Math.min(a.end,b.end)>Math.max(a.start,b.start))
    .map(b => ({runs:[a.runId,b.runId],from:Math.max(a.start,b.start),to:Math.min(a.end,b.end)})));
  const queued = samples.filter(s => s.capacity.dispatches.filter(d=>d.state==='running').length===2 &&
    s.capacity.dispatches.some(d=>d.runId===ids[2]&&d.state==='queued') && s.launchCounts[ids[2]]===0);
  const third = snapshots.find(s=>s.run.id===ids[2]);
  const thirdStart = third?.runtimeObservations.find(o=>o.event.type==='process_started')?.at;
  const firstPairOverlap = overlap.filter(o=>o.runs.includes(ids[0])&&o.runs.includes(ids[1]));
  const releaseBeforeThird = ids.slice(0,2).some(id=>{
    const owned=intervals.filter(i=>i.runId===id);
    return owned.length>0&&owned.every(i=>i.clean&&i.end<=thirdStart);
  });
  const launches=snapshots.flatMap(s=>s.launches);
  const freshPaths=launches.filter(l=>l.role!=='conductor').map(l=>l.worktreePath);
  return {intervals,overlap,queuedSamples:queued.length,assertions:{
    threeRuns:snapshots.length===3&&new Set(ids).size===3,
    allPassed:snapshots.length===3&&snapshots.every(s=>s.run.status==='passed'),
    queuedWithoutPreparation:queued.length>0,
    realOverlap:firstPairOverlap.length>0,
    bothProgressed:ids.length===3&&ids.slice(0,2).every(id=>snapshots.find(s=>s.run.id===id)?.artifacts.length>0),
    queueReleasedSafely:queued.length>0&&Number.isFinite(thirdStart)&&releaseBeforeThird,
    capacityRespected:samples.length>0&&samples.every(s=>s.capacity.maxConcurrentRuns===2&&s.capacity.dispatches.filter(d=>['running','quarantined'].includes(d.state)).length<=2),
    distinctSessions:launches.length>0&&new Set(launches.map(l=>l.sessionId)).size===launches.length,
    distinctFreshWorktrees:freshPaths.length>0&&freshPaths.every(Boolean)&&new Set(freshPaths).size===freshPaths.length,
    confirmedExits:intervals.length>0&&intervals.every(i=>i.clean),
    liveAdmissions:intervals.length>0&&intervals.every(i=>snapshots.find(s=>s.run.id===i.runId).runtimeObservations.some(o=>o.launchId===i.launchId&&o.event.type==='subscription_admission'&&o.event.source==='provider-metadata')),
    finalJudgments:snapshots.length===3&&snapshots.every(s=>{
      const artifact=s.artifacts.at(-1),report=s.reports.at(-1),ack=s.acknowledgments.at(-1);
      const critic=s.launches.find(l=>l.id===report?.launchId);
      const conductor=s.launches.find(l=>l.id===ack?.launchId);
      return !!artifact&&/^[a-f0-9]{40}$/.test(artifact.sha)&&artifact.sha===s.run.currentArtifactSha&&
        artifact.checkReceipts.length>0&&artifact.checkReceipts.every(c=>c.exitCode===0&&!c.timedOut)&&
        report?.verdict==='PASS'&&report.artifactSha===artifact.sha&&report.contractDigest===s.run.contract.digest&&
        critic?.role==='critic'&&critic.provider==='codex'&&critic.expectedSha===artifact.sha&&
        ack?.decision==='pass'&&ack.reportId===report.id&&ack.artifactSha===artifact.sha&&ack.contractDigest===s.run.contract.digest&&conductor?.role==='conductor';
    })
  }};
}
module.exports={analyze};
