/** No remote/worker endpoint: only the owning desktop may dispose its result inbox. */
export function desktopCandidateHandoff(services: {
  localWindow(): { mainFrame: unknown } | null;
  save(runId:string,version:number,sha:string,reviewed:boolean,note:string): unknown;
}) {
  return (event:{sender:unknown;senderFrame:unknown},runId:unknown,version:unknown,sha:unknown,reviewed:unknown,note:unknown): unknown => {
    const local = services.localWindow();
    if (!local || event.sender !== local || event.senderFrame !== local.mainFrame) throw Error('candidate disposition requires the local desktop');
    if (typeof runId !== 'string' || !runId || runId.length>100 || typeof version !== 'number' || !Number.isSafeInteger(version) || version<0 ||
      typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha) || typeof reviewed !== 'boolean' || typeof note !== 'string' || !note.trim() || note.length>4000) throw Error('invalid candidate disposition');
    return services.save(runId,version,sha,reviewed,note);
  };
}
