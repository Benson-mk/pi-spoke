# pi-spoke — Safety Acceptance Matrix

**Specification 1.1 · application target 0.1.0 · 14 September 2026**

These are tests to implement, not reported passing tests. They supplement A01–A30 in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). A mocked sandbox or a correct-looking configuration is not evidence of OS enforcement.

## Test environment and evidence

Use temporary, disposable fixture directories owned by the test process. Create fake repositories, fake credentials, fake home directories, fake skill roots, and outside-root canary files. Never point destructive fixtures at the user's real repository, real credential files, or production network services. Network fixtures use controlled local endpoints; provider contract tests use a fake provider from the trusted Pi process.

For every OS test record platform/architecture/OS version, package-lock identity, SRT and system-binary identities, policy hash, invoked helper/tool, exit status, violation evidence where available, and before/after canary hashes. Validate both the forbidden operation and a nearby permitted operation: a sandbox that blocks everything is not a working implementation.

Use the actual public Pi tool registration path for integration cases. Include a small compiled or interpreter-based filesystem/socket probe so protection does not accidentally depend on recognizing command names. At least one negative case must call the relevant syscall through an interpreter other than Bash.

Tests are mandatory on every platform claimed supported. Tests of an optional policy may pass by returning the documented `SANDBOX_POLICY_UNSUPPORTED` before any untrusted command starts. That exception does not apply to the baseline source-read-only shell plus separately scoped file editing; failure of the baseline blocks the platform release claim.

## Matrix

