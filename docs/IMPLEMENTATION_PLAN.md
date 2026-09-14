# pi-spoke — Final Implementation Plan

**Specification:** 1.1\
**Target application release:** 0.1.0\
**Decision date:** 14 September 2026\
**Status:** Implementation specification; architecture and public semantics resolved. Code and live integration tests have not been implemented or run as part of this plan.

> **Thin policy, reliable runtime, autonomous agents.**

**Safety revision:** This version supersedes specification 1.0 for the same not-yet-released application 0.1.0. OS-enforced tool sandboxing is now a v0.1 requirement, not a future enhancement. [SAFETY_SPEC.md](SAFETY_SPEC.md) and [SAFETY_TESTS.md](SAFETY_TESTS.md) are normative companions; `CHANGELOG.md` records the migration. No application code or sandbox test results are included in this planning package.

## 1. Product definition and scope

**pi-spoke lets a main agent discover, start, observe, steer, and continue independent Pi workers, with optional skill suggestions and a worker-to-main communication channel.**

Build a new repository and implementation. Use `howznguyen/pi-delegate-mcp` as an implementation reference, not as the project tree to fork and progressively trim. [S1]

Codex is the first supported host. The server must not contain a Codex model name, modify Codex itself, or require OpenCode / Oh My OpenAgent. Another compatible local MCP host may use the same contract, but v0.1 release testing focuses on Codex.

### Frozen v0.1 decisions

| Area | Decision |
|---|---|
| Integration | Local MCP over stdio; no desktop injection or lifecycle hooks |
| Main intelligence | The host's main agent; no bridge planner or router |
| Worker intelligence | A main-selected model running through Pi |
| Worker execution | A supervised Node child process per active run, embedding the Pi SDK |
| Conversation | Fresh on spawn; explicit continuation of a saved session |
| Parallelism | Multiple independent runs; one active run per session |
| Skills | Explicit, optional, metadata-first shortlist; empty by default |
| Communication | Main-mediated; one worker-side contact tool |
| State | Local SQLite metadata/events plus Pi-native session files |
| Recovery | Resume saved context explicitly; never replay an uncertain run automatically |
| First platforms | macOS and Linux; Windows/WSL-specific process semantics are not claimed tested |
| Execution trust | Trusted control plane; OS-sandboxed tool subprocesses, with no unsandboxed fallback |
| Default authority | Read/search only; editing, shell, and project write scopes are not pre-authorized |
| Write permissions | Structured file-write roots and shell-write roots are independent |
| Tool network | Denied in v0.1; the trusted Pi provider client is a separate connection |
| Sandbox backend | Pinned SRT adapter; Linux bubblewrap/seccomp and macOS Seatbelt, subject to actual enforcement tests |
| Distribution | Buildable local npm project; publishing is not required for first use |
| Source license | MIT for original project code; preserve notices for any reused material |

### Explicit non-goals

Do not build fixed roles, model rankings, task classifiers, mandatory review/TDD/planning stages, task-to-skill routing, peer-to-peer agent messaging, nested-spawn tools, automatic persistent learning, a worktree manager, a generic multi-runtime framework, remote serving, a daemon, multi-tenant authorization, a dashboard, or a plugin marketplace.

Do not ship arbitrary Pi extensions, browser automation, computer use, or image generation in v0.1. Local image **input** is included. Later capabilities must satisfy the philosophy; they are not automatically promised by choosing a model with related abilities.

## 2. Philosophy as an implementation contract

[PHILOSOPHY.md](PHILOSOPHY.md) is the governing product document. It is not a long prompt to inject into every worker.

| Owner | Responsible for | Must not silently transfer to |
|---|---|---|
| Operator | Credentials, allowed tools, independent file/shell write ceilings, protected paths, maximum limits | Worker or untrusted project text |
| Main agent | Objective, delegation, model choice, skill suggestions, coordination, verification, integration | A hidden bridge policy |
| Worker | Local investigation and method within its assignment and capabilities | Peer workers or a new planner |
| pi-spoke | Identity, delivery, state, receipts, OS-enforced tool authority, conversation isolation, cleanup, honest errors | Prompt instructions alone |

The distinctions below must remain visible in the API:

```text
Task               = desired outcome
Model              = selected intelligence
Tools              = explicitly exposed operations
Permissions        = independent, OS-enforced execution and write authority
Suggested skills   = optional expertise
Project context    = explicitly scoped repository instructions and background
Operational limits = ceilings, not a workflow
```

Main-agent ownership does not mean the worker follows a prescribed sequence. Worker autonomy does not mean it can enlarge its permission envelope. A finished worker run is evidence, not automatic acceptance.

Every new core feature must either expose an otherwise inaccessible capability or enforce a runtime invariant. Features that choose *how to solve the user's task* belong in agent reasoning, optional skills, or documentation instead.

Granting `bash` does not grant project-write authority. Granting `edit` does not make the shell writable. Reject requested authority that exceeds operator ceilings; do not silently broaden or partially clamp it. Runtime enforcement is compatible with agent autonomy because it defines authority, not a development method.

## 3. Technical baseline and dependency policy

Use TypeScript in strict mode, ESM, npm, and Node 24.15 or later within the Node 24 line. Use `node:sqlite` behind a small storage module. The Node 24 documentation currently labels that module release-candidate rather than fully stable; this is an explicit tradeoff to avoid an additional native SQLite package. Do not spread its calls across the codebase. [S2]

The inspected source manifests identify these implementation targets:

| Dependency | Source-inspected target | Role |
|---|---|---|
| `@earendil-works/pi-coding-agent` | `0.85.1` | Agent sessions, resources, tool definitions, settings |
| `@earendil-works/pi-ai` | matching `0.85.1` | Public model/stream types and any directly imported helpers |
| `@modelcontextprotocol/sdk` | `1.30.0`, v1 API line | MCP server and stdio transport |
| `typebox` | `1.3.27` | Pi custom-tool schemas |
| `zod` | compatible v4; resolve an exact version during bootstrap | MCP input/output validation |
| `@anthropic-ai/sandbox-runtime` | source-inspected `0.0.76`; verify package and lock in P0 | OS sandbox adapter; no ambient/default config |
| TypeScript | `5.9.3` baseline | Build |
| Vitest | compatible v4; resolve an exact version during bootstrap | Tests |

Pi and MCP version numbers above were verified in repository manifests, not by successfully installing npm distributions in this session. Bootstrap must check registry availability, install exact versions, commit `package-lock.json`, and record the resulting versions in `docs/compatibility.md`. If a target is unavailable, report the packaging discrepancy; do not silently select an unrelated release. [S3][S4]

The SRT source target was inspected for specification 1.1; registry installation and platform enforcement were not tested here. Keep SRT imports in `src/sandbox/`. Pin the corresponding system binary paths/identities in compatibility diagnostics, and exercise their behavior rather than trusting a package version. Sandbox unavailability is a blocking condition for execution tools, never permission to use stock Pi shell behavior. [S17]

Use `npm ci` thereafter. Do not use runtime `npx -y ...@latest`, auto-update dependencies at startup, or change models because a dependency update changed its defaults.

Use public Pi exports only. Current public integration surfaces include `ModelRuntime`, `createAgentSession`, `SessionManager`, `SettingsManager`, `DefaultResourceLoader`, skill loaders, and custom-tool definitions. Pi's session-replacement APIs are distinct from a single `AgentSession`; v0.1 avoids confusion by reopening the selected session in a new child process for each continuation. [S5][S6]

## 4. Runtime architecture

```text
User
  |
Codex / main agent
  |-- native Codex work, when useful
  |
  +-- pi-spoke MCP server (stdio)
        |-- input validation and operator policy
        |-- catalog and resource resolution
        |-- durable session/run/event store
        |-- process supervisor
        |
        +-- trusted worker process: Pi SDK + selected model + guarded tools
        |       +-- invocation launcher -> OS sandbox -> read/search helper
        |       +-- invocation launcher -> OS sandbox -> fixed edit/write helper
        |       +-- invocation launcher -> OS sandbox -> bash and descendants
        +-- additional independent workers with their own immutable policies
```

