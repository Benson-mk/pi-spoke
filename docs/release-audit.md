# 0.1.0 release audit

Date: 2026-09-14. Outcome: required gates PASS for macOS 15.6 (24G84),
Darwin 24.6.0 arm64 with the exact Node, Pi, MCP, SRT, compiler and binary
identities in [compatibility](compatibility.md). This is a source-build
qualification, not a package publication or release action. Linux is unrun
and explicitly rejected; other platform/toolchain identities require qualification.

| Required outcome | Authoritative evidence |
|---|---|
| Accepted P0–P5 order, architecture and preserved initial work | [Implementation status](implementation-status.md), Conventional Commits from `432e630` through final qualification, unchanged accepted specification and ADR decisions |
| P0 exact dependencies, public Pi and actual containment | `package-lock.json`, [compatibility](compatibility.md), `tests/contract/pi.test.ts`, `tests/sandbox/p0.test.ts`, binary/compiler upgrade tests |
| P1 lifecycle, receipts, deduplication, independent grants | `src/store/database.ts`, `src/core/service.ts`, `src/security/policy.ts`; integration and policy tests in the complete ledger |
| P2 supervised Pi, guarded tools, continuation, images, cancellation | `src/runtime/`, `src/pi/`, `src/helpers/`, `src/sandbox/`; real Pi and actual-sandbox tests; [host tool results](evidence/codex-host-verification.json) |
| P3 optional skills and main-mediated communication | `src/pi/skills.ts`, `src/runtime/supervisor.ts`; real-Pi skill/communication and sandbox skill tests |
| P4 six MCP tools, CLI, examples, Codex | `src/contracts.ts`, `src/api.ts`, `src/mcp/server.ts`, `src/cli.ts`, `src/operator.ts`; three JSON examples and Codex TOML; actual registered Codex tool evidence |
| P5 all A01–A30 and S01–S36 | [Acceptance ledger](acceptance-status.json): 66 distinct retained cases, all PASS; every referenced evidence/test path exists |
| Current build, strict types, deterministic/Pi/integration/OS tests | [Final full transcript](evidence/verification-macos-final.txt): 5 unit + 8 Pi contract + 15 integration + 16 sandbox = 44 PASS; final build PASS |
| Clean pinned installation | [Clean install transcript](evidence/clean-install.txt), unchanged lock hash in compatibility record |
| Actual disk exhaustion and mount crossing | [Disposable HFS+ volume](evidence/volume-macos.json): ENOSPC, retained receipt, mount detached and removed |
| Direct Apple Events and host IPC containment | [Operator-run Apple Events](evidence/apple-events-macos-interactive.json), Unix socket and Launch Services tests; successful positive controls and denied sandbox delivery |
| Two live provider integrations, real tool task, continuation, vision | [OpenRouter authorized retry](evidence/live-openrouter-retry-macos.json): Nemotron read + continuation; [separate gateway](evidence/live-openrouter-macos.json): Gemini read + continuation + image input |
| No automatic replay/fallback and honest cleanup | Original OpenRouter timeout retained; retry explicitly requested by operator, new run IDs; terminal cleanup confirmed. Arbitrary shell descendants retain interrupted/unconfirmed semantics |
| Performance and limitations | [Performance evidence](evidence/performance-macos.json), compatibility and operations: actual startup/tool/concurrency/cancellation/output measurements and bounded memory claim |
| No push, package publication or release | Work remains on `codex/implement-v0.1.0`; package is private; no publication/release action was performed |

`npm run release:check` verifies the complete case-ID set and requires every
case and release gate to pass. Its [recorded result](evidence/release-check.json)
has `release_ready: true` and no remaining gates. The ledger is backed by the
linked execution evidence, not a replacement for it.

Known supported limits remain part of qualification: arbitrary shell descendants
may outlive wrappers while retaining their sandbox, so cleanup is unconfirmed
and explicit operator attestation is required before continuation. Project
shell-write scopes are unsupported and reject before execution. Fixed file
writes have independent authority. There is no rollback or unrestricted
fallback. Trusted provider clients can transmit permitted context. These
limitations are documented and tested, not waived by the release audit.

The initial OpenRouter timeout, Llama tool-parser failure and noninteractive
Apple Events consent block remain in historical evidence. They are superseded
for the required gates by an explicit successful retry, other explicitly selected
models, and the operator-run interactive fixture. No unknown result was relabelled
as passed. Image evidence establishes accepted image input, not perception quality.

Plain doctor does not run release qualification and now returns null for
`release_ready` with an explanatory assessment. No automatic inference,
credential command execution, host setup or security-setting change was added.
The existing temporary Codex verification connection must reload to display
new diagnostics; its previously recorded six-tool workflow checks remain valid.
