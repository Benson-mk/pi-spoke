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
| P4 MCP and operators | PASS automated and actual Codex host | `1a485cb`; all six tools through compiled MCP; CLI/config/Codex examples |
| P5 hardening and release qualification | Local verification PASS; external gates BLOCKED | Final hardening revision; evidence below |

Initial inspection found a clean documentation-only tree at `af700dd`. The issue
body, labels and comments were read under the repository tracker conventions.
Accepted architecture and normative acceptance matrices remain intact. Existing
work was preserved. No push, package publication, release, or host configuration
installation was performed during the initial implementation. A verification-only
host configuration was subsequently added at the operator’s request.

## Verification

- Clean offline `npm ci --ignore-scripts` passed from the unchanged exact lock:
  [install transcript](evidence/clean-install.txt).
- `npm run verify`: strict typecheck/build, **5 unit, 8 Pi contract,
  15 integration, and 16 actual-sandbox tests pass**:
  [final verification transcript](evidence/verification-macos-final.txt).
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
- Explicit live gateway checks: Gemini passed actual sandboxed read, native
  same-session continuation, and PNG input through MCP. Llama plain text passed,
  but its Pi tool request failed with HTTP 400 requiring upstream automatic tool
  choice and parser configuration. Both selections share one gateway, so two
  distinct integrations remain unverified. [Live evidence](evidence/live-gateway-macos.json).
- Live-harness regression PASS with real Pi, fake HTTP, and actual SRT reads:
  shared-provider success stays partial and missing tool execution fails.
  [Transcript](evidence/live-harness-regression.txt). Strict typecheck and script
  syntax checks also pass; the default live gate still rejects without opt-in.
- The [acceptance ledger](acceptance-status.json) retains all 66 cases:
  **66 PASS on the tested macOS host, including operator-run S26**. `npm run release:check` intentionally fails
  while required external gates remain. Partial evidence is not a release pass.

## Remaining external actions

1. **Direct Apple Events (S26): PASS.** The operator ran the explicitly
   interactive fixture. Positive controls succeeded; sandbox returned `-600`;
   the runner verifies receiver exit and removes fixtures before writing its
   result. [Evidence](evidence/apple-events-macos-interactive.json). The earlier
   noninteractive consent block remains recorded as history.
2. **Manual Codex host exercise: PASS.** Actual registered tools exercised all
   six MCP operations, independent main-agent work, questions/replies, sandboxed
   read, native continuation, steering and cancellation. All terminal runs have
   confirmed cleanup. [Host evidence](evidence/codex-host-verification.json).
   The host exposed a catalog auth bug: an unrefreshed Pi snapshot returned false.
   Discovery now uses secret-free credential metadata, with null for unknown;
   build/typecheck and [compiled MCP regression](evidence/catalog-auth-regression.txt)
   pass. Restart the loaded host to display that metadata correction.
3. **Two live provider integrations: BLOCKED.** OpenRouter was configured at
   `https://openrouter.ai/api/v1` with the explicit
   `nvidia/nemotron-3.5-lightning:free` model. The initial run reached its
   120-second limit before any tool execution; local cancellation cleanup was
   confirmed, remote completion is unknown, and no replay was attempted.
   OpenRouter continuation is UNRUN. Gemini read/continuation/vision passed again;
   the previous Spark read/continuation pass remains valid.
   [OpenRouter evidence](evidence/live-openrouter-macos.json). A successful
   explicitly authorized second-provider check is still required. Temporary
   OpenRouter credentials were removed. Linux is NOT RUN and rejected.

Arbitrary shell descendants can outlive their wrapper while staying sandboxed.
Such runs end interrupted with `cleanup=unconfirmed`; saved output and safe
checkpoints do not imply cleanup. Explicit operator attestation is required for
continuation. Project shell-write scopes remain explicitly unsupported.
There is no unrestricted fallback, rollback, or automatic replay of uncertain work.
