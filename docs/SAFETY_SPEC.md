# pi-spoke — Safety and Sandbox Specification

**Specification:** 1.1\
**Target application release:** 0.1.0\
**Decision date:** 14 September 2026\
**Status:** Binding implementation requirements, not a claim of implemented or tested protection.

> **Thin policy, reliable runtime, autonomous agents.**
>
> **Granting a tool does not grant unrestricted machine authority. Execution permissions are separate, explicit, and enforced below the model.**

This document replaces specification 1.0's `trusted-local-shell` design. It is normative together with [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). [SAFETY_TESTS.md](SAFETY_TESTS.md) defines its release gates. No unsandboxed fallback is shipped in v0.1.

## 1. Scope and guarantees

The objective is to prevent delegated tools from modifying files outside authorized roots, and to let shell execution coexist with a source tree that the shell cannot modify. A worker may still perform separately authorized structured edits.

| Operation | Default | Explicitly authorized behavior |
|---|---|---|
| Read/search project files | Available through selected, guarded tools | Confined to the selected workspace and approved resources at the tool interface |
| Structured `edit` / `write` | Not granted | Operate only within the requested, operator-approved file-write roots |
| `bash` | Not granted | Runs in an OS sandbox; source is read-only unless separately granted shell-write roots |
| Shell writes | None to project or other host data | Per-run private scratch; additional literal roots only when explicitly requested and enforceable |
| Tool network | Denied | No tool-network opt-out or domain-grant interface in v0.1 |
| Persistent improvements | Proposals only | The main agent/operator performs a separately authorized change outside this worker's protected policy |

The trusted Pi runtime still contacts its configured model provider. Tool-network denial does not mean that inference is offline or that repository content cannot enter model context. The sandbox scope is **tool subprocesses**, not the complete MCP server or Pi process.

No general guarantee of “no data loss” is made: an authorized edit or write can replace correct content with incorrect or empty content. A shell granted write access to a directory can generally delete, rename, or corrupt files there. No `delete` tool is exposed; that is not equivalent to immutable data. Cancellation is not rollback.

## 2. Trust boundary

The trusted computing base consists of the operator-owned configuration, installed pi-spoke/Pi/SRT code, the supervisor, the worker adapter, fixed helper executables, and the OS sandbox implementation. These must not be writable through any worker grant.

The model's task text, generated shell code, repository scripts, tool outputs, and skill text are not trusted to grant authority. Approved skills are data until a granted execution tool runs a script, and that execution must use the shell sandbox. Disable arbitrary extensions, provider configuration from repositories, shell hooks, and dynamic module loading from task-supplied paths.

Contain accidental or model-directed filesystem/network violations, including a repository script trying an out-of-scope operation. Do not claim protection against kernel exploits, compromised trusted dependencies, an administrator, or a hostile same-user process modifying the runtime or racing the host filesystem. Permission checks must still handle adversarial paths and worker-created symlinks; excluding a hostile local account is not permission to ignore those tests.

Resource ceilings do not provide a hard memory, disk, CPU, or monetary budget. OS containment is not a substitute for backups or disposable environments when executing genuinely hostile code.

## 3. Permission contract

Keep the six MCP tools. Add a small data field, not an approval workflow or another planner:

```ts
type ExecutionPermissions = {
  file_write_roots?: string[];   // default []
  shell_write_roots?: string[];  // default []; excludes runtime-created scratch
};

// Add to SpawnInput:
// permissions?: ExecutionPermissions;
```

Every requested root must be an absolute, existing, canonicalizable directory under the selected workspace. Roots are literal paths, not patterns, and are bound to recorded real paths and filesystem identities. A shell-write directory must already exist; creating a build directory is a separate explicit file operation or operator/main-agent action, not a hidden shell-permission expansion.

The operator config has independent ceilings:

```ts
type OperatorPermissions = {
  file_write_roots: string[];
  shell_write_roots: string[];
};
```

`allowed_tools` is separate. Requesting `edit`/`write` without a nonempty authorized `file_write_roots` returns `WRITE_SCOPE_REQUIRED`. Requesting `bash` without operator authorization returns `TOOL_NOT_ALLOWED`. Granting `bash` with no `shell_write_roots` gives scratch-only writes. Requesting write roots without their corresponding tool returns `INVALID_ARGUMENT`.

