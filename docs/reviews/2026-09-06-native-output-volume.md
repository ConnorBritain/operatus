# Native output-volume readiness

## Finding and change

Fresh Claude workers switched to verbose NDJSON for activity observations, but
still accumulated and capped the entire stdout/stderr stream at 1 MiB. Valid
tool traffic could therefore terminate implementation or critique before its
final result. The persistent Conductor discarded individual records but had a
separate 16 MiB session ceiling and growing-buffer concatenation.

Both transports now use the same incremental, fixed-buffer reader:

| Boundary | Limit |
| --- | --- |
| One NDJSON record, excluding its newline | 1 MiB |
| Combined observed stdout/stderr per session | 64 MiB |
| Retained stdout diagnostic preview | 64 KiB |
| Retained stderr diagnostic preview | 64 KiB |

The fresh worker separately retains its validated final result record (bounded
by the record limit). The reader itself holds one fixed record buffer and two
fixed preview buffers, not the whole transcript. This is not a bound on native
CLI memory, JSON parsing allocations, gateway requests, or CLI-owned log files.

Byte counters and preview-truncation flags are returned with transport exit
receipts; immutable limits are exposed in transport launch receipts. These
fields are currently consumed by the fixture, not persisted/displayed as part
of the production runtime journal. That inspection work remains open.

Malformed/wrong-session/duplicate results, oversized records and session
overflow still stop the transport and revoke the owned gateway. Cancellation,
timeouts, exact identity, per-role tools, isolated filesystem restrictions and
the global subscription launch hold are unchanged. No configurable escape
hatch or API fallback was added.

## Verified evidence

25 focused reader/transport tests passed. They include actual local Node child
processes through the transport, deliberately substituted for the provider:

- A valid fresh stream above 2 MiB returns its exact final session result.
- A persistent three-turn Conductor exceeds 16 MiB without losing turn identity.
- UTF-8 split at individual bytes and multiple records in one chunk parse correctly.
- Exactly bounded records succeed; larger unterminated records fail once.
- Combined stdout/stderr beyond 64 MiB triggers failure with bounded diagnostics
  and confirmed gateway revocation.
- Existing cancellation, malformed output, wrong identity, duplicate result,
  process drain and gateway-failure tests remain intact.

Two additional opted-in tests exercised the actual pinned Claude 2.1.263
executable through the assembled native runner with synthetic provider replies
containing enlarged text blocks. Each loop used five separate launch identities,
39 local synthetic replies, two exact artifacts and two lead acknowledgments.
Implementation, critique, repair and fresh re-critique completed. Each fresh
worker exceeded the former 1 MiB total limit:

| Role | Observed stdout bytes | Returned final-result bytes |
| --- | ---: | ---: |
| Implementer | 1,215,188 | 2,007 |
| First Critic | 1,458,169 | 2,007 |
| Repairer | 1,215,168 | 2,007 |
| Fresh Critic | 1,458,035 | 2,007 |

The normal loop retained no runtime warning. The injected final Conductor
gateway-close reporting failure retained one operator-attention warning without
changing its already-recorded artifact verdict. Skill/support reads, denied
skill mutation, denied peer evidence access and pre-exit activity assertions
also passed. No real account credential or paid inference was used.

Receipts:

- Normal: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-U2Ftm2/receipt.json`
- Injected failure: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-Ubz82T/receipt.json`

Reproduce with the native executable path and its inspected SHA-256:

```sh
OPERATUS_CLAUDE_PROBE_PATH=/Users/dahlia/.local/share/claude/versions/2.1.263 \
OPERATUS_CLAUDE_PROBE_SHA256=ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9 \
OPERATUS_NATIVE_OUTPUT_STRESS=1 ELECTRON_RUN_AS_NODE=1 \
node_modules/.bin/electron --test test/gauntlet-native-runner.test.cjs
```

Native fixture copies are removed by the existing bounded cleanup; disposable
Git/SQLite state, profiles and receipts are retained. Node/web typechecks passed.

## Still not demonstrated

Real subscription-only model judgment, long-running substantial projects,
concurrent memory/storage pressure, production display of output limits and
truncation, and the outstanding macOS viewport/office inspection. This output
stress test closes a transport-volume defect, not the overall Mac pilot gate.
