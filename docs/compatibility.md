# Compatibility evidence

Verification date: 2026-09-14. P0 compatibility slice; **not release qualification**.
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

The P0 launcher is a disposable compatibility probe, not an application endpoint.
Each invocation initializes its own SRT manager with sanitized environment and
private scratch. There is no raw-execution fallback. The public argv wrapper on
macOS still returns an outer Bash `-c` command invoking Seatbelt; production
wrapper validation and process supervision remain required.

Upstream adds `/tmp/claude`, `/private/tmp/claude`, `$HOME/.npm/_logs`,
`$HOME/.claude/debug`, and six device paths to write grants. The probe denies the
four non-device grants and sets `CLAUDE_CODE_TMPDIR` to private scratch. SRT
creates a per-launcher Unix proxy socket under TMPDIR and local proxy
infrastructure. Long macOS TMPDIR paths exceed Unix socket limits; fixtures use
short random `/private/tmp/ps-*` directories. No whole `/tmp` grant is added.

Canaries show denied source unlink/truncate/redirection, denied unrelated
temporary/outside writes, permitted scratch create/delete, and a separately
writable helper envelope. Nested secret denies survive a workspace read
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
is not a passing S20 release result.

## Remaining gates

Linux, full guarded tool integration, hostile wrapper inputs, Apple Events,
all acceptance cases, crash/descendant cleanup, performance, manual Codex use,
and two live providers plus vision remain unqualified. An enclosing Codex
sandbox blocks SRT socket creation; run disposable canaries on an authorized
host boundary. That setup failure is not successful containment.