There is no model running inside the supervisor to plan, route, summarize, judge, or decide whether to retry.

### Parent process

The MCP server owns the database, request receipts, the active-run map, admission limits, event persistence, worker supervision, immutable permission resolution, and sandbox-invocation authorization. Internal IPC messages carry a protocol version and run identity and are schema-validated; reject unknown message types and payloads above 1 MiB rather than trusting a child process blindly. Chunk larger output into bounded messages; images move through the private input store, not giant IPC payloads. It initializes a Pi model runtime for catalog access without loading project extensions. It performs no paid inference for discovery or output summarization.

MCP stdout is protocol-only. Diagnostics go to stderr. Child stdout/stderr must never leak directly into the MCP transport.

### Worker process

Start workers with `child_process.fork`, never by interpolating an agent task into a shell command. Each child owns one active Pi session/run, subscribes to Pi events, and communicates with the parent over typed IPC.

A session is persistent conversation identity. A run is one host-requested execution against that conversation and can include many model/tool turns. A child process is disposable execution machinery. Keep all three identifiers distinct.

After a normal terminal state and a confirmed session checkpoint, dispose the session and exit the child. A later continuation opens the same Pi session file in a new child. This avoids idle workers accumulating indefinitely and does not depend on a globally installed Pi CLI.

### Why process supervision is included

A child boundary keeps a worker crash from automatically becoming an MCP-server crash and gives cancellation a process-level fallback. It does not itself create a security sandbox. Tool subprocesses additionally use OS enforcement through the sandbox adapter; the Pi provider client and supervisor remain trusted control-plane code. Record `sandbox_scope="tool-subprocesses"` rather than presenting the complete worker as sandboxed.

Each tool invocation has a separate launcher and immutable SRT configuration. Do not share mutable sandbox-manager state across workers or mix the writer helper's authority with shell authority. The memory/startup cost must be measured, not hidden or advertised without data. See [SAFETY_SPEC.md](SAFETY_SPEC.md) sections 5–8.

### Connection and ownership boundary

Support one active MCP server per configured `instance_id`. Each instance has its own database and session directory and an exclusive process lock. A second server using the same instance fails with `INSTANCE_IN_USE`; it does not attach invisibly or corrupt state.

Several simultaneous Codex hosts must use different instance IDs. Reopening a previous instance after it stops exposes its saved sessions. v0.1 does not share live workers between Codex windows and does not infer a trusted Codex thread identity from arbitrary tool arguments.

## 5. Public MCP contract

Expose exactly these six host tools. Names are stable protocol surface; use `protocol_version: 1` in outputs.

| Tool | Purpose | Starts model work? |
|---|---|---|
| `spoke_catalog` | Discover models, skills, or tools | No |
| `spoke_spawn` | Start a fresh worker session and its first run | Yes |
| `spoke_observe` | Read status, events, or output; optionally wait briefly | No |
| `spoke_send` | Steer, answer a pending question, or continue a session | Depends on operation |
| `spoke_cancel` | Stop an active run without deleting the session | No new work |
| `spoke_sessions` | List saved sessions and their latest/active run | No |

No application-level `init` tool or mandatory discovery sequence. Normal MCP protocol initialization still occurs. Main agents may call `spoke_spawn` directly when they already know valid identifiers.

Use MCP JSON-schema inputs and structured outputs. Also return a concise text representation for hosts that do not surface structured results. Avoid returning the same long payload twice. Tool failures use `isError: true` plus a machine-readable error object; successful discovery/read tools have truthful read-only annotations. Annotations are hints, not authorization controls. [S7]

### 5.1 Common types and limits

The TypeScript below defines the application contract, not upstream Pi method signatures.

```ts
type ModelRef = { provider: string; id: string };
type ToolName = "read" | "grep" | "find" | "ls" | "edit" | "write" | "bash";
type ImageInput = { type: "image"; path: string };
type RunLimits = { wall_time_ms?: number; max_turns?: number };
type ExecutionPermissions = {
  file_write_roots?: string[];
  shell_write_roots?: string[];
};

type SpawnInput = {
  request_key: string;
  task: string;
  cwd: string;
  model: ModelRef;
  thinking?: string;
  tools?: ToolName[];
  permissions?: ExecutionPermissions;
  suggested_skills?: string[];
  project_context?: "agents" | "none";
  context_files?: string[];
  attachments?: ImageInput[];
  limits?: RunLimits;
};

type SendInput =
  | { kind: "steer"; request_key: string; run_id: string; message: string }
  | { kind: "reply"; request_key: string; run_id: string;
      question_id: string; message: string }
  | { kind: "continue"; request_key: string; session_id: string;
      expected_last_run_id: string; message: string;
      suggested_skills?: string[]; attachments?: ImageInput[];
      limits?: RunLimits };
```

All schemas reject unknown keys. `request_key` is a nonempty caller-generated string of at most 128 characters, unique within the instance. Require it for spawn and every send operation. IDs are opaque generated UUID-based strings, not paths or process IDs.

Task/message text is nonempty and limited to 64 KiB UTF-8. Tools and skill lists are deduplicated. Configuration, credential paths, arbitrary environment variables, and executable extension paths cannot be passed through these tools.

Both permission lists default to empty; neither inherits the operator maximum. Roots must be existing absolute directories in the selected workspace. File mutation tools require a nonempty file-write scope, and shell-write scopes require `bash`. The operator must separately allow every requested tool and root. Unauthorized requests fail rather than being silently intersected with an allowlist. Fixed protected-path exclusions remain in force within authorized roots. Scratch is runtime-owned and is not an arbitrary caller-specified root. Tool network remains `none` in v0.1. See [SAFETY_SPEC.md](SAFETY_SPEC.md) section 3.

### 5.2 `spoke_catalog`

Input: `kind: "models" | "skills" | "tools"`, optional `cwd`, `query`, `cursor`, and `limit` (default 25, maximum 100). `cwd` is required for skill discovery and must be within an operator-approved workspace. Skill searches only examine configured roots plus the explicitly enabled project skill directory.

Filtering is deterministic name/description substring matching. Do not add embedding search, another LLM, model scoring, or task classification.

Model entries include provider, model ID, display name, known input modalities, context window, maximum output, reasoning metadata, supported thinking options where known, authentication/configuration status, metadata provenance, and catalog timestamp. Cost metadata may be included only with its units and provenance; missing values are null, not zero.

An operator may supply a short `description` on an `allowed_models` entry to explain suitable uses. Match it by exact provider and model ID. Catalog entries return `description` and `description_provenance: "operator configuration"`, or null for both when absent. Descriptions participate in substring searches; they are operator guidance, not measured capability claims, model rankings, or routing rules.

Report `live_verified: false` unless an explicit external validation has actually been recorded. Configured credentials and a catalog entry do not prove current quota, entitlement, endpoint health, or successful access.

Skill entries include stable `skill_id`, name, description, source root, file location, content hash, and metadata diagnostics. Do not return complete `SKILL.md` bodies. Tool entries describe actual capabilities, selected-workspace permission ceilings, mandatory exclusions, and sandbox readiness. For `bash`, explain that source is read-only unless separately granted shell-write roots, network is denied, and writable directories permit deletion as well as modification. Do not describe shell availability as unrestricted local execution.

Catalog output never includes secrets, credential headers, or executable custom-provider configuration. No automatic network model refresh on each spawn. An operator `doctor --refresh-models` command may explicitly refresh the catalog; failed refreshes report stale metadata rather than inventing availability.

### 5.3 `spoke_spawn`

