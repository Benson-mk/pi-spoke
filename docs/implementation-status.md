# Implementation status

Target: 0.1.0; accepted specification 1.1; GitHub issue #1.
Branch: `codex/implement-v0.1.0`. **Release readiness: NOT READY.**
No platform release support is claimed. The active goal is awaiting the remaining
external gates; it has not been declared complete.

| Milestone | Outcome | Commit / evidence |
|---|---|---|
| P0 dependencies, public APIs, OS enforcement | PASS, local compatibility slice | `432e630`, `a7abdac`; pinned lock/binaries, real Pi and SRT probes |
| P1 durable lifecycle and permissions | PASS, local acceptance | `041297f`; SQLite receipts, independent grants, recovery/fault tests |
| P2 supervised execution | PASS, local candidate contract | `491926e`; real workers, guarded tools, images, native checkpoints, honest cleanup |
| P3 optional skills and communication | PASS, local acceptance | `1ca3d9f`; metadata-first optional skills, immutable resources, durable contact/reply |
| P4 MCP and operators | PASS automated; manual host BLOCKED | `1a485cb`; all six tools through compiled MCP; CLI/config/Codex examples |
| P5 hardening and release qualification | Local verification PASS; external gates BLOCKED | Final hardening revision; evidence below |

Initial inspection found a clean documentation-only tree at `af700dd`. The issue
body, labels and comments were read under the repository tracker conventions.
Accepted architecture and normative acceptance matrices remain intact. Existing
work was preserved. No push, package publication, release, or host configuration
installation was performed.

## Verification

- Clean offline `npm ci --ignore-scripts` passed from the unchanged exact lock:
  [install transcript](evidence/clean-install.txt).
- `npm run verify`: strict typecheck/build, **5 unit, 8 Pi contract,
  15 integration, and 15 actual-sandbox tests pass**:
  [verification transcript](evidence/verification-macos.txt).
- Tests use the real Pi SDK with local fake providers and actual macOS SRT.
  Compiled MCP tests exercise six tools, duplicates/conflicts, questions/replies,
  byte/cursor pagination, continuation, shell cancellation, actual supervisor
  SIGKILL, sibling survival and native restart recovery without replay.
- Real 16 MiB disposable HFS+ volume: mounted topology rejected; actual
  `ENOSPC` produces `failed / STATE_WRITE_FAILED` with the receipt retained.
  The image was detached and removed: [volume evidence](evidence/volume-macos.json).
- Public shell/file paths cover source deletion/overwrite, independent editing,
  metadata, symlink/hard-link and ancestor races, outside/tmp paths, environment,
  IPv4/IPv6, Unix sockets, controlled DNS/UDP and Launch Services. A modified
  compiler copy fails before launch. See [compatibility](compatibility.md).
- [Measured performance](evidence/performance-macos.json): 616 ms MCP startup,
  462–529 ms sandboxed reads, 37 ms provider cancellation; sampled supervisor
  RSS 425,376 KiB. Single fake-provider sample; not aggregate worker-tree memory.
- Disabled live gate exits nonzero without loading live credentials or making
  inference calls: [gate evidence](evidence/live-gate-disabled.txt).
- The [acceptance ledger](acceptance-status.json) retains all 66 cases:
  **65 PASS locally, S26 BLOCKED**. `npm run release:check` intentionally fails
  while required external gates remain. Partial evidence is not a release pass.

## Remaining external actions

1. **Direct Apple Events (S26):** the noninteractive positive control returned
   macOS `-1744` (user consent required). Its receiver exited and fixture was
   removed. [Evidence](evidence/apple-events-macos.json). An operator can run the
   explicitly interactive disposable-receiver command in [operations](operations.md).
   No Automation privacy settings were changed by this implementation.
2. **Manual Codex host exercise:** configure the supplied TOML and complete the
   discovery/spawn/independent-work/observe/question/reply/steer/continue/cancel
   checklist. The host remains free not to delegate.
3. **Two live providers plus vision:** supply operator-owned configuration and
   explicit model selections, then run the opt-in live runner. No live tests
   have run. Linux is NOT RUN and rejected by this adapter; support is not claimed.

Arbitrary shell descendants can outlive their wrapper while staying sandboxed.
Such runs end interrupted with `cleanup=unconfirmed`; saved output and safe
checkpoints do not imply cleanup. Explicit operator attestation is required for
continuation. Project shell-write scopes remain explicitly unsupported.
There is no unrestricted fallback, rollback, or automatic replay of uncertain work.