**Reject, do not silently intersect or clamp.** The full requested policy must fit the operator ceiling and mandatory protections. Otherwise return `PERMISSION_DENIED` or `SANDBOX_POLICY_UNSUPPORTED` before inference. A request for `/repo` does not become a partially approved collection of children without the caller's knowledge.

Within valid roots, fixed protected-path exclusions are part of the published contract and effective manifest. They cannot be removed by a tool argument or operator per-session exception in v0.1. The main agent may choose any narrower authorized task scope; no task classification selects permissions.

Keep tools, write roots, working directory, and model immutable for a saved session. Replies and steering are text, not authorization. A stronger or different permission grant requires an explicit new session. Revalidate the original grant against the current operator policy on every continuation; a changed ceiling never broadens an old grant, and a revoked grant blocks continuation.

## 4. Effective permission manifest

Persist requested policy, resolved policy, and enforcement evidence separately. Before authorizing inference, the parent must record a manifest with at least:

```ts
type ExecutionManifest = {
  execution_mode: "sandboxed-tools";
  sandbox_scope: "tool-subprocesses";
  tools: string[];
  file_write_roots: string[];
  shell_write_roots: string[];
  shell_scratch_root: string | null;
  protected_read_paths: string[];
  protected_write_paths: string[];
  tool_network: "none";
  shell_read_model: "system-readable-with-explicit-denies";
  backend: {
    name: "srt";
    version: string;
    platform: "linux" | "darwin";
    enforcement: "bubblewrap" | "seatbelt";
  };
  policy_hash: string;
  preflight_id: string;
};
```

The type above is the executable-tool manifest. For an explicit `tools=[]` run, use a separate `execution_mode="no-execution-tools"` variant: selected tool/write lists are empty, `sandbox_scope`, `backend`, `preflight_id`, and scratch are null, and tool networking is inapplicable/denied. The fixed `contact_main` protocol capability may remain available. Do not use a fabricated backend or successful preflight for a tool-free run.

A field is reported effective only after configuration resolution and the required preflight. This records the authorized launch configuration; it is not a claim to have exhaustively audited the OS. Each actual tool launch also gets a validated invocation policy and launch receipt. Setup failure is a failure, not a reduced-permission retry behind the main agent's back.

`spoke_catalog(kind="tools", cwd=...)` reports tool availability, the ceilings relevant to that workspace, mandatory exclusions, and sandbox readiness without exposing credentials. It does not automatically install system packages or weaken host settings. Missing capability information is reported as unavailable or unknown.

## 5. Backend choice and isolation

Use **`@anthropic-ai/sandbox-runtime` (SRT)** through a private `SandboxBackend` adapter. The source-inspected package version for this revision is `0.0.76`; P0 must verify a corresponding installable artifact and lock its exact version/integrity. No automatic upgrade, global CLI installation, or `npx ...@latest`. Preserve required Apache-2.0 dependency notices. [B2][B3]

macOS uses the supported SRT Seatbelt path; Linux uses its bubblewrap/seccomp path. These are implementation mechanisms, not permission presets. Do not add a dependency on `codex sandbox`, patch Codex, or access OpenCode configuration. Codex is a design reference: its Linux sandbox layers writable roots over a read-only filesystem and re-protects narrower metadata paths. [B1]

Use a private application interface rather than spreading upstream calls:

```ts
interface SandboxBackend {
  probe(policy: ResolvedToolPolicy): Promise<SandboxCapabilityReport>;
  execute(invocation: SandboxedInvocation): Promise<SandboxedResult>;
}
```

These are pi-spoke types, not claimed SRT exports. The adapter performs policy compilation, validated startup, launch tracking, output bounds, and cleanup. It must not choose a model, task strategy, or alternate permission grant.

SRT's manager has module-level configuration and public initialization/wrapping interfaces. Therefore create **one sandbox launcher process per tool invocation**; do not mutate a shared manager across concurrent workers, shell calls, or writer helpers. The pinned version's public argv wrapper can avoid an outer shell when available and verified. No invocation uses another invocation's `updateConfig`. [B4]