Create a fresh session. `model` is required: no default provider, task-based model choice, or fallback to the first authenticated model. `thinking` may be omitted; record the SDK's effective default before inference. When explicitly supplied, reject unsupported or silently clamped settings rather than changing the request without disclosure.

Defaults: read-oriented tools `read/grep/find/ls`, no file-write roots, no shell-write roots, no suggested skills, project `AGENTS.md` context enabled, no extra context files, no attachments. The primary operator example also excludes `edit`, `write`, and `bash` from its allowlist. The communication tool described in section 9 is always present as a protocol capability; it does not grant filesystem or model-selection authority.

Before admission, validate input, canonical roots, separate permission grants, protected-path exclusions, model identity, selected resources, known sandbox prerequisites, and capacity. Then atomically reserve the session, run, and request receipt. Return without waiting for model completion:

```json
{
  "protocol_version": 1,
  "session_id": "ses_<uuid>",
  "run_id": "run_<uuid>",
  "state": "starting",
  "receipt": "accepted",
  "effective_config": null
}
```

`effective_config` remains null until the child confirms its actual configuration. The confirmed event includes model, thinking, selected tools, resource manifest, requested/resolved permission policies, policy hash, sandbox scope/backend/version/preflight, scratch identity, and applied limits. A tool-free run uses `execution_mode="no-execution-tools"`; an executable/file-tool run uses `execution_mode="sandboxed-tools"` only after preflight succeeds. Do not present requested configuration as already effective.

The parent persists the child's Pi session identity/path and confirmed configuration before authorizing inference. Sandbox readiness and root-specific policy support must be established before a run with execution/file tools begins inference; every later tool invocation gets a fresh validated launch policy. If setup fails, the accepted run becomes `failed`; it does not disappear or silently retry.

### 5.4 `spoke_observe`

Input is a discriminated union:

```ts
type ObserveInput =
  | { run_id: string; view?: "summary" | "events";
      after_seq?: number; wait_ms?: number; limit?: number }
  | { run_id: string; view: "output";
      offset_bytes?: number; max_bytes?: number };
```

`summary` is the default. `wait_ms` defaults to zero and is bounded to 25,000 ms. Return immediately for terminal states, open questions, or events after the supplied cursor; otherwise wait until one occurs or the deadline expires. Waiting timeout returns `timed_out: true` and the actual state without stopping the worker.

Events have durable monotonically increasing sequence numbers. Reads are non-destructive. Repeating a cursor may repeat events; it must never consume them for another observer. The default view includes important reports, questions, limits, and final output preview, not the entire transcript or every tool delta.

`events` includes normalized tool start/end and lifecycle evidence, with truncation disclosed. Default event limit is 50, maximum 100. Response text/output previews are bounded to 16 KiB. Overflow is explicitly marked, and output can be retrieved with the `output` view using safe UTF-8 byte offsets and `next_offset_bytes`.

Observation never appends a user turn, loads a skill into the worker, runs an LLM summarizer, resumes a session, or acknowledges a worker question.

### 5.5 `spoke_send`

**Steer:** accepted only for a running run. Persist a delivery receipt, queue the message using Pi's supported steering interface, and report whether it is queued or delivered to the session. It does not promise that a currently executing shell command is interrupted, or that the model has obeyed. The parent learns delivery state through events. Pi documents steering and follow-up as distinct operations; preserve that distinction. [S8]

A run waiting on `contact_main(kind="question")` must be answered with `reply`, not by placing text into a steering queue that cannot unblock the waiting tool. Return `QUESTION_REPLY_REQUIRED` for that mistake.

**Reply:** answer exactly one open question from that run. Persist the answer before delivering it over IPC. An answer resolves the worker's pending tool call with text; it does not automatically approve additional tools, edit files, expand roots, or create a follow-up run. Reject stale/conflicting answers with the current question state.

**Continue:** accepted only when no run is active in that session and `expected_last_run_id` matches the latest recorded run. Create a new run in the same conversation. Keep model, tool grant, file/shell write roots, cwd, and project-context policy fixed for the session. Revalidate against the current operator ceiling and backend before each continuation; changed permissions return `POLICY_CHANGED` or a sandbox error. A different model, directory, or stronger permissions requires a new session with an explicit handoff.

On continuation, omitted `suggested_skills` retains the shortlist; an explicit array replaces it, including `[]`. Resource changes take effect before the next run. Do not mutate a running worker's resource loader. A worker requesting additional expertise can receive useful in-scope information in a reply or finish with a blocker, after which the main agent continues with a revised shortlist.

A continuation never silently restores an incomplete old command or repeats the previous task. It uses the newly supplied message against the last valid saved context and reports any interruption/uncertainty.

### 5.6 `spoke_cancel`

Input: `run_id` and optional textual `reason`. Cancellation is intrinsically idempotent. It sets `stopping`, rejects pending question waits, invokes Pi abort, and runs the cleanup protocol in section 10.

A completed run stays completed if completion won the race. Repeated cancellation returns the current state. Cancellation stops the run, not sibling workers, and does not delete the session or undo changes already made.

### 5.7 `spoke_sessions`

Input: optional cwd filter, cursor, and limit (25 by default, 100 maximum). Return session ID, created/updated timestamps, fixed model/cwd, latest run ID/state, active run ID, checkpoint availability, and whether continuation is currently eligible.

Do not start processes to list sessions. Do not expose unrelated Pi CLI history or sessions belonging to another pi-spoke instance.

## 6. Dynamic models without a hidden router

Use Pi's model runtime as the catalog and authentication integration boundary, not a list of provider/model names maintained in pi-spoke. Current public APIs provide model lookup and availability snapshots. Keep unknown metadata unknown. [S9]

Explicitly resolve `provider + id` and check the effective session model before the first inference call. Fail with `MODEL_UNAVAILABLE`, `MODEL_NOT_ALLOWED`, or `MODEL_CONFIGURATION_MISMATCH` where appropriate. A provider alias might still route internally; pi-spoke can report the identifier it submitted and any returned identity, not certify the provider's internal routing.

Bridge-level task retries and model fallback are disabled. Disable Pi's configurable automatic task retry behavior for the worker configuration. Document any upstream transport-level retries that remain; do not promise exactly-once provider billing.

Keep Pi-native context compaction enabled and observable. Compaction is context management, not a workflow decision. Do not replace it with a bridge-owned summarization agent.

Use local PNG, JPEG, and WebP inputs. Validate file signature, size, canonical path, and model image support before accepting them. Default limits are four images, 10 MiB each. Copy accepted image bytes into the run's private input store to avoid later path changes altering the submitted attachment. Do not accept URLs or silently drop unsupported images.

## 7. Optional skills and low-noise resource selection

### Discovery and identity

Skill directories are configured by the operator, not installed by the agent. Default global skill roots are empty. An operator can enable `<workspace>/.agents/skills` and add explicitly named external roots.

Use IDs of the form `<root-id>:<relative-skill-directory>`. Derive metadata with Pi's public skill-loading support; do not create a second skill format. Detect duplicate display names in the selected subset and report `SKILL_NAME_COLLISION` rather than relying on load order. Files marked not available for model invocation are not silently converted into suggested skills. [S10]

A catalog scan may read local files to parse metadata. The promise is about what enters model context, not that the process never reads the body from disk.

### Worker initialization

Resolve only the requested skill IDs. Validate their paths and hashes, then supply that subset to Pi's resource loader. The initial worker context contains metadata and locations, not concatenated skill bodies. A nonempty shortlist requires an explicitly granted `read` tool or a granted, sandbox-available `bash` tool whose read policy includes the selected skill resources; otherwise reject with `SKILL_READER_REQUIRED`. Do not grant shell merely to load a skill. Never silently grant a reader or claim that an invisible shortlist was exposed.

Use a small, fixed worker contract explaining that the shortlist is optional and may be ignored. No `/skill:...` expansion, automatic pre-reading, keyword routing, or minimum number of skills to use.

