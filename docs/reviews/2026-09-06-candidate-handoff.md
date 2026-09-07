# Candidate handoff: pass is not delivery

## Evaluation finding

The Runs surface previously showed `You · Review the unmerged candidate` for a
passed run while classifying it as closed. It disappeared from Needs you and
could age out of both SQLite's operator listing and the renderer's 100-item
closed history before the operator acted. This contradicted the displayed owner
and created a result-handoff gap during concurrent project work.

## Change

Passed candidates now remain in the uncapped attention set until an explicit
human disposition covers their exact current full commit SHA. Failure/runtime
warnings rank first, then pending candidates, then active work and closed history.
Priorities apply within those groups; a high-priority candidate cannot obscure a
low-priority unresolved warning.

`CANDIDATE_HANDOFF_RECORDED` is a separate append-only run event with the commit,
reviewed/reopened flag, required bounded plain-text note and timestamp. The
transaction checks the current run version, passed state, exact SHA and existing
artifact receipt. Reopening requires another explicit event. Historical passes
without a disposition are pending; no historical human decision is invented.

The new IPC command is local-main-frame-only and absent from worker/remote control
commands. It cannot create a pass, edit a contract/report/acknowledgment, launch
work, release capacity, delete anything or integrate Git content. Runtime-warning
review remains independent. A handoff note does not prove that an external owner
accepted work or that integration happened.

The detail view shows the exact SHA, note and explicit limits. Its draft uses the
run/repository-scoped cache, preserves the original SHA/version through refresh,
and clears only the exact submitted edit after a successful save. Timeline entries
retain prior dispositions. Additive snapshot/event fields use the existing event
storage; no table rewrite or deletion was performed.

## Verification

- 59 candidate handoff, backend, review, priority, draft, runtime attention,
  office-projection and run-view tests passed, zero skipped.
- The backend's real temporary Git/check fixture now records and reopens a
  disposition after implementation, scripted critique, repair, scripted
  re-critique and explicit lead acknowledgment. Wrong-SHA and stale-version
  submissions fail; SQLite reopen retains the note. Primary Git HEAD, launches,
  contract, reports, acknowledgments, artifacts and repair packets stay unchanged.
- 136 existing focused desktop/runtime tests passed, zero skipped.
- The full `test/gauntlet-*.test.cjs` regression sweep, run through Electron as
  Node with test concurrency two, reports **233 passed, zero failed, seven
  skipped** (240 total). Native opt-in acceptance is not inferred from that
  sweep; the explicit mixed-native concurrency invocation below ran separately.
- Main/web typechecks and Electron production build pass. Existing renderer
  bundle-size and mixed-import warnings remain; build success is not a performance
  or rendered-UX acceptance claim.

### Actual native executables, scripted provider responses

Both scenarios in `test/gauntlet-native-concurrency.test.cjs` passed with
`OPERATUS_NATIVE_MIXED=1`, zero skipped. The existing pinned Claude 2.1.263 and
Codex 0.153.4 executables ran against isolated local scripted responses. No live
provider inference or real credentials were used. Global launch hold stayed on.

- Lead cancellation: `op-native-concurrent-wa4Mnb`, 11 native launches and 45 local
  requests; outcomes cancelled/passed/passed.
- Dirty-worker cancellation: `op-native-concurrent-wdxZvt`, 12 native launches
  and 48 local requests; same outcomes, dirty candidate preserved.

Both runs assert that the two passed candidates initially need separate human
handoffs. Recording the second run's disposition closes only its candidate item;
the third run remains pending. Scheduler capacity, launch receipts and reports
are unchanged. All primary repositories remain at their original clean base.

Receipts and SQLite/Git evidence are under
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`, in each directory above.
Each `receipt.json` records `realInference: false` and final snapshots including
the new human disposition. Test-owned native executable copies are removed after
drain; the test evidence is retained.

## Remaining owner-operator gaps

This fixes a real outcome signal, not the entire strategy-management requirement.
Current repository filtering and role-based next responsibility do not provide a
project work-order graph. Structured project ownership, dependencies, coupled-work
planning, an integration owner, and fresh critique of an exact combined candidate
remain open in R3. An accepted child candidate is not an accepted project.

No new rendered smoke was claimed here. The last Computer Use check reported a
locked Mac. At both target desktop viewports, still verify the candidate panel,
warnings-first ordering, cross-project selection, draft preservation, exact-SHA
evidence inspection, successful/rejected saves and return-to-inbox behavior.
Live subscription-backed judgment acceptance also remains open.