Pass a complete validated configuration through an internal channel. Do not rely on `~/.srt-settings.json`, CWD config discovery, repository settings, partial default merges, or fallback when a config file is missing. The launcher receives neither provider credentials nor the supervisor's writable state descriptors.

## 6. Execution topology

```text
Main agent
    |
MCP supervisor + immutable permission resolver
    |
Trusted Pi session (provider connection; no model-callable raw execution)
    |
Guarded tool definitions
    |
Supervisor-authorized invocation
    |
Per-invocation sandbox launcher (one SRT configuration)
    |
    +-- read/search helper: no project writes, no network
    +-- fixed edit/write helper: scoped file writes, no network
    +-- bash process tree: separate shell-write roots, no network
```

All selected Pi tool definitions are replaced by registered, tested adapters. Never leave a stock `bash` callback or alternate `write` implementation reachable. Use the public tool schemas and useful result formatting; do not invent another task-facing coding language. The current Pi write definition explicitly allows replacement of its filesystem operations. [B7]

Read/search tools that invoke `rg`, `find`, or other executables use the same sandbox-launch path. A supposedly read-only tool must not execute a repository-controlled binary on the host. Even fixed helpers run inside the sandbox; resource/catalog parsing in trusted runtime code does not execute repository scripts.

A run with exposed execution/file tools requires sandbox readiness before inference. Catalog, observation, session listing, and cancellation remain available when the backend is unavailable. There is no automatic tool downgrading or hidden unsandboxed execution. A deliberately tool-free run may operate without filesystem helpers; document its narrower effective manifest as `execution_mode="no-execution-tools"`, not as sandboxed execution.

## 7. Shell policy

Launch the operator-approved shell by absolute path, with shell initialization disabled. Use an explicit sanitized environment, not a copy of the worker's environment. The command is intentionally arbitrary code, but must only begin executing **after** the OS boundary is established.

The shell sees its selected workspace as read-only unless `shell_write_roots` explicitly says otherwise. Grant no writable home, whole `/tmp`, whole `/private/tmp`, runtime installation, credential directory, or private state directory. Do not infer write grants from `tools=["bash"]`, `cwd`, `edit` permission, a filename mentioned in the task, or a failed build.

Create per-run shell scratch below an operator-owned `scratch_dir` separate from state, installation, credentials, and workspaces. Give it a random runtime-generated child name and 0700 permissions. Use private `HOME`, `TMPDIR`, and cache locations there. Canonicalize macOS path aliases before compiling permissions. Files in this directory are disposable to the worker; state and evidence are not stored there.

Every automatically created backend scratch/proxy/temporary directory must be inventoried as infrastructure or invocation-local storage. Audit upstream implicit writable paths in P0: deny or isolate broad host temporary access; an inherited global `/tmp` grant fails the acceptance test. Sandbox construction must not create missing protective files in the real repository as a side effect.

Examples under scratch-only shell permission:

| Action | Result required |
|---|---|
| `git diff`, repository search | Can run if the command requires no denied capability |
| Deleting or truncating a source file through any interpreter | Denied by the OS write boundary |
| Writing to another workspace or the user's home | Denied |
| Writing a report in the run scratch directory | Permitted |
| Tests that insist on writing caches beside source | May fail; no automatic relaxation |

The main agent may redirect cache/output paths to scratch, request an existing permitted build-output directory in a new session, or run the operation through its own separately configured environment. This is not a mandatory troubleshooting workflow.

When an enforceable shell-write directory is explicitly granted, deletion inside that directory is allowed by that filesystem grant. Display this consequence in catalog and effective policy. There is no parser-based promise that formatting/build commands are safe while other commands are not.

## 8. Structured file mutations

Keep `edit` and `write` distinct from shell authority. A worker may receive them with `file_write_roots=["/repo/src"]` while shell remains unable to modify `/repo/src`.

Only a fixed, installed helper may use the writer sandbox policy. It accepts a bounded, schema-validated file-operation message, not an arbitrary command, module name, executable path, or JavaScript expression. Task content and file contents are data. The helper does not invoke project scripts or shell callbacks. Never expose a general `run(command, writer_policy)` operation to the model.