Pi's native progressive disclosure includes skill metadata in model-visible instructions and loads full instructions when the agent reads them. Therefore this feature is **not** “skills without any prompt/context representation.” Its guarantee is metadata-first, optional exposure—not invisible instruction-free discovery. [S10][S11]

### Selection is not permission

`suggested_skills` is not an access-control list. A permitted read tool may encounter another `SKILL.md` in the repository. pi-spoke does not hide ordinary files or claim to prevent that. The main agent narrows the initial choice set without forcing a workflow.

Skill instructions cannot enlarge the tool grant. A skill's script requires an authorized execution tool; its `allowed-tools` metadata does not automatically grant one. A skill body containing a heavy workflow remains a heavy skill once read. Do not rewrite it covertly or claim all third-party instructions become optional automatically.

### Resource changes

Record selected skill locations and hashes in each run manifest. Reject a changed selected skill before continuation with `RESOURCE_CHANGED`; the main can create a new session after reviewing the change. Source edits during a live run are not treated as a supported hot-reload mechanism.

For v0.1, preserve original skill directories so referenced scripts and assets resolve normally. Do not recursively copy arbitrary skill trees or execute skill setup commands during discovery.

## 8. Project context, tools, and resource loading

### No implicit global harness

Create in-memory Pi settings for workers. Do not load the user's global or repository Pi settings wholesale. Read only explicitly configured model/auth files through the model runtime.

Use `DefaultResourceLoader` with default resource discovery disabled, together with a narrow resource-loader facade/overrides that supplies exactly the selected resources. The effective surface must contain:

- No discovered extensions, prompt templates, themes, or global skills.
- No global `AGENTS.md`, inherited `SYSTEM.md`, or `APPEND_SYSTEM.md`.
- Only the selected skills and the project context defined below.
- Pi's normal tool-aware base prompt plus a small pi-spoke communication/autonomy contract.

Do not assume `noSkills` or `noContextFiles` also suppresses every other discovery mechanism. The current resource loader handles context files and system-prompt discovery separately. Cover both in tests. [S12]

### Project instructions

When `project_context="agents"`, load `AGENTS.md` from the approved project root down to `cwd`, in ancestor order. Do not walk above the approved project boundary or import home-directory instructions. Additional explicit `context_files` must be readable files in approved roots.

Record paths and hashes and cap total injected project text at 64 KiB. Reject an oversized context manifest instead of silently discarding important instructions. `project_context="none"` disables automatic project instructions but not explicit context files.

Project instructions can themselves prescribe workflows. pi-spoke does not impose those rules; the main agent has explicitly chosen the repository context policy. Keep this distinction visible in the effective manifest.

### Execution capabilities

Use public Pi definitions or wrappers with guarded execution callbacks. The callable surface, not the prompt, enforces the selected tool set. All file/executable tool operations use fixed helpers or a shell beneath a supervisor-authorized OS sandbox. Read/search tools that launch an executable use the same boundary; no repository-controlled binary runs outside it.

`cwd` selects one operator-approved workspace. Application read roots are that workspace plus selected/explicitly approved resources, not all configured workspaces. Write authority comes from `permissions.file_write_roots` for fixed structured helpers and independently from `permissions.shell_write_roots` for shell. Neither defaults to the entire workspace. Protected metadata, state, credentials, installation files, and selected skills are not writable through either route.

The default shell policy, when `bash` is explicitly granted, leaves project files read-only and grants only runtime-created private scratch. Tool networking is denied. An explicit shell-write grant permits destructive operations inside its writable region; it is not a safe-command exception. Full-workspace shell-write is rejected when the backend cannot enforce all protected-path exclusions.

File helpers validate canonical roots, reserved targets, link topology, and target identity before mutation. They run fixed typed operations, never arbitrary shell with writer authority. [SAFETY_SPEC.md](SAFETY_SPEC.md) defines the complete path, scratch, environment, network, and helper contracts and their limitations. Treat it as a dependency of implementation, not optional documentation.

Use Pi's supported tool-definition/operations boundary to replace stock execution and retain useful tool schemas. Track sandbox launchers, helpers, and descendants explicitly; killing only the worker PID does not demonstrate shell cleanup. [S13][S17]

No arbitrary extensions are exposed. A future approved tool adapter needs the same authority model; it must not bypass sandboxing by being called a skill or plugin.

## 9. Worker communication and improvement

Expose one custom tool to each worker:

```ts
type ContactMainInput = {
  kind: "note" | "question" | "improvement";
  message: string;
  evidence?: { path?: string; line?: number; detail: string }[];
};
```

The tool is named `contact_main`. The runtime attaches session/run identity itself; the worker cannot choose a recipient or impersonate another worker.

**Note:** persist an event, acknowledge it, and continue. Use for a finding, risk, blocker report, or progress worth surfacing. No main-agent interruption is promised.

**Question:** persist an open question, mark the run `waiting_input`, and await a correlated reply, cancellation, or run deadline. The pending tool resolves only after a reply is committed. Pending questions are always included in summary observation. Limit outstanding questions to the run's actual active tool calls; duplicate tool-call delivery must not create duplicate questions.

**Improvement:** persist a proposal as evidence. It is otherwise nonblocking. It does not change a skill, repository instruction, test, routing policy, or future session automatically.

Communication is pull-based from the host's point of view. The parent may have fresh events ready, but v0.1 does not assume MCP notifications cause Codex to schedule a new model turn. Normal observation and bounded waiting are the guaranteed path. Do not depend on experimental MCP tasks, sampling, or elicitation for this channel. [S4][S7]

Coordination remains:

```text
worker finding -> main judgment -> optional message to another worker
worker question -> main answer -> same worker continues
worker proposal -> main evaluation -> deliberately authorized persistent change
```

No automatic critic loop, consensus algorithm, skill editing, or weights training. Iterative improvement within a task is possible through steering, continuation, and main-mediated review; the bridge does not schedule it.

## 10. State, durability, cancellation, and recovery

### Run state machine

```text
starting -> running <-> waiting_input
    |          |             |
    +----------+-------------+-> stopping -> cancelled
    |          |
    |          +-> completed
    +------------> failed

Any nonterminal state can become interrupted after an unclean process loss.
```

Terminal states are `completed`, `failed`, `cancelled`, and `interrupted`. Never reuse a run ID for a new execution. Continue creates a new run in the same session.

| State | Exact meaning |
|---|---|
| `starting` | Admitted and durably recorded; worker setup or handshake in progress |
| `running` | Worker has confirmed configuration and is executing the accepted run |
| `waiting_input` | At least one worker question is awaiting a correlated main reply |
| `stopping` | Stop has been requested; cleanup is not yet confirmed |
| `completed` | Accepted prompt has settled normally, final output and checkpoint were durably recorded |
| `failed` | A known setup/provider/runtime failure ended the run |
| `cancelled` | Execution was stopped intentionally, including a run-limit stop, with cleanup outcome recorded |
| `interrupted` | Execution was lost or its terminal outcome cannot be confirmed |

If managed-process cleanup cannot be confirmed, use `interrupted` with `cleanup_status="unconfirmed"`, not a successful `cancelled` claim. Record reason codes separately. `completed` must never mean “a tool returned,” “some output appeared,” or “the code is correct.” In current Pi, session events distinguish an agent end from a fully settled session; the adapter must check prompt settlement and idle state, not rely on one early event. [S16]

### Storage model

Use SQLite with foreign keys, WAL mode, `synchronous=FULL`, parameterized statements, and short transactions. Fsync completed session/output files and atomically replace manifests before committing references that promise durability. If durable acceptance cannot be committed, do not launch work; if terminal persistence fails, do not report durable completion. Only the parent process writes the database. Use the built-in Node SQLite module only in `src/store/`.

