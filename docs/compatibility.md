# Compatibility evidence

Verification date: 2026-09-14. P0–P5 local evidence; **not complete release qualification**.
No platform is claimed supported yet.

| Component | Exact installed version | Registry revision |
|---|---|---|
| Pi coding agent / Pi AI | 0.85.1 / 0.85.1 | d981de1229ef899957bbe968bc8dcda02a21f477 |
| MCP SDK | 1.30.0 | 2d889f2b329e46680ec9bdd565de4616c497825a |
| SRT | 0.0.76 | npm gitHead absent; distribution integrity locked |
| TypeBox / Zod | 1.3.27 / 4.6.4 | distribution integrity locked |
| TypeScript / Vitest | 5.9.3 / 4.1.11 | distribution integrity locked |
| Node / npm | 24.15.0 / 11.12.1 | isolated Node installation |

Exact distribution integrity and transitive versions are in `package-lock.json`.
Initial lock SHA-256: `27101405527f2152175bf4c3eb42d31d23527b7beb490372a01f5d05367ee16f`.
Initial npm audit: zero reported vulnerabilities. Initial installation disabled
dependency lifecycle scripts; the installed public APIs execute successfully.
The host default Node 26 is outside the required Node 24 range.

Host: macOS 15.6 (24G84), Darwin 24.6.0, arm64.

| Binary | SHA-256 |
|---|---|
| `/usr/bin/sandbox-exec` | cbd6ab1e5a359afe9ed93b33dc65b5cd7544d364ed284542878505671ae7f83e |
| `/bin/bash` | b46e8d4eac541d79f77000550b4254b47599df8dd8c52cc5b0f37cca1c3b02d4 |
| `/private/tmp/pi-spoke-node24/node_modules/node/bin/node` | 3200fbd9f7fd4410426dd541e10d1ab829d3472f270d743c7fabd1696c03fe32 |
| `/opt/homebrew/Cellar/ripgrep/15.1.0/bin/rg` | a95906967134d19589fb57c4d4780b7dcf3ed0f5d846ea45e77e37c9e7af311c |

The SRT JavaScript/package manifest digest is
`e21d4fc6cc0f0c86c77e2de5cd09064895aee4ef3c308b4759979393b7d23fcb`.
Production checks OS, architecture, lock, Node, Bash, Seatbelt and compiler
identity before every invocation; search also verifies ripgrep. An actual
modified compiler copy is rejected before its launcher starts. No capability
cache currently bypasses these checks. Different identities require explicit
requalification; presence of a binary alone is insufficient.

## Public Pi behavior

The real SDK fixture uses public `ModelRuntime.registerProvider` with an
in-process fake provider. No paid endpoint is contacted. It exercises custom
tools, public writer-operation replacement, asynchronous contact, literal task
and steering input, native save/reopen, and empty/two-skill resource selection.

Pi clamps unsupported thinking; `confirmIdentity` rejects the mismatch before
inference. `AgentSession.steer` expands skill/template text; the public `prompt`
path with `streamingBehavior: "steer"` and `expandPromptTemplates: false` retains
literal text. Resource-loader overrides separately clear system and appended
system prompts. Discovery flags alone are insufficient. Captured requests
contain selected skill metadata but no bodies or ambient workflow instructions.
Pi's typed writer definition needs type erasure at the SDK's heterogeneous
custom-tool array under strict TypeScript; its schema and callbacks remain intact.

## SRT behavior

The isolated launcher established in P0 is now used by the supervised adapter.
Each invocation initializes its own SRT manager with sanitized environment and
private scratch. There is no raw-execution fallback. The public argv wrapper on
macOS still returns an outer Bash `-c` command invoking Seatbelt; production
wrapper quoting probes and supervised production file-tool tests pass.

Upstream adds `/tmp/claude`, `/private/tmp/claude`, `$HOME/.npm/_logs`,
`$HOME/.claude/debug`, and six device paths to write grants. The probe denies the
four non-device grants and sets `CLAUDE_CODE_TMPDIR` to private scratch. SRT
creates a per-launcher Unix proxy socket under TMPDIR and local proxy
infrastructure. Long macOS TMPDIR paths exceed Unix socket limits; fixtures use
short random `/private/tmp/ps-*` directories. No whole `/tmp` grant is added.

Canaries show denied source unlink/truncate/redirection, denied unrelated
temporary/outside writes, permitted scratch create/delete, and a separately
writable fixed helper envelope using Pi's public exact-edit implementation and
typed atomic writes. Nested secret denies survive a workspace read
exception; secret rename and missing protected-directory creation fail.
IPv4/IPv6 loopback, Unix sockets, and listening return EPERM. Concurrent
launchers do not share writable grants.

