# Implementation status

Target: 0.1.0; accepted specification 1.1; GitHub issue #1.
Branch: `codex/implement-v0.1.0`. **Release readiness: READY on the qualified macOS host; unpublished.**
Qualification is limited to macOS 15.6 (24G84), Darwin 24.6.0 arm64 and the
exact pinned identities. Linux execution is implemented for the pinned OrbStack VM; its external release gates remain incomplete. No push, package
publication, or release has been performed.

| Milestone | Outcome | Commit / evidence |
|---|---|---|
| P0 dependencies, public APIs, OS enforcement | PASS, local compatibility slice | `432e630`, `a7abdac`; pinned lock/binaries, real Pi and SRT probes |
| P1 durable lifecycle and permissions | PASS, local acceptance | `041297f`; SQLite receipts, independent grants, recovery/fault tests |
| P2 supervised execution | PASS, local candidate contract | `491926e`; real workers, guarded tools, images, native checkpoints, honest cleanup |
| P3 optional skills and communication | PASS, local acceptance | `1ca3d9f`; metadata-first optional skills, immutable resources, durable contact/reply |
| P4 MCP and operators | PASS automated and actual Codex host | `1a485cb`; all six tools through compiled MCP; CLI/config/Codex examples |
| P5 hardening and release qualification | PASS, all required gates on qualified macOS | Final hardening revision; evidence below |

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
  choice and parser configuration. Those initial selections shared one gateway; the later OpenRouter retry
  below completed the distinct-integration requirement. [Live evidence](evidence/live-gateway-macos.json).
- Live-harness regression PASS with real Pi, fake HTTP, and actual SRT reads:
  shared-provider success stays partial and missing tool execution fails.
  [Transcript](evidence/live-harness-regression.txt). Strict typecheck and script
  syntax checks also pass; the default live gate still rejects without opt-in.
- The [acceptance ledger](acceptance-status.json) retains all 66 cases:
  **66 PASS on the tested macOS host, including operator-run S26**. `npm run release:check` passes with no remaining mandatory gates.

## External gate results

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
3. **Two live provider integrations: PASS.** The operator-authorized fresh
   OpenRouter retry completed sandboxed read and native continuation with
   confirmed cleanup; the first run took 17.8 seconds. The previous 120-second
   timeout remains historical evidence. Separate gateway Gemini read,
   continuation and vision checks passed. [Retry evidence](evidence/live-openrouter-retry-macos.json)
   and [gateway evidence](evidence/live-openrouter-macos.json). Temporary
   OpenRouter credentials were removed; the host verification configuration
   remains installed. No automatic retry or model fallback was added.

See the [release audit](release-audit.md) for requirement-to-evidence mapping.

Arbitrary shell descendants can outlive their wrapper while staying sandboxed.
Such runs end interrupted with `cleanup=unconfirmed`; saved output and safe
checkpoints do not imply cleanup. Explicit operator attestation is required for
continuation. Project shell-write scopes remain explicitly unsupported.
There is no unrestricted fallback, rollback, or automatic replay of uncertain work.

Linux verification was subsequently run against commit `2e3523c` in an isolated
Ubuntu 24.04.5 arm64 OrbStack VM: build/typecheck/install and 28 non-sandbox
tests passed; all 16 sandbox tests failed on the macOS-specific adapter and
fixtures. Bubblewrap itself passed a primitive launch/network-namespace probe.
That historical failure led to the Linux adapter below. The existing release
qualification remains macOS-only. [Initial Linux results](evidence/linux-orbstack/summary.json).


## Linux follow-up

Implemented the Linux SRT/bubblewrap adapter with a mandatory native network
seccomp filter, exact dependency identities, platform-aware capability reporting,
and containment fixtures. Structured file writes remain independent from shell
write authority; unsupported project shell writes are rejected. A final rerun
exposed and fixed `drain()` returning before a newly initiated cancellation
completed. Historical failures are retained with the new verification evidence.

Local qualification covers real Pi with a fake provider, the public MCP contract,
actual sandbox canaries, mounted tmpfs rejection and actual ENOSPC with receipt
retention and verified unmount. All A01–A30/S01–S36 cases remain tracked in the
[Linux ledger](evidence/linux-support/acceptance.json). Operator-authorized Linux live checks passed direct OpenRouter Nemotron and
gateway Gemini sandboxed reads and native continuation, plus Gemini vision.
All cleanup was confirmed and temporary credentials were removed. The earlier
NVIDIA NIM failure remains historical evidence. Only the actual Codex host
exercise remains incomplete; Linux release readiness is not claimed.


Verification: Linux `npm run verify` passed **43 tests**, with one macOS-only
Launch Services test skipped. The final stricter preflight passed the real-Pi
supervised tools check. macOS regression passed **44 tests**, plus focused MCP
and preflight checks after the final refinements. Build/typecheck passed. See
[evidence](evidence/linux-support/verify.txt); the earlier drain race and
one-second MCP polling timeout are retained alongside passing results.

The release checker now selects the current platform ledger by default and
accepts `--platform darwin|linux` for explicit audits. Linux cannot inherit the
macOS release result. Six unit tests and strict typecheck passed on macOS and
Linux after synchronizing the Linux ledger into the VM. The Linux MCP transport
exposes all six tools and is registered as `pi_spoke_linux`; actual Codex
verification awaits tool reload. See [Linux host setup](linux-host-verification.md)
and [live evidence](evidence/linux-support/live-openrouter.json).