Minimum tables:

| Table | Essential fields and constraints |
|---|---|
| `sessions` | session ID, created/updated times, immutable config, Pi ID/path, last run ID, safe checkpoint reference, continuation eligibility |
| `runs` | run ID, session FK, state/reason, input, requested/effective manifests, timestamps, outcome, output reference, usage, cleanup status |
| `commands` | unique request key, operation, canonical input hash, durable receipt, delivery state |
| `events` | global sequence ID, run FK, type, sanitized payload, timestamp, unique source-event identity |
| `questions` | question ID, run FK, unique tool-call identity, open/answered/closed state, answer, timestamps |
| `tool_invocations` | invocation ID, run FK, unique tool-call identity, tool kind, permission hash, helper/process identities, launch/outcome evidence, cleanup status |

Add a unique partial index ensuring at most one nonterminal run per session. Serialize state-changing operations for a run within the supervisor as well as using database constraints.

Use database schema versions and explicit migrations. Back up before a migration. Refuse to open a database from a newer unsupported schema. Do not mutate it speculatively.

Private state layout:

```text
<state_dir>/<instance_id>/
  instance.lock/
  state.sqlite
  state.sqlite-wal
  state.sqlite-shm
  sessions/<session_id>/<Pi-native session file>
  runs/<run_id>/input/
  runs/<run_id>/output.txt
  runs/<run_id>/manifest.json
  runs/<run_id>/diagnostics.jsonl
```

Shell-writable scratch lives in a separate operator-owned `scratch_dir/<instance_id>/<random-run-child>/`, not beneath private state. The worker may alter its own scratch; it cannot alter receipts or transcripts. Store effective permission manifests and sandbox capability evidence in private state. Never automatically grant the shell write access to the whole temporary-files directory.

Directories are user-private (0700 where supported), files 0600. Persist credentials in neither the database nor manifests. Treat transcripts and artifacts as sensitive user data, even after redaction.

### Duplicate-request protection

For spawn/send, canonicalize the request object and compute a hash without changing the text of the task/message. Store operation + hash + receipt under `request_key`.

Same key and same input returns the existing receipt/IDs without issuing a new execution or message. Same key with a different operation or input returns `IDEMPOTENCY_CONFLICT`.

Validation/admission failures before reservation do not consume a key. Once accepted, the key is durable even if startup subsequently fails. Capacity rejection can therefore be retried; an accepted failed run cannot be silently restarted by repeating its key.

Commit acceptance before launching the worker or forwarding a message. A crash between acceptance and dispatch is reported as interrupted/undelivered; it is not automatically replayed. A crash between dispatch and acknowledgment may produce an uncertain delivery. Report that uncertainty rather than pretending to know whether external side effects happened.

This provides duplicate suppression for accepted requests. It is not exactly-once tool execution, exactly-once provider billing, or a distributed transaction with the model provider.

### Checkpoints and resume

Pi owns its native session representation. The child uses public `SessionManager.create(cwd, sessionDir)` or `SessionManager.open(path)` and records the Pi/session mapping before inference. [S6]

A safe checkpoint must contain a valid conversation branch with no unresolved tool-result obligations. Record a confirmed safe leaf at normal run completion. Where a cancelled run can be validated as a safe checkpoint, it may also be continued. Do not advertise resumability solely because a `.jsonl` file exists.

After an interruption, retain partial transcript/evidence. If necessary, continue from the last confirmed safe branch using public session navigation and append an explicit recovery notice. Preserve the interrupted branch rather than silently deleting history. If no safe checkpoint exists, return `SESSION_NOT_RESUMABLE`; the main can spawn a new session with an explicit handoff.

Before continuing, verify the original model is still available, original file/shell roots remain authorized, protected-path resolution and sandbox readiness still hold, resources have not unexpectedly changed, and old worker/helper cleanup is confirmed or explicitly operator-attested as described in section 14. A skill shortlist change explicitly requested in `continue` is intentional; other changed pinned resources fail with `RESOURCE_CHANGED`.

The recovery notice must identify the checkpoint used, interrupted run, uncertain tool outcomes, and possible workspace changes. Never synthesize a successful tool result to repair history. Never re-execute an unfinished command to make the transcript look complete.

### Process cleanup

On cancellation: stop accepting new work for the run, reject pending questions, request Pi abort, and wait up to five seconds. Then terminate managed worker/shell process groups, escalating from SIGTERM to SIGKILL after a further two seconds if necessary. Track shell groups explicitly; do not signal arbitrary stored PIDs without checking ownership/identity.

The sandbox backend must report each launcher/helper/shell invocation lifecycle over IPC and handle its abort signal. Include process birth identity, invocation ID, policy hash, and cleanup result; do not trust arbitrary tool stdout as a control message. The worker must abort and clean up on IPC disconnect. A parent heartbeat every five seconds provides a second liveness check; a worker must stop after fifteen seconds without a parent heartbeat.

Graceful MCP stdin closure means supervisor shutdown: stop workers, preserve state, then exit. It is not a request for unattended execution. A later connection may continue saved context, not resurrect the old process.

On startup, do not auto-restart nonterminal runs left in the database. Mark them interrupted and reconcile cleanup. If old process ownership/cleanup cannot be confirmed, report `cleanup_status="unconfirmed"` and block continuation of that session until the operator resolves it through `doctor`. A stale lock with an apparently live/reused PID must not be removed automatically.

Test normal descendants, double-fork/`setsid` attempts, parent death, and namespace/helper teardown. Process-group termination alone is not proof of complete cleanup. Descendants must retain sandbox restrictions; inability to verify that they exited yields `cleanup_status="unconfirmed"` and blocks silent continuation. Apply platform-specific behavior honestly; see [SAFETY_SPEC.md](SAFETY_SPEC.md) section 12.

### Timeouts and limits are distinct

| Setting | Default | Meaning |
|---|---|---|
| Active runs per instance | 3 | Admission ceiling, not a requested team size |
| Run wall time | 1,800,000 ms | Includes model work, tools, and waiting for an answer |
| Model/tool turns per run | 64 | Stop before beginning another turn once exhausted |
| Individual shell command | 120 seconds | Maximum without an operator-configured higher ceiling |
| Worker startup | 30 seconds | Fail setup that does not finish its handshake |
| Sandbox helper startup | 15 seconds | Fail a tool invocation that cannot establish its required boundary |
| Observe wait | 0; maximum 25 seconds | Time this MCP read may wait; never the worker's lifetime |
| Response preview | 16 KiB | Truncate visibly; use output pagination for more |
| Images | 4, at most 10 MiB each | Input admission limits |

Host-supplied run limits can lower operator ceilings, not exceed them. Hitting a run ceiling cancels with a specific reason. Count context-compaction work in usage and wall time; do not report it as free.

Do not add automatic task retry. A main agent can deliberately continue or create another run with a new request key after inspecting the failure. Cumulative usage across sessions is observable; no hard dollar budget is claimed when pricing/usage is missing or delayed.

MCP request cancellation and run cancellation are different concerns. Cancellation of an observing tool request only stops that read. Once a spawn has been accepted, cancellation/loss of its MCP request does not by itself undo the accepted run. Explicit `spoke_cancel` controls run lifetime. [S14]

## 11. Error and observability contract

Errors use this application shape inside an MCP error result:

```json
{
  "protocol_version": 1,
  "error": {
    "code": "SESSION_BUSY",
    "message": "The session already has an active run.",
    "safe_to_retry_same_request": false,
    "session_id": "ses_<uuid>",
    "run_id": "run_<uuid>"
  }
}
```

Include relevant IDs only when known. `safe_to_retry_same_request` concerns protocol/receipt safety, not a recommendation that another model attempt would solve the task.

