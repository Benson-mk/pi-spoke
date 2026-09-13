# Implementation status

Target: 0.1.0; specification 1.1; issue #1. Branch: `codex/implement-v0.1.0`.
Release readiness: **NOT READY**. No platform is currently claimed supported.

| Milestone | Status | Evidence / next gate |
|---|---|---|
| P0 public APIs and OS enforcement | PASS (macOS compatibility slice) | Exact lock; real Pi public APIs; six real OS probes and typed helper integration |
| P1 durable core and permissions | PASS (core slice) | Strict schemas, authority resolver, SQLite receipts/state and deterministic lifecycle/fault tests |
| P2 supervised execution | PARTIAL; cleanup gate unresolved | Real supervised Pi, guarded file tools, images, checkpoints and provider cancellation pass; arbitrary shell descendant cleanup is unconfirmed |
| P3 skills and communication | NOT RUN | Depends on P2 |
| P4 MCP and operations | NOT RUN | Depends on P3 |
| P5 release gates | NOT RUN | All acceptance, host, platform, live and performance evidence required |

Initial inspection: clean tree at `af700dd`; documentation only. Read issue #1,
its `ready-for-agent` label and empty comments; no contract discrepancy.
The active goal is recorded in the task. No push, publication, or release is authorized.

Verification outcomes use PASS, FAIL, BLOCKED, and NOT RUN separately. A partial
case is not a pass. Every A01–A30 and S01–S36 remains required; the normative
matrices are preserved unchanged. Live tests remain opt-in and cannot pass by
being skipped. Missing suites fail `verify` until implemented.

P0 evidence: [compatibility](compatibility.md), [OS canaries](evidence/p0-macos-sandbox.txt).
Passed slices: typecheck/build, real Pi save/reopen/contact/resources/literal
steering, source/scratch separation, nested/missing protection, socket denial,
concurrent policy isolation, hostile wrapper quoting, fixed sandboxed writes
and native exact edits, invalid launcher inputs, and every built-in tool callback
replacement. A pre-existing writable hard link bypasses path protection; the
topology guard rejects it. Full supervised production integration and descendant
cleanup remain P2 work. P0 passing is not a full safety-case/release pass.
Linux, live providers, vision, and manual Codex acceptance are NOT RUN.

Commits: `432e630` establishes the pinned compatibility probes. All 66 full
acceptance cases are carried in [acceptance-status.json](acceptance-status.json).

`a7abdac` completes the macOS P0 compatibility slice. P1 verification:
typecheck/build, 2 unit tests and 12 integration tests passed. The real SIGKILL
fixture preserves receipt and uncertain invocation state without replay; clean
reopen supports explicit continuation. Fault injection covers acceptance,
terminal artifact and persistent database failures. Tests also cover concurrent
continuation, capacity, duplicate requests/questions/replies, uncertain delivery,
policy revocation, cancellation races, UTF-8 output and retained request keys.
Initial SQLite schema is version 1; newer schemas are refused read-only before
changing database settings. There is no deployed older schema to migrate.

P1 interfaces intentionally use a controlled runtime. Native checkpoint
validation, actual process cancellation, resource/attachment admission, run
deadlines and the full executable sandbox adapter are P2 responsibilities.
Public MCP acceptance is rerun at P4/P5. Project shell-write roots currently
fail with `SANDBOX_POLICY_UNSUPPORTED`; no broad-write mode is silently enabled.

P2 evidence (Node 24.15.0, local fake HTTP provider, actual macOS SRT): strict
typecheck/build; 2 unit, 12 integration, 5 Pi contract and 8 sandbox tests pass.
The complete `verify` sequence passed before adding checkpoint-corruption and
detached-descendant cases; both expanded suites passed afterward. Tests cover
all seven overridden Pi tool definitions, supervised fixed read/search/write/edit,
accepted image snapshots, unsupported modality/model rejection before inference,
context-change rejection, native confirmed-prefix recovery, corrupt/incomplete
checkpoint rejection, and cancelling a slow provider request while a sibling
completes. No live provider was called.

S32 characterization is **not a full acceptance pass**: a finite detached child
outlives its wrapper and remains sandbox-contained. Every arbitrary-shell run
therefore retains `cleanup=unconfirmed` and ends interrupted, with output and a
safe checkpoint preserved where available. Continuation is refused until cleanup
is independently attested. No wrapper-exit heuristic claims descendant cleanup.
Full parent-death/double-fork qualification remains unresolved; independent
skills, communication, transport and operator work can proceed against the
verified no-tool and fixed-file-helper paths. Release remains NOT READY.