The parent checks authorization and serializes overlapping pi-spoke mutations by canonical target. The helper independently validates the target and performs the actual guarded operation within the OS write envelope. Use Pi's public operations/definitions where possible; P0 must prove the checks run on every active mutation path. [B7][B8]

For every mutation:

1. Resolve the selected workspace and permitted root; reject path traversal, protected path components, and unrelated roots.
2. Resolve existing ancestors and inspect links. Reject symlink mutation targets and symlink traversal in mutation paths, nonregular targets, and pre-existing multiply-linked targets. Preserve system path aliases only through the canonical root established by the operator.
3. Revalidate identity inside the sandboxed helper immediately before opening. Use no-follow file operations and exclusive creation where supported. New parent directories are created only under the already approved root, one checked component at a time.
4. Use the public edit semantics for matching/patching; detect changes between the read snapshot and commit and report `FILE_CHANGED` where observable. Do not claim a cross-process transactional filesystem or an absolute race-proof compare-and-swap on every platform.
5. Perform the narrow operation, report the actual result/diff, and persist its tool outcome. Do not automatically retry after an uncertain write outcome.

Implement safe temporary-file replacement for complete writes when compatible with the pinned SDK, with a randomly named, exclusive temporary file in the authorized parent and identity checks before replacement. Temporary-file creation and replacement require parent-directory authority: record that actual helper envelope, not a fictitious file-only OS grant. Deny protected targets at the helper interface before granting a parent envelope. The trusted helper's typed-operation validation and the OS root boundary are both essential.

An authorized edit can remove important content. No heuristic percentage-of-lines rule, forced reviewer, automatic backup service, or rollback engine is added. The caller retains responsibility for reviewing the diff.

## 9. Protected paths and metadata

Automatically protect these from mutation by worker tools:

- The runtime installation, operator configuration, `state_dir`, credential/model configuration, and their resolved real locations.
- The selected workspace's `.git` metadata, resolved `gitdir:` targets and common Git directory, including worktree metadata outside `cwd`.
- `.codex`, `.agents`, `.pi`, `.pi-spoke`, and project instruction files such as `AGENTS.md` at the selected workspace boundary and discovered nested instruction/metadata locations.
- Configured external skill roots and selected skill files/assets. A suggestion to improve a skill does not unlock it.
- Additional operator-protected paths and upstream mandatory security exclusions.

For structured operations, reject reserved metadata path components and instruction-file targets even when they do not exist. Record both discovered real paths and reserved-path rules. The protected set is not bounded by an arbitrary three-level scan of the repository; apply file-operation checks at the actual requested depth.

For shell, compile concrete OS denies and test protection against direct writes, unlink, rename, replacing an ancestor, and symlink aliases. Read denial must not be defeated by renaming a denied file to an allowed name. Bind real Git targets as well as visible `.git` entries. Resolve Git pointer files without invoking hooks, external diff drivers, or project-controlled commands.

**Backend limitations must become explicit rejection.** SRT documentation notes Linux limitations for missing auto-protected paths and platform differences in path patterns; it is not a drop-in guarantee that every desired exclusion is enforceable. Use literal roots and denies in the portable interface. [B2][B5]

If a requested shell-write root contains a protected location whose missing-path, ancestor, or alias protection cannot be enforced by the pinned backend, return `SANDBOX_POLICY_UNSUPPORTED` before executing shell. Do not create placeholder directories in the host repo or claim a prompt fixes the gap. In particular, broad workspace shell-write may be rejected on Linux while source-read-only shell and a disjoint build-output root are supported. This rejection is the specified v0.1 behavior, not permission to weaken the boundary.

Fixed writer helpers additionally enforce their narrow typed operation. Do not confuse that trusted helper policy with safely executing arbitrary shell under the same broader parent-directory grant.

Hard-link and mount-alias fixtures must verify that an allowed writable alias cannot modify a protected or out-of-root inode. Reject pre-existing suspicious writable aliases and unsupported root topologies. A backend/platform that cannot meet the mandatory source-read-only shell test must not advertise that mode.

## 10. File reads, credentials, and network