Stable error families: `INVALID_ARGUMENT`, `INSTANCE_IN_USE`, `MODEL_UNAVAILABLE`, `MODEL_NOT_ALLOWED`, `MODEL_CONFIGURATION_MISMATCH`, `UNSUPPORTED_THINKING`, `UNSUPPORTED_INPUT`, `TOOL_NOT_ALLOWED`, `PATH_NOT_ALLOWED`, `SKILL_NOT_FOUND`, `SKILL_NAME_COLLISION`, `SKILL_READER_REQUIRED`, `RESOURCE_CHANGED`, `LIMIT_EXCEEDED`, `CAPACITY_EXCEEDED`, `SESSION_BUSY`, `SESSION_STALE`, `SESSION_NOT_RESUMABLE`, `QUESTION_REPLY_REQUIRED`, `QUESTION_CLOSED`, `RUN_NOT_ACTIVE`, `IDEMPOTENCY_CONFLICT`, `PROVIDER_ERROR`, `WORKER_EXITED`, `STATE_CORRUPT`, `STATE_WRITE_FAILED`, `WRITE_SCOPE_REQUIRED`, `PERMISSION_DENIED`, `SANDBOX_UNAVAILABLE`, `SANDBOX_POLICY_UNSUPPORTED`, `SANDBOX_SETUP_FAILED`, `SANDBOX_DENIED`, `PROTECTED_PATH`, `FILE_CHANGED`, `UNSAFE_PATH`, `POLICY_CHANGED`, and `INTERNAL_ERROR`.

Preserve sanitized upstream error details where useful; do not turn every failure into an empty success response. Report `SANDBOX_DENIED` only with reliable violation evidence, not for every nonzero command exit. Permission-denied tool results can be handled by the worker within the existing grant; never auto-retry outside the sandbox. Loss of enforcement stops executable work.

Event types include: accepted, effective configuration, sandbox preflight/launch/denial/cleanup, policy rejected/changed, started, tool started/ended, note, question opened/answered/closed, improvement proposed, steer queued/delivered/uncertain, compaction, limit reached, cancellation requested, checkpoint, and terminal outcome.

Output observation returns worker-authored text and actual recorded evidence. It does not run a hidden summary model or force the worker's prose into an eight-field answer template. Runtime outcome fields are structured; task results may be natural language.

Track input/output/cache tokens where upstream reports them. Store unknown values as null and mark cost as an estimate when calculated from catalog rates. Report elapsed time, tool counts, effective model, selected/read skills where observable, and pending questions.

Do not request or separately capture private chain-of-thought. Exclude provider reasoning deltas from the public event feed. Pi-native transcripts may retain provider-specific session material required for continuation; document that they are private, potentially sensitive state.

Environment credential values, authorization headers, cookies, and recognized secrets must be redacted from diagnostic/error surfaces. Do not claim perfect secret detection in arbitrary model-generated text. No telemetry or network analytics in the bridge.

Keep history until explicitly removed. Provide operator-only `gc --older-than <days> --dry-run` and a separate explicit deletion flag. Never delete active sessions, remove credentials, or expose automatic cleanup as a model-triggered workflow. Retain request-key tombstones when pruning payloads; duplicate keys must not become fresh jobs after cleanup.

## 12. Authentication and trust boundaries

Use Pi's public authentication/provider integration with operator-configured auth/model files or environment variables. Do not reimplement OAuth, collect credentials through MCP prompts, or import repository provider configuration. Native refresh of the configured credential store is trusted runtime work, distinct from model-callable tools. [S9]

The trusted Pi worker needs the selected provider connection. Its tool subprocesses do not inherit those credentials or unrestricted provider-network authority. Use sanitized environments, closed control descriptors, denied credential/state locations, trusted executable paths, and OS filesystem/network enforcement. The provider process is not claimed to be inside the tool sandbox.

Operator configuration defines ceilings, and spawn supplies explicit narrower grants. Invalid requests are rejected in full. Replies, skill metadata, prompts, and MCP approval cannot expand a session's permissions. There is no per-command approval UI or unsandboxed override in v0.1.

[SAFETY_SPEC.md](SAFETY_SPEC.md) is the complete normative trust model. It requires source-read-only shell by default when enabled, separate structured-edit permissions, protected metadata/skills, denied tool networking, and fail-closed backend behavior. It also states what is not guaranteed: authorized writes can damage content; system shell reads use explicit denies rather than total read confinement; provider-bound model context may contain permitted file content; kernel/dependency compromise, hostile same-user processes, and unlimited resource consumption are not solved.

Do not assume Codex's native sandbox automatically contains an independently launched Pi process. Borrow the boundary design, not an implicit trust claim or Codex binary dependency. [S18]

Concurrent workers may still share filesystem state. The main agent owns worktree creation, write-scope assignment, and integration. The bridge neither merges nor claims filesystem snapshot isolation. A Git worktree separates change management, not OS authority. Surface active directories and actual write scopes in status.

## 13. Repository layout and implementation boundaries

```text
pi-spoke/
  README.md
  AGENTS.md
  CONTEXT.md
  LICENSE
  package.json
  package-lock.json
  tsconfig.json
  src/
    cli.ts
    config.ts
    mcp/
      server.ts
      schemas.ts
      tools.ts
    core/
      service.ts
      types.ts
      state-machine.ts
      idempotency.ts
      limits.ts
    store/
      database.ts
      migrations.ts
      repositories.ts
    runtime/
      supervisor.ts
      ipc.ts
      worker-entry.ts
      cleanup.ts
    pi/
      runtime.ts
      models.ts
      resources.ts
      skills.ts
      tools.ts
      contact-main.ts
      events.ts
    security/
      policy.ts
      paths.ts
      protected-paths.ts
      environment.ts
      redaction.ts
    sandbox/
      backend.ts
      srt-backend.ts
      launcher-entry.ts
      policy-compiler.ts
      preflight.ts
      diagnostics.ts
    helpers/
      file-tool-entry.ts
      file-operations.ts
  tests/
    unit/
    contract/
    integration/
    fixtures/
    sandbox/
    live/
  docs/
    README.md
    PHILOSOPHY.md
    IMPLEMENTATION_PLAN.md
    IMPLEMENTATION_TASKS.md
    SAFETY_SPEC.md
    SAFETY_TESTS.md
    adr/
    agents/
    specs/
    architecture.md
    api.md
    security.md
    codex.md
    compatibility.md
  examples/
    config.read-only.json
    config.scoped-edit.json
    config.scoped-edit-with-output.json
    codex-config.toml
```

`src/core` does not import Pi or MCP. `src/pi` contains the version-sensitive public SDK integration. `src/mcp` validates and translates transport requests into service calls. `src/runtime` manages process/IPC behavior. `src/security` resolves operator grants; `src/sandbox` is the only SRT integration boundary; `src/helpers` exposes fixed typed operations, not arbitrary code under writer authority. Use a small fake runtime for deterministic tests; do not build a general backend/plugin framework merely to make mocking possible.

Custom-tool overrides must go through Pi's supported public tool-definition registration surface and keep the same useful tool schemas. Prove that guarded implementations actually replace the active tools; registering a wrapper that the agent never calls does not satisfy the security contract.

Pass task/continuation/steering text through a public prompting path with command/template expansion disabled. A literal `/skill:...` or slash-command-looking task must remain task text. Do not use unsafe prompt-string patching, private imports, or terminal output parsing.

Use Pi events to map completion, not terminal heuristics. Keep internal handler logic shared across tools; no separate “sync run” implementation, parallel-task DSL, or second execution engine.

## 14. Configuration and first local use

Required configuration is operator-owned. Refuse startup without an approved workspace. Never default a write scope to home, `/`, `/tmp`, or the entire workspace. State, scratch, installation, credentials, and project roots must have safe, nonoverlapping canonical locations as specified in [SAFETY_SPEC.md](SAFETY_SPEC.md).

