# Upstream adoption: shell-free executable discovery

Date: 2026-09-06. Decision: **adapt**, not wholesale cherry-pick.

## Source and verification

GitHub's latest-release API still reports [Munder Difflin v0.4.6](https://github.com/chaitanyagiri/munder-difflin/releases/tag/v0.4.6),
published 2026-08-27. The remote annotated tag object matches local
`ecda5a9aa700f0d0a14c67cdd4e34c6dd80e29b7`; the peeled commit is
`64bd64df0e8d315a6e895283f776b81f84eef2cc`.

Reviewed commit [ea7e0d2f3535216acfa4e4000e7ffe2e1a7770ba](https://github.com/chaitanyagiri/munder-difflin/commit/ea7e0d2f3535216acfa4e4000e7ffe2e1a7770ba)
is an ancestor of that stable commit (checked with `git merge-base --is-ancestor`).
It validates command names before `which`/`where` lookup, removes `shell: true`
from Windows lookup, and validates the worker-request executable field.

## Operatus adaptation

Both old Operatus resolvers interpolated command names into a login shell and
sourced the user's startup files just to find a CLI. This was incompatible with
the intended controlled subscription runtime and duplicated provider selection.

`commandResolution.ts` now owns filesystem-only discovery. It rejects command
programs, leading options, relative executable references and control characters.
Only absolute PATH directories and known installation directories are searched;
empty/current-directory and relative PATH entries are ignored. Matches must be
regular executable files on POSIX, and real targets are deduplicated. Windows
suffix discovery is limited to COM/EXE/BAT/CMD; actual Windows shim execution
remains a separate boundary requiring hardware verification and admission work.

No shell, `which`, `where`, credential helper, CLI or network call is used for
discovery. `shellEnv.ts` is now a compatibility facade. Main PTY preparation,
hidden-call discovery and subscription diagnostics use the same resolver. Positive
resolution caching was removed so PATH changes and removed/replaced targets are
not silently masked. File-driven worker requests now honor the billing hold
before command probing and worktree preparation.

Deliberate tradeoff: a custom executable visible only after running arbitrary rc
scripts is not discovered automatically. Configure its absolute path instead.
No user shell, installation, credential or billing configuration was modified.

## Evidence and limits

The complete local root suite passes **219 tests**, including five new resolver
tests; node/web typechecks and Electron build pass. Tests exercise malicious
tokens, real executable/non-executable fixtures, duplicate symlinks, safe PATH
entries, changed/deleted targets and subprocess spies showing zero executions.
Initial fixture assertions caught the Mac `/var` versus `/private/var` alias;
the fixture expectations were canonicalized rather than weakening realpath output.

Read-only inspection of the real Claude installations shows that both discovery
and preflight return the same ordered paths: Homebrew 2.1.86 first, native 2.1.263
second. The diagnostic still returns `launchAllowed: false`. No inference was
performed. The older first match is **not** a recommended or admitted executable.

This does not establish executable provenance, interpreter/shim attestation,
version support, model entitlement, subscription authentication, account overage
enforcement or containment. Those remain required before launch admission. File
inspection has ordinary filesystem races and must not be mistaken for a pinned
runtime. Existing billing holds remain unchanged.

Logs: `/tmp/operatus-resolution-tests.log`,
`/tmp/operatus-resolution-typecheck.log`, `/tmp/operatus-resolution-build.log`.