| ID | Scenario | Required result |
|---|---|---|
| S01 | Default operator config; request `bash`, `edit`, or `write` | Explicit tool rejection before inference; no helper launched; no authority inherited from other config fields |
| S02 | Operator allows editing; spawn omits file-write roots | `WRITE_SCOPE_REQUIRED`; adding the tool alone does not authorize the workspace |
| S03 | Request a root partly or wholly outside the operator ceiling | Whole request rejected; no silent intersection, clamping, widening, or fallback |
| S04 | Enable `bash` with empty shell-write roots | Effective shell has read-only project plus private scratch; file-edit grants do not alter it |
| S05 | Delete source using `rm`, absolute `/bin/rm`, interpreter unlink, and directory removal | All source mutations blocked by the OS boundary, with canaries unchanged |
| S06 | Truncate/overwrite source using shell redirection, Python/Node file APIs, and rename replacement | Denied under source-read-only shell; testing only `rm` is insufficient |
| S07 | Modify an outside-root file, including a second configured workspace | Denied through shell and structured tools; access to one workspace does not authorize all workspaces |
| S08 | Perform an authorized structured edit while shell cannot edit the same path | Structured change succeeds; shell attempts fail; diffs and policy hashes identify the two paths of authority |
| S09 | Authorized structured write creates a file in an existing allowed parent | Succeeds without granting shell write rights; target guard and OS helper are actually exercised |
| S10 | Authorized `write` empties an ordinary allowed file | The test may succeed: record that permitted writes can destroy content. Do not mislabel the system “no data loss” |
| S11 | Write and delete a scratch file | Allowed only in the invocation/run-owned scratch; private state and other workers' scratch remain protected |
| S12 | Write or delete unrelated host `/tmp` / `/private/tmp` canaries | Denied; upstream implicit temporary grants cannot expose broad shared host temporary storage |
| S13 | Explicit existing build-output shell-write root | Output creation/removal works there; neighboring source/metadata stays protected. Missing root is rejected, not silently created |
| S14 | Broad workspace shell-write with protected paths absent | Enforcement blocks creation/replacement of the protected paths, or the policy is rejected before launch. No placeholder files appear in the real repo |
| S15 | Write, delete, or rename existing `.git`, `.codex`, `.agents`, `.pi`, `.pi-spoke`, and project instruction fixtures | Denied for guarded mutations and shell grants that advertise protection; test ancestor replacement as well as direct access |
| S16 | Worktree `.git` file points to metadata/common directory outside `cwd` | Visible pointer and resolved targets protected; metadata discovery runs no repository hook or custom command |
| S17 | Modify selected skill, operator config, installed helper, auth/model file, or saved state | Denied. Improvement proposals and suggested skills do not unlock protected resources |
| S18 | Traversal, sibling-prefix confusion, trailing slash, Unicode names, and macOS canonical aliases | Correct roots used; no string-prefix escape; valid in-root paths continue to work |
| S19 | Existing and newly introduced symlinks point from allowed paths to protected/outside paths | No out-of-scope write/read through aliases; structured mutation rejects unsafe symlink components |
| S20 | Hard-link/mount alias would expose protected/out-of-root inode under a writable path | Mutation denied or unsafe topology rejected; mandatory scratch-only source protection must still be demonstrable |
| S21 | Swap a target/ancestor during a structured operation; overlap pi-spoke edits | Identity/conflict detection or OS root restriction prevents an out-of-scope mutation; report limitations for hostile external races, never false atomicity |
| S22 | Nested and newly named protected metadata/instruction targets below normal scan depth | Structured guard rejects at operation time; shell policy either enforces the claimed exclusions or is rejected as unsupported |
| S23 | Read fake secrets after re-allowing a workspace inside a broader denied home root | Nested credential/state deny remains effective; rename-to-read bypass is blocked; selected normal source/skills remain readable |
| S24 | Tool environment/descriptor inspection | No provider key, auth cookie, preload/startup injection variable, SSH-agent socket, or supervisor control descriptor is inherited |
| S25 | Shell/helper network through direct IPv4/IPv6, proxy variables, loopback, DNS paths, or bind/listen | Denied as specified; no successful connection to controlled listeners; trusted Pi fake-provider call still works separately |
| S26 | Unix sockets, Docker/agent socket fixtures, and macOS Apple Events/Launch Services | No access to privileged host services; required missing controls cause failure before execution, not warning-only downgrade |
| S27 | Missing/invalid SRT config, missing binary, unavailable namespace, or required seccomp failure | `SANDBOX_UNAVAILABLE`, `SANDBOX_SETUP_FAILED`, or `SANDBOX_POLICY_UNSUPPORTED`; never raw execution or implicit backend defaults |
| S28 | Two simultaneous invocations with different roots; shell and writer run concurrently | Separate launcher configuration and policy hash; neither receives the other's writable roots, proxy state, or credentials |
| S29 | Attempt alternate stock Pi callbacks, search-tool executable substitution, or helper command/module injection | All active definitions use guarded paths; trusted absolute binaries; fixed helper payload is treated as data |
| S30 | Invalid policy, path alias, or operator revocation on continuation | `POLICY_CHANGED` or specific permission/sandbox error; no inherited stale authority and no new grant from a reply/steer |
| S31 | File/shell operation denied, then retried via main reply or auto-retry machinery | Existing grant remains unchanged; no automatic retry outside the sandbox or policy escalation |
| S32 | Cancel/host disconnect during shell, helper startup, subprocess, or double-fork/`setsid` fixture | All descendants stay restricted; clean termination is verified or reported unconfirmed. No false `cancelled`/cleanup claim |
| S33 | Crash after invocation acceptance or file mutation but before acknowledgment | Invocation receipt survives; unknown side effect is not replayed; safe continuation requires policy and cleanup revalidation |
| S34 | Ordinary command failure versus observed sandbox denial | Typed error distinction is truthful; no every-error-is-sandbox-denied classifier; diagnostics contain no secrets |
| S35 | Backend upgrade, changed binary, or altered policy compiler | Cached capability proof invalidated; pinned compatibility and real-OS negative tests rerun before enabling execution |
| S36 | Version-1 permissive config or unsafe fallback/network/weaker flags in version 2 | Explicit migration/validation error; primary shipped example is enforced read-only and cannot authorize shell by omission |

## Implementation coverage by milestone

P0 must establish real-OS canaries for S04–S08, S11–S12, S25–S29, and demonstrate the behavior of S14/S20. Unsupported security assumptions are found here, not after building the whole product.

P1 implements policy/schema/receipt semantics for S01–S03, S18, S30–S31, S33, and S36 using deterministic tests.

P2 implements the actual tool execution path and completes S04–S29 and S32–S34 with real Pi/backend fixtures. P3 exercises skills/questions against S17/S23/S30/S31. P4 verifies these guarantees through the compiled MCP server rather than only direct service calls. P5 runs all S01–S36 on the release platform matrix and verifies S35 during a controlled dependency-upgrade fixture.

## Reporting template

```text
Test ID:
Platform / OS / architecture:
Pinned dependency and binary identities:
Policy hash and supported/rejected mode:
Fixture and helper/tool:
Observed exit / violation / cleanup:
Canary hashes before and after:
Result: PASS | FAIL | BLOCKED | NOT RUN
Evidence location:
Limitation or follow-up defect:
```

`BLOCKED` and `NOT RUN` are not passes. A rejected optional permission shape must be labelled as unsupported in product documentation, not presented as an implemented sandbox capability. Live model performance does not substitute for any of these tests.