**Configuration schema version is now 2.** Reject version-1 files with an explicit migration error. Do not silently reinterpret a previously broad `allowed_tools` list as permission for either kind of write. The six-tool MCP protocol stays version 1 because no application release has shipped; document the updated pre-release input schema.

Primary example, `examples/config.read-only.json`:

```json
{
  "version": 2,
  "state_dir": "/absolute/path/to/private-state/pi-spoke",
  "scratch_dir": "/absolute/path/to/private-scratch/pi-spoke",
  "workspace_roots": ["/absolute/path/to/project"],
  "allowed_tools": ["read", "grep", "find", "ls"],
  "permissions": {
    "file_write_roots": [],
    "shell_write_roots": []
  },
  "sandbox": {
    "backend": "srt",
    "required": true,
    "tool_network": "none",
    "additional_read_deny_paths": [],
    "additional_write_deny_paths": [],
    "additional_toolchain_read_paths": []
  },
  "skill_roots": [],
  "project_skills": false,
  "pi": {
    "auth_path": "/absolute/path/to/pi/agent/auth.json"
  },
  "limits": {
    "max_active_runs": 3,
    "max_run_wall_time_ms": 1800000,
    "max_run_turns": 64,
    "max_shell_command_seconds": 120,
    "max_sandbox_startup_seconds": 15
  }
}
```

An empty *additional* deny list does not remove mandatory protections. `sandbox.required=false`, non-`none` tool network, unsafe fallback keys, and weaker backend flags are invalid in v0.1. Platform/binary configuration is operator-owned; use trusted paths resolved outside the workspace and record their identities during preflight.

The separate `config.scoped-edit.json` example permits `edit`, `write`, and `bash`, sets operator file-write ceilings to project `src` and `tests`, and leaves shell-write ceilings empty. Spawn still must explicitly request the tools and file roots. This enables structured source editing with source-read-only shell.

The `config.scoped-edit-with-output.json` example additionally permits an existing `build-output` directory as a shell-write ceiling. It is not granted to a run unless the main requests it. The example does not authorize full-workspace shell writes; backend-unsupported policies are explicit failures. Directories listed as roots must exist before they can be selected.

`models_path` is optional and, when absent, uses Pi's built-in/cached catalog rather than project discovery. `skill_roots` defaults empty and `project_skills` defaults false. No model or permission configuration is chosen based on task category. An optional model allowlist remains access/cost policy, not routing.

Each `allowed_models` entry requires `provider` and `id` and may include a `description`: a single line of 1–512 characters after trimming. Existing entries without descriptions remain valid. Descriptions are catalog metadata only; the MCP spawn `model` reference still accepts only `provider` and `id`. Restart the server after editing operator configuration.

Implement these operator commands:

```text
pi-spoke serve --config <absolute-path> --instance <instance-id>
pi-spoke doctor --config <absolute-path> --instance <instance-id>
pi-spoke doctor --config <absolute-path> --instance <instance-id> --sandbox-check
pi-spoke doctor --config <absolute-path> --instance <instance-id> --refresh-models
pi-spoke recover --config <absolute-path> --instance <instance-id> --run <run-id> --acknowledge-cleanup
pi-spoke gc --config <absolute-path> --instance <instance-id> --older-than 30 --dry-run
pi-spoke gc --config <absolute-path> --instance <instance-id> --older-than 30 --delete
```

Plain `doctor` performs read-oriented configuration/version/readiness inspection and no model inference. `--sandbox-check` explicitly runs bundled no-network canaries in disposable fixtures, with known local writes/deletes for testing; it never tests destructive operations on the user's repository. It neither installs dependencies nor changes system sandbox settings. `--refresh-models` is the separately explicit network/catalog operation.

`recover --acknowledge-cleanup` remains an operator assertion after inspection. Refuse it when a positively identified owned process is still live. Otherwise record `cleanup_status="operator_attested"`, not runtime-verified cleanup. It may allow explicit continuation from a valid checkpoint only after permission and sandbox revalidation. Never replay the task or signal arbitrary PIDs. Clear stale locks only with conclusive ownership evidence; recovery is not a default `doctor` side effect.

After implementation and build, register the executable in Codex:

```toml
[mcp_servers.pi_spoke]
command = "node"
args = [
  "/absolute/path/to/pi-spoke/dist/cli.js",
  "serve",
  "--config", "/absolute/path/to/pi-spoke.json",
  "--instance", "codex-project-a"
]
startup_timeout_sec = 20
tool_timeout_sec = 45
```

Codex exposes these MCP configuration fields; observation remains bounded below the MCP tool timeout. No changes to OpenCode or Oh My OpenAgent are needed. [S15]

Do not install a mandatory host skill or rewrite global `AGENTS.md`. Tool descriptions must be sufficient. A short optional instruction may describe available delegation, self-contained tasks, explicit capabilities, and retained main-agent responsibility without prescribing a workflow.

## 15. Implementation order and deliverables

The work is sequenced to prove assumptions early, not to reopen the product architecture. Details and test IDs are in [IMPLEMENTATION_TASKS.md](IMPLEMENTATION_TASKS.md).

| Milestone | Deliverable | Completion condition |
|---|---|---|
| P0 — Compatibility and sandbox slice | Repo, exact lock, real-Pi fake-provider fixture, SRT adapter and destructive-path canaries | Pinned APIs and baseline OS enforcement work; no raw tool path remains reachable |
| P1 — Durable core and permissions | Database, states, receipts, immutable policies, typed errors | Lifecycle/idempotency and authority-resolution tests pass without model calls |
| P2 — Sandboxed worker execution | Supervised children/launchers, file helpers, shell sandbox, fresh/resumed sessions, events, attachments | Real Pi uses the guarded paths; sandbox/cancellation tests verify the actual OS boundary |
| P3 — Skills and communication | Optional skill shortlist, contact tool, questions/replies, improvement events | No implicit skill execution; correlated communication and cancellation work |
| P4 — MCP and Codex | Six tools, bounded observation, local configuration, diagnostics | End-to-end stdio test and Codex manual acceptance scenarios pass |
| P5 — Release hardening | Crash/timeout/escape regression tests, documentation, explicit live smoke tests | A01–A30 and mandatory S01–S36 pass on claimed platforms; no unverified security claims |

Each milestone must produce working code/tests before its result is described as implemented. A demo that calls a model once is not completion of P2. A fake-runtime test is not evidence of a Pi SDK integration working. A Pi SDK integration test is not evidence that a live provider account has permission to use a model.

## 16. Verification and release gates

### Four test layers

**Deterministic core tests:** no model inference. Validate transactions, states, idempotency, races, cursors, roots, redaction, and limits with a fake runtime.

**Pi contract tests:** run the actual pinned Pi SDK against a local fake model endpoint/adapter that supplies controlled tool calls and responses. Verify real tool registration, session persistence, resource prompts, steering, questions, compaction/event behavior, and error handling. These tests must not contact paid providers.

**OS sandbox tests:** execute the real pinned backend on macOS/Linux against disposable canaries. Verify negative and positive filesystem/network cases, protected-path aliases, helper/shell permission separation, no fallback, and teardown. These are local tests, not paid inference and not mock-only policy snapshots. [SAFETY_TESTS.md](SAFETY_TESTS.md) contains the required S01–S36 matrix.

**Opt-in live tests:** require an explicit flag and configured credentials. Verify at least two different provider integrations selected from the runtime catalog, a real tool-using task, same-session continuation, and one vision-capable input where available. Record skipped cases as skipped, never passed. Provider names and model IDs belong in test configuration, not product routing rules.

### Mandatory acceptance tests

