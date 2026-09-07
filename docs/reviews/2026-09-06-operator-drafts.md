# Operator draft preservation

Date: 2026-09-06. UI-state fix; no authority or provider changes.

## Reproduced code path

The run-view reducer correctly clears stale detail on refresh and new evidence.
The conditional Runs renderer therefore unmounts `RunDetail` while loading,
destroying its local decision-note and attention-priority form state. Opening
another run or the depot has the same effect. Separately, an asynchronous review
save unconditionally cleared the textarea when its response arrived, even if the
operator had typed newer text while it was pending.

## Fix

An in-memory draft store belongs to the mounted Runs surface, keyed by both run ID
and repository. The detail component subscribes to that store, so unmount/remount
does not erase text and another project cannot inherit it. Review and priority
forms have separate edit counters. A successful response clears only the exact
submitted edit, never newer typing, a peer run, or the other form.

The draft retains the evidence/priority revision against which it was written.
Refreshing does not silently rebase or save the operator's decision. Existing
main-process stale-write and authority checks remain in force. Unedited priority
controls follow the server's current choice; explicit unsaved edits retain their
own choice until saved/reset. The UI labels nonempty notes as unsaved drafts.

## Evidence and limits

Seven new tests exercise real draft-store and run-view reducer behavior: refresh
and failed load, original evidence basis, cross-project restoration, identical
newer text during save, section isolation, subscription/remount notifications,
priority revision changes, input snapshot immutability and a new surface lifetime.
The combined draft/run-view/priority/review batch passed 30 tests with no skips.
Both typechecks passed. CI includes the new test file; no hosted run is claimed.
The Electron production build and `git diff --check` also passed. Existing
mixed-import and large-renderer-bundle concerns are unchanged.

This is implementation and state-machine evidence, not a rendered typing smoke.
Computer Use was rechecked in this pass and reported the Mac locked. The skill
requires manual unlock, so the app interaction was not attempted through another
mechanism. Actual rendered editing, focus and scroll behavior remain unaccepted.

Drafts are not saved to SQLite, disk, the portal or a provider. They survive only
while the Runs surface remains mounted, not app quit/crash or a fresh mount of the
whole surface. Saving still requires the explicit save/review action. This is not
the durable cross-agent feedback feature or a relaxation of Gauntlet authority.