**Hard-link finding:** a pre-existing writable hard link permits source
modification. Creating a new source alias inside the sandbox returns EPERM.
`checkWritableTopology` rejects pre-existing multiply-linked files, symlinks,
special files, and mount crossings. Scanning does not protect against hostile
same-user host races. Broad shell-write policies still require full reserved
path and ancestor checks; the single missing-path probe does not qualify them.

[Recorded canary output](evidence/p0-macos-sandbox.txt) includes policy, lock,
canary hashes and exits. Cleanup is `wrapper-exited-descendants-unverified`;
descendant teardown is not yet proven. Characterizing the hard-link weakness
alone is not an S20 pass. The final suite combines that characterization with
production hard-link rejection and an actual mounted-volume rejection.

## Observed lifecycle and limits

Real Pi child processes connect to a local fake HTTP provider in the default
contract suite. Model selection, optional skills, private image snapshots,
correlated contact/reply, literal steering, native checkpoint reopening, worker
crash isolation, supervisor SIGKILL recovery, turn/wall limits, and provider
cancellation are tested. A compiled MCP SDK client exercises all six tools;
an actual sandboxed MCP run covers read and shell cancellation.

A detached child can outlive its shell wrapper while retaining its sandbox.
Every arbitrary-shell run therefore ends interrupted with unconfirmed cleanup;
output/checkpoints may be available, but continuation requires independent
operator attestation. Fixed file helpers are awaited to exit. Parent loss never
causes automatic task or tool replay. The implementation does not promise
exactly-once billing or termination of arbitrary detached descendants.

[Volume evidence](evidence/volume-macos.json) records a disposable 16 MiB HFS+
mount, topology rejection, real `ENOSPC`, a failed run with its receipt retained,
and verified detach/removal. [Performance](evidence/performance-macos.json)
records one local sample set: 616 ms MCP startup, 462–529 ms sandboxed read-tool
cost, 467 ms for three concurrent no-tool runs, 37 ms provider cancellation,
and 40,000 bytes of Unicode output retrieved in three pages. Sampled supervisor
RSS peaked at 425,376 KiB; worker-tree peak memory is not included. These are fake
provider measurements, not live model performance or a lightweight-memory claim.

## Supported candidate shapes and trust boundary

The tested execution slice is this exact macOS/arm64 identity, source-read-only
shell with private scratch, and independently authorized fixed file edits.
Project shell-write roots, including an existing build-output directory, fail
with `SANDBOX_POLICY_UNSUPPORTED`. Linux execution fails before tool launch.
No-tool runs report their no-execution mode rather than implying sandbox use.

The supervisor, Pi provider client, operator configuration, credential-command
configuration and installed dependencies are trusted control-plane code. Tool
subprocesses are sandboxed; the provider client is not. Permitted source/context
and images can leave the machine in provider requests. Shell reads use explicit
denies and system-readable paths, not total read confinement. Native sessions
retain conversation content. Authorized writes can empty or replace files and
have no rollback. Host same-user races, compromised kernel/dependencies, strong
CPU/memory/disk quotas, and malicious control-plane configuration are outside
the guarantee. The tested ancestor race prevented outside mutation; it is not a
proof of universal filesystem atomicity.

Pi's session retry setting is disabled. The pinned OpenAI-completions and
Anthropic request adapters construct SDK clients with `maxRetries: 0`; their
shared request retry helper also defaults to zero. Other provider integrations
may have their own transport semantics and require the opt-in live gates.

## Remaining gates

Direct Apple Events passed in the operator-run interactive fixture: outside
controls succeeded and sandbox delivery returned `-600`; the finite receiver
exited and its fixture was removed. [Interactive evidence](evidence/apple-events-macos-interactive.json).
The earlier noninteractive `-1744` consent block is retained as history.
Disposable Launch Services and Unix-socket checks also pass. Actual Codex host verification passed all six tools and lifecycle interactions.
[Host evidence](evidence/codex-host-verification.json). Two distinct live provider
integrations remain blocked on external input. The
supplied gateway passed Gemini sandboxed read, native continuation and image
input. Llama rejected automatic tool choice with HTTP 400 despite advertised
tool support; its upstream requires tool-choice/parser configuration. Both
models were configured through one OpenAI-compatible integration.
[Live results](evidence/live-gateway-macos.json) are partial release evidence.
The subsequently selected `iFiy/spark-x2.5-4b` passed sandboxed read and native
continuation with confirmed cleanup: [Spark results](evidence/live-spark-macos.json).
It is a verified tool-capable alternative to the failing Llama configuration,
using the same gateway integration.
Linux is not run and is not claimed supported. An enclosing Codex
sandbox blocks SRT socket creation; run disposable canaries on an authorized
host boundary. That setup failure is not successful containment.