| ID | Scenario | Required outcome |
|---|---|---|
| A01 | Spawn without an earlier catalog call | Works with a valid explicit model; no init gate |
| A02 | No skills requested | No skill bodies or unrelated descriptions in worker context |
| A03 | Two skills suggested, worker reads neither | Run can complete; no corrective loop or forced loading |
| A04 | Global/project workflow resources installed | Unselected resources and system overrides do not enter the worker context |
| A05 | Model unavailable or requested thinking gets clamped | Clear failure; no substitute model or silent setting change |
| A06 | Same accepted spawn request repeated | Same session/run; one launch |
| A07 | Same key with different input | Idempotency conflict; no launch |
| A08 | Two continuations race on one session | Only one admitted; other receives current state/stale conflict |
| A09 | Host observes an active run repeatedly | No new turn, skill read, or model call |
| A10 | Observe wait expires | Worker remains active; timeout is explicit |
| A11 | Worker asks a question | Visible pending question; exact reply unblocks the original tool call |
| A12 | Steer sent while worker is blocked on a question | Explicit instruction to use reply; no deadlock hidden as delivery |
| A13 | Worker proposes a reusable lesson | Proposal persisted; skills, prompts, and AGENTS.md unchanged |
| A14 | Worker tool action completes but agent continues | Run remains running; not marked completed early |
| A15 | Cancel during provider call, shell, or question | Prompt/tool waits terminate; managed processes cleaned; status honest |
| A16 | One worker crashes | Siblings/server remain usable; crashed run not falsely completed |
| A17 | Supervisor dies after acceptance | Restart does not replay; original receipt remains queryable |
| A18 | Safe persisted session continued after restart | Same conversation from validated checkpoint, new run ID |
| A19 | Corrupt/unsafe partial session | No fabricated tool result or blind replay; clear recovery limitation |
| A20 | Unavailable modality or bad image input | Explicit rejection; no silent image drop |
| A21 | Tool not granted / path outside allowed file roots | The callable tool surface or guardrail rejects it; skills without a reader do not gain tools implicitly |
| A22 | Shell explicitly granted | Actual OS sandbox is established; source is read-only absent a separate grant; scope/backend/policy are reported accurately |
| A23 | Duplicate worker event or reply | No duplicate question, message, or side effect from re-delivery |
| A24 | Long output, Unicode, and event pagination | Explicit truncation and lossless valid UTF-8 pagination |
| A25 | Cleanup/GC followed by reuse of an old request key | Tombstone prevents accidental new work |
| A26 | Request or skill metadata contains literal slash commands | No automatic template/skill command expansion |
| A27 | Valid fresh spawn using a different configured provider | No task-specific role or routing code is required |
| A28 | Active-run cap reached | Explicit admission failure; no hidden queue or unbounded process creation |
| A29 | External credential text appears in errors/log inputs | Recognized secrets redacted; credentials absent from manifests |
| A30 | Main agent chooses not to delegate | No hook or mandatory workflow forces pi-spoke use |

Some autonomy claims are architectural guarantees, not deterministic claims about a model's judgment. A03 proves that the runtime permits not using a skill; it does not prove every live model always chooses well. Supplement structural tests with small observed tasks, without pretending an LLM can be exhaustively validated by snapshot tests.

### Performance and operational measurements

Measure catalog/discovery latency, admission latency, process startup, per-invocation sandbox overhead, preflight cache behavior, per-worker/launcher resident memory, idle-server memory, cancellation latency, event throughput, and output size. Record the platform, pinned versions, and fixture. Do not market an overhead percentage or token-saving figure without data.

With a warmed cached catalog and fake worker, admission must return before the worker's delayed completion. An idle server must not run inference or periodic network discovery. Three concurrent test workers must remain independently observable. Passing those conditions is more important than an arbitrary line-count target.

### Definition of release-ready

Release 0.1.0 only when deterministic/Pi contract tests and mandatory S01–S36 safety tests pass on every claimed platform, process scenarios have been exercised, Codex can use the six tools, secrets/permission limitations are documented, and live-provider results are recorded honestly. Unsupported optional shell policies must reject before execution; unsupported baseline sandboxing blocks the corresponding platform release claim.

Ship the philosophy, safety contract/test matrix, API reference, recovery/limitations documentation, exact dependency lock, safe configuration examples, and a truthful compatibility table. Code may be complete while required live checks are blocked by missing credentials. In that case ship a release candidate, not a falsely verified 0.1.0 release. The release gate requires live checks with two distinct provider integrations and one vision-capable input; record all additional skipped provider cases honestly.

## 17. Future change policy

The core invariants are durable; dependency versions and implementation details are not timeless.

Potential later capabilities include an explicitly approved tool/extension registry, additional independently validated sandbox backends, controlled tool-network grants, improved host event delivery, and a separate persistent supervisor. OS-sandboxed tools themselves are already required in v0.1, not deferred. None belongs in the initial implementation merely because it may be useful later.

Adding a new model through Pi's catalog should not require a new role, workflow tool, or task classifier. Adding a new runtime should require real demand and a separate decision, not a premature abstraction today.

The project succeeds when the host can freely delegate and coordinate, workers can act intelligently within visible boundaries, and the runtime remains trustworthy without prescribing a development methodology.

> **The main agent decides the work. The worker decides its local method. pi-spoke makes the exchange dependable.**

## Sources and verification notes

References S1–S16 and their version baselines are retained from specification 1.0 (13 September 2026); they were not all independently rechecked in this safety update. References S17–S18 and the B-series in [SAFETY_SPEC.md](SAFETY_SPEC.md) were inspected on 14 September 2026. Branch URLs can change. Record the exact installed versions and resolved source revisions during P0. Source inspection is not a substitute for running integration tests.

- **[S1]** pi-delegate-mcp repository: implementation reference only. https://github.com/howznguyen/pi-delegate-mcp
- **[S2]** Node 24 SQLite documentation, including release-candidate status. https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/sqlite.md
- **[S3]** Pi coding-agent package manifest, source version and public package. https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/package.json
- **[S4]** MCP TypeScript SDK v1 manifest and guide. https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/package.json ; https://ts.sdk.modelcontextprotocol.io/
- **[S5]** Pi SDK guide and public exports. https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/sdk.md ; https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/index.ts
- **[S6]** Pi session-manager implementation, public creation/opening and session structure. https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/session-manager.ts
- **[S7]** MCP tool specification, structured output and error handling. https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- **[S8]** Pi RPC control documentation, used to cross-check steering versus follow-up semantics; pi-spoke uses the SDK, not CLI RPC as its execution transport. https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/rpc.md
- **[S9]** Pi model runtime and model metadata types. https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/model-runtime.ts ; https://raw.githubusercontent.com/earendil-works/pi/main/packages/ai/src/types.ts
- **[S10]** Pi skill documentation and implementation. https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/skills.md ; https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/skills.ts
- **[S11]** Pi system-prompt construction and skill metadata placement. https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/system-prompt.ts
- **[S12]** Pi resource-loader implementation, explicit overrides and distinct discovery paths. https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/resource-loader.ts
- **[S13]** Pi shell tool implementation, public operation hooks and detached process behavior. https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/tools/bash.ts
- **[S14]** MCP request-cancellation semantics. https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation
- **[S15]** Official Codex MCP setup and timeout configuration. https://developers.openai.com/codex/mcp/
- **[S16]** Pi AgentSession implementation, prompt options, settlement events, and runtime tool configuration. https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/agent-session.ts

- **[S17]** SRT source manifest, public manager, backend interfaces, and limitations: https://raw.githubusercontent.com/anthropics/sandbox-runtime/main/package.json ; https://raw.githubusercontent.com/anthropics/sandbox-runtime/main/src/sandbox/sandbox-manager.ts ; https://raw.githubusercontent.com/anthropics/sandbox-runtime/main/README.md . Detailed source mapping is in [SAFETY_SPEC.md](SAFETY_SPEC.md) B1–B9.
- **[S18]** Codex Linux sandbox boundary as a design reference: https://raw.githubusercontent.com/openai/codex/main/codex-rs/linux-sandbox/README.md