The application file tools enforce the selected workspace plus explicitly authorized resource roots and required private input blobs. Deny state, credentials, unselected private skill directories, and configured secrets. Do not automatically expose all operator workspaces to every worker merely because they exist in the global configuration.

For arbitrary shell, document the narrower confidentiality claim: **system paths remain readable except explicit denies**. Use SRT's deny/read-exception mechanism for other home-directory data, private state, real provider credential locations, credential stores such as SSH/cloud configuration, and other workers' scratch. Re-allow only the selected workspace, selected skill resources, own scratch, and explicitly approved toolchain paths inside denied areas. A nested sensitive path must stay denied after reopening the workspace. Do not claim a complete filesystem-read allowlist unless that policy is separately implemented and tested. [B2][B6]

Strip provider keys, cookies, authorization data, `NODE_OPTIONS`, `BASH_ENV`, `ENV`, preload variables, proxy overrides, agent sockets, package startup injection, and inherited IPC descriptors from every launcher/helper/command environment. Runtime-created environment fields are explicit. Use trusted absolute executables; never discover the sandbox binary from the repository or a worker-writable PATH entry.

Tool network policy is `none`: block direct IP, IPv4/IPv6, proxy paths to denied destinations, loopback services, listening sockets, and access to privileged local sockets. Do not allow Docker sockets, SSH-agent sockets, Apple Events/Launch Services escape paths, or weaker nested/network sandbox modes. If a required seccomp or platform control is absent, treat it as a blocking prerequisite, not a warning followed by execution. Some platform limitations are exposed by the backend's dependency checks; test actual behavior as well. [B4][B6]

The provider client in the trusted Pi worker is outside this tool sandbox. Its permitted inference connection does not become a network grant for `bash`. Conversely, text a worker is authorized to read can enter its model conversation; blocking shell egress is not a data-loss-prevention system.

## 11. Fail-closed behavior and approvals

There is no `dangerously_unsandboxed`, `allow_unsafe_fallback`, or runtime policy-escalation tool in v0.1. Unknown config keys are errors. Missing configuration or enforcement failure never falls back to SRT defaults, stock Pi execution, or `codex sandbox`.

Return stable errors:

| Code | Meaning |
|---|---|
| `WRITE_SCOPE_REQUIRED` | Mutation tool selected without an explicit nonempty file-write scope |
| `PERMISSION_DENIED` | Requested authority exceeds the operator ceiling or mandatory protections |
| `SANDBOX_UNAVAILABLE` | Required backend, OS primitive, or dependency is absent |
| `SANDBOX_POLICY_UNSUPPORTED` | Requested policy cannot be truthfully enforced on this backend/platform |
| `SANDBOX_SETUP_FAILED` | A supported policy could not be applied for this invocation |
| `SANDBOX_DENIED` | A verified sandbox violation rejected a tool operation |
| `PROTECTED_PATH` | A structured request targets protected metadata/state/resources |
| `FILE_CHANGED` | A conflicting file mutation or changed identity was detected |
| `UNSAFE_PATH` | Link topology, target type, or canonical-root relationship is unacceptable |
| `POLICY_CHANGED` | Stored permissions no longer fit the current operator policy |

A nonzero command exit is not automatically `SANDBOX_DENIED`; retain ordinary command errors unless there is reliable violation evidence. Include sanitized operation/path, rule category, and policy hash when known. Unknown cause stays unknown.

A denied operation can be returned to the worker as a tool error so it can choose an in-scope alternative or contact the main agent. Do not automatically rerun it with broader rights. Loss of the enforcement mechanism itself stops the affected run before further executable work; record cleanup uncertainty honestly.

MCP approval authorizes a bridge call, not every descendant shell action. A `contact_main` reply is not human approval and cannot alter permissions. The operator may deliberately change local configuration; the agent cannot edit that protected configuration through its tools. No per-command interactive approval UI or destructive-command classifier is required for v0.1. Command names are not the security boundary.

## 12. Preflight, supervision, and recovery

`doctor --sandbox-check` runs only bundled, no-network, no-inference canary programs in disposable fixtures. It verifies allowed scratch writes, denied external/source writes and deletion, denied sensitive reads, and denied sockets/network. It checks the installed backend/binary identities and reports required privileges without modifying global sysctls, disabling AppArmor, installing software, or invoking `sudo`.

