# Roster ownership: adapt upstream, do not transplant

Date: 2026-09-06. Read-only source audit with executed synthetic-data reproductions. No user roster, queue, home folder or browser storage was modified.

## Sources and decision

Compared the current renderer store and Settings home-change handler against the previously verified Munder stable commit `64bd64df0e8d315a6e895283f776b81f84eef2cc`, specifically `src/renderer/src/store/rosterSource.ts` and its boot-time use in `store.ts`. This pass did not recheck GitHub for a newer release.

**Adapt the per-home ownership principle, not the shared mutable stamp implementation.** The current fork remains unsafe for roster fallback across homes. The upstream policy improves the first switch, but a stamp can be reassigned before all associated payload slices have been replaced. It also intentionally adopts unstamped legacy data; Operatus cannot infer that data's project ownership safely.

## Executed evidence

The current `store.ts` was loaded through the existing TypeScript test loader with synthetic localStorage, an empty file roster for home B, and a synthetic worker/queued message belonging to home A. Its real boot/persistence functions loaded A's worker and queue and would mirror them to B. No React view or live provider was involved.

The inspected upstream `chooseRosterSource` function was transpiled and executed for two boots. On the first B boot with an A stamp, it correctly refused fallback. After applying the upstream store's immediate B stamp write, a subsequent B boot with an empty file accepted fallback although the old payload could still be present. This is a deterministic policy/caller-order reproduction, **not a full native upstream app smoke**. Partial later writes to one slice do not establish ownership of all other slices.

The current Settings `clearLocalState` and `applyChangeHome` function bodies were also executed against an in-memory storage map and a rejected `changeHome` response. Choosing `fresh` removed the synthetic roster and queue before receiving “That is already the current home folder.” Unrelated non-`cth.*` data remained. The caller does not restore the erased cache on failure.

Observed results:

```json
{"case":"current-renderer-different-home","loaded":["project-a-worker"],"queued":["project-a-worker"],"wouldMirror":["project-a-worker"],"unsafe":true}
{"case":"upstream-stamp-before-payload-replacement","first":{"useFileRoster":false,"useLocalFallback":false},"second":{"useFileRoster":false,"useLocalFallback":true},"oldPayloadRetained":true,"unsafe":true}
{"case":"rejected-fresh-home-change","rosterRetained":false,"queueRetained":false,"unrelatedRetained":true,"unsafe":true}
```

## Required implementation and acceptance

1. Main supplies one boot snapshot binding the roster to its home identity. Do not construct ownership from two independently observed configuration/roster values.
2. Use per-home namespaced cache payloads, or one atomic envelope containing both owner and all slices. Do not relabel independent shared keys at boot.
3. Scope agents, selected ID, archives, restorable recipes, notes and parked queues together. Keep Gauntlet restoration exclusion intact; it does not replace home isolation.
4. Preserve ambiguous legacy keys unchanged. Do not auto-assign or auto-run them. Provide a visible recovery path requiring an explicit destination and preview, rather than silently blanking or adopting a floor.
5. Bind each mirror write to the home that produced it and reject stale-window writes to a different current home.
6. Remove pre-success cache clearing from home changes. A rejected or interrupted change must preserve source data and preferences; a new home must not inherit the old home's fallback. Handle move and fresh semantics separately.
7. Test A → B → B reload → A, populated/empty/missing/corrupt file cases, blocked localStorage, unstamped legacy data, partial persistence, rejected changes and stale writes. Then repeat the actual native home-switch/relaunch flow with disposable profiles and zero provider launches.

These fixes were **not implemented by this audit**. A subsequent [home-isolation implementation and bounded native smoke](2026-09-06-roster-home-isolation.md) closes cache ownership and stale-write defects. Explicit legacy recovery and the actual live home-migration workflow remain open. Upstream's source policy is still not native interaction evidence.

## Resource check

At the start of this pass the Mac had about 395 MiB available. Read-only inspection of known `op-native-tools-*`, `op-native-gateway-*`, `op-claude-route-*` and `operatus-auth-smoke-*` test locations found no retained large copied Claude executables to reclaim. Small native probe fixture files were left untouched. No cleanup was performed and the copied-executable reserve was not weakened. Native provider acceptance remains blocked on sufficient space; other evaluation work remains possible.
