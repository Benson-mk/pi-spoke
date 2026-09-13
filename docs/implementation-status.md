# Implementation status

Target: 0.1.0; specification 1.1; issue #1. Branch: `codex/implement-v0.1.0`.
Release readiness: **NOT READY**. No platform is currently claimed supported.

| Milestone | Status | Evidence / next gate |
|---|---|---|
| P0 public APIs and OS enforcement | PASS (macOS compatibility slice) | Exact lock; real Pi public APIs; six real OS probes and typed helper integration |
| P1 durable core and permissions | IN PROGRESS | Building strict authority resolution and durable state next |
| P2 supervised execution | NOT RUN | Depends on P0/P1 |
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