Cache capability evidence only by backend version, OS/architecture, binary identities, and policy compiler version. Changed identity invalidates the cache. Policy-specific root/protection checks still run on each invocation. Do not use a cached canary result as proof that a differently shaped writable-root policy is supported.

Admission validates static permissions before the durable spawn receipt. Worker setup runs the sandbox capability check before inference. Each helper launch validates the effective policy again. Configure a separate 15-second helper startup ceiling; do not quietly consume an unbounded run while waiting for an unavailable sandbox.

Supervise the launcher, sandbox wrapper, helper/shell, and descendants as one invocation. Track IDs, process birth identity, policy hash, start/terminal events, and cleanup result. Do not assume a process group alone handles double-fork or `setsid`. Linux namespace teardown and macOS process handling must be exercised with orphaning fixtures; surviving children remain restricted, but cleanup must be reported unconfirmed if exit cannot be established.

On host disconnect or cancellation, stop new invocations, request graceful termination, then escalate using the run's existing five-second/two-second cleanup windows. No untrusted descendant may inherit an unsandboxed control descriptor that keeps a broker alive or widens access.

Persist invocation receipts and permission manifests. Following a crash, do not replay shell or file writes. Recheck policy and cleanup before explicit session continuation. Never infer a successful write from partial stdout. Scratch cleanup uses a fixed runtime routine on recorded owned directories, refuses symlink substitutions, and never accepts a model-supplied deletion target.

## 13. Release requirements

P0 must prove SRT integration and the baseline source-read-only shell policy before broad application implementation. The project remains specification-only until those checks have actually run. A dependency installed successfully is not sufficient proof of enforcement.

All mandatory safety tests must pass on each claimed supported platform, in addition to A01–A30. Optional broad shell-write combinations may report `SANDBOX_POLICY_UNSUPPORTED`, with the rejection tested. The baseline read-only shell plus scoped structured editing must work on the release's claimed platforms; an unsupported baseline blocks that platform's release claim.

Ship safe examples first: read-only, then scoped editing with source-read-only shell, then optional isolated output writes. Do not include an unsandboxed example. Examples are static operator configurations, not model-routing presets or mandatory agent roles.

The reference host stays Codex. OpenCode and Oh My OpenAgent remain untouched. The MCP surface stays at six tools; the additional complexity is authority enforcement, not workflow intelligence.

## References and verification notes

Sources were read on 14 September 2026. This revision reviewed documentation/source; it did not install SRT, execute a sandbox, or verify macOS/Linux behavior. P0 records immutable source revisions and package-lock integrity for the implementation. These references support backend facts, not a claim that pi-spoke already exists or meets its requirements.

- **[B1]** OpenAI Codex Linux sandbox design, including writable-root layering and protected subpaths: https://raw.githubusercontent.com/openai/codex/main/codex-rs/linux-sandbox/README.md
- **[B2]** Anthropic SRT README, filesystem/network policy and platform caveats: https://raw.githubusercontent.com/anthropics/sandbox-runtime/main/README.md
- **[B3]** SRT source package manifest (`0.0.76` at review): https://raw.githubusercontent.com/anthropics/sandbox-runtime/main/package.json
- **[B4]** SRT manager state, dependency checks, and public wrapper interfaces: https://raw.githubusercontent.com/anthropics/sandbox-runtime/main/src/sandbox/sandbox-manager.ts
- **[B5]** SRT Linux sandbox implementation and mount construction: https://raw.githubusercontent.com/anthropics/sandbox-runtime/main/src/sandbox/linux-sandbox-utils.ts
- **[B6]** SRT macOS implementation and sandbox configuration surface: https://raw.githubusercontent.com/anthropics/sandbox-runtime/main/src/sandbox/macos-sandbox-utils.ts ; https://raw.githubusercontent.com/anthropics/sandbox-runtime/main/src/sandbox/sandbox-config.ts
- **[B7]** Pi public write tool and replaceable operations: https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/tools/write.ts
- **[B8]** Pi public edit tool and matching/result behavior: https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/tools/edit.ts
- **[B9]** Pi shell execution interface: https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/tools/bash.ts
