# pi-spoke 0.1.0 — independent Pi workers with enforceable tool authority

Synthesized on 14 September 2026 from specification 1.1 and ADRs 0001–0008. Test boundaries and GitHub tracker setup confirmed. This specifies the full initial release; it does not claim implementation or passing tests.

## Problem Statement

A main agent needs to delegate work to independent agents while retaining control of objectives, model choice, coordination, verification, and integration. Starting another agent is insufficient if its lifecycle, conversation, tool authority, communication, and recovery behavior are ambiguous. Operators also need delegated tools to respect explicit filesystem and network boundaries even when model-generated commands or repository scripts attempt something outside their grants.

The current repository contains product, implementation, safety, and acceptance plans plus a glossary and ADRs. There is no executable implementation or existing automated test suite. The task is to build the planned local runtime without introducing another planner or requiring a particular development workflow.

## Solution

Provide a local MCP service that lets a main agent discover capabilities, start independent Pi workers, observe progress, steer ongoing work, answer questions, continue saved conversations, and cancel runs. Each worker uses an explicitly selected model and visible, fixed capabilities. Skills are optional metadata-first suggestions. The operator sets ceilings; the main agent chooses narrower grants; OS enforcement contains tool subprocesses.

Make acceptance, delivery, completion, and uncertainty observable through durable receipts and events. Recover saved conversation context only through explicit continuation from safe checkpoints. Codex is the first release-tested host, with a protocol suitable for other compatible local MCP hosts.

## User Stories

1. As a main agent, I want to discover models without starting inference, so that I can choose intelligence deliberately.
2. As a main agent, I want model metadata to distinguish configured credentials from verified access, so that I do not mistake discovery for provider availability.
3. As a main agent, I want to select the exact provider and model, so that the runtime cannot silently substitute my choice.
4. As a main agent, I want unsupported thinking settings and image modalities rejected, so that accepted work matches my request.
5. As a main agent, I want to spawn directly with known valid identifiers, so that discovery is optional.
6. As a main agent, I want each spawn to create a fresh conversation, so that assignments do not inherit unrelated host history.
7. As a main agent, I want admission to return before completion, so that I can continue independent work.
8. As a main agent, I want multiple independent runs, so that unrelated assignments can progress concurrently.
9. As an operator, I want capacity excess rejected explicitly, so that hidden queues do not accumulate work.
10. As a main agent, I want session identity distinct from run identity, so that I can track a conversation across executions.
11. As a main agent, I want to continue a saved session explicitly, so that prior context remains useful without restarting old commands.
12. As a main agent, I want stale or concurrent continuations rejected, so that one conversation cannot receive competing active runs.
13. As an operator, I want session capabilities fixed and revalidated on continuation, so that saved context cannot retain revoked authority or acquire new grants silently.
14. As a main agent, I want read/search tools by default, so that starting a worker does not authorize project mutation.
15. As an operator, I want independent tool and write ceilings, so that exposing an operation does not grant unrestricted machine access.
16. As a main agent, I want scoped structured edits while shell access remains source-read-only, so that useful edits do not require writable arbitrary code execution.
17. As a main agent, I want to grant shell writes to an existing output directory explicitly, so that builds can produce artifacts within a visible boundary.
18. As an operator, I want invalid grants rejected in full, so that the runtime does not silently change the requested policy.
19. As an operator, I want missing or insufficient sandbox enforcement to block execution, so that backend failure cannot become unrestricted execution.
20. As an operator, I want state, credentials, instructions, skills, metadata, and installed runtime files protected, so that a worker cannot rewrite its own authority.
21. As an operator, I want tool networking denied independently of the provider connection, so that executable tools cannot inherit inference credentials or egress.
22. As a worker, I want private writable scratch when shell is granted, so that temporary work does not require project-write authority.
23. As a main agent, I want to discover skill metadata from approved roots, so that I can select relevant expertise without injecting every skill body.
24. As a worker, I want to ignore irrelevant suggested skills, so that I can choose my local method.
25. As an operator, I want skill text unable to grant tools or expand roots, so that expertise remains separate from authority.
26. As a main agent, I want to replace a skill shortlist between runs, so that I can supply additional expertise deliberately.
27. As a main agent, I want scoped project instructions and explicit context files, so that worker context is attributable and bounded.
28. As an operator, I want ambient extensions and system overrides excluded, so that unrelated harness configuration cannot alter workers.
29. As a main agent, I want resource changes detected before continuation, so that saved sessions do not silently load changed instructions.
30. As a main agent, I want local image attachments validated and copied at admission, so that later file changes cannot alter accepted input.
31. As a worker, I want to send a nonblocking note, so that useful findings can reach the main agent while I continue.
32. As a worker, I want to ask a correlated question and await its answer, so that missing information can be resolved within the same run.
33. As a main agent, I want pending questions visible in summary observation, so that workers do not remain blocked invisibly.
34. As a main agent, I want replies distinct from steering, so that an answer resolves the correct waiting tool call.
35. As a main agent, I want steering delivery reported honestly, so that queued text is not mistaken for worker compliance.
36. As a worker, I want to propose reusable improvements, so that the main agent can evaluate them without automatic persistent changes.
37. As a main agent, I want non-destructive event observation and output pagination, so that repeated reads lose no information and start no work.
38. As a main agent, I want observation timeouts independent of run cancellation, so that a short host wait does not terminate an assignment.
39. As a main agent, I want accepted requests deduplicated by request key, so that retrying delivery does not create duplicate work.
40. As a main agent, I want conflicting request-key reuse rejected, so that different commands cannot share an ambiguous receipt.
41. As an operator, I want uncertainty preserved after a crash, so that tools with unknown side effects are not replayed automatically.
42. As a main agent, I want completion to require settled output and a durable checkpoint, so that early tool events are not mistaken for a finished run.
43. As a main agent, I want to cancel one run without deleting its session or stopping siblings, so that I retain useful history and independent progress.
44. As an operator, I want descendant cleanup verified or reported unconfirmed, so that cancellation cannot conceal surviving processes.
45. As an operator, I want host shutdown and lost supervision to stop managed work, so that workers do not silently become unattended jobs.
46. As a main agent, I want explicit failure when no safe checkpoint exists, so that recovery does not fabricate missing tool results.
47. As an operator, I want one active server per instance and isolated instance state, so that separate hosts cannot corrupt each other's conversations.
48. As a main agent, I want truthful usage, errors, and effective policy evidence, so that I can assess results without hidden inference or fabricated costs.
49. As an operator, I want redacted diagnostics and private persistent state, so that credentials are not exposed in ordinary status surfaces.
50. As an operator, I want explicit dry-run and deletion controls for retention, so that cleanup preserves active work and duplicate-request protection.
51. As an operator, I want read-oriented diagnostics and explicit disposable sandbox checks, so that readiness checks do not modify my project or install dependencies automatically.
52. As a maintainer, I want exact dependency and platform evidence, so that support claims reflect tested behavior.
53. As a maintainer, I want real Pi and sandbox tests separate from opt-in live provider checks, so that routine verification is reproducible without paid inference.
54. As a main agent, I want delegation to remain optional, so that I can choose native host work when appropriate.

## Implementation Decisions

- **Ownership and scope:** Preserve ADR 0001: operator ceilings, main-agent orchestration, worker method, and deterministic runtime guarantees remain separate. Use Pi's catalog and authentication integration; require explicit model identity and disable bridge-level task retries and fallback.
- **Transport and supervision:** Preserve ADR 0002: local stdio MCP, one parent supervisor and a disposable Node child embedding the public Pi SDK per active run. Enforce an exclusive instance lock. Keep child output separate from protocol stdout; schema-validate versioned IPC, including identities and bounded payloads.
- **Host interface:** Expose exactly `spoke_catalog`, `spoke_spawn`, `spoke_observe`, `spoke_send`, `spoke_cancel`, and `spoke_sessions`, with protocol version 1, strict schemas, structured results, concise text, and typed errors. Discovery, observation, and session listing start no inference. Spawn requires a request key, self-contained task, working directory, and provider/model reference.
- **Conversation model:** Preserve ADR 0003: fresh session on spawn, new run on explicit continuation, and one nonterminal run per session. Continuation requires the expected latest run identity. Model, tools, file/shell write roots, working directory, and project-context policy remain fixed. Omitted skill suggestions retain the shortlist; an explicit array replaces it between runs.
- **Storage:** Preserve ADR 0004: parent-owned SQLite metadata, receipts, events, questions, and tool-invocation records alongside Pi-native conversation files. Use transactions, foreign keys, WAL, full synchronization, durable artifact ordering, versioned migrations, and a unique active-run constraint. Keep the built-in SQLite dependency behind the storage boundary.
- **Request delivery and recovery:** Preserve ADR 0005: commit acceptance before dispatch; deduplicate equal requests and reject conflicts. Preserve accepted failures and uncertain deliveries. Retain tombstones after payload pruning. Never replay an uncertain run automatically or claim exactly-once tool execution or billing.
- **Lifecycle:** Distinguish starting, running, waiting for input, stopping, completed, failed, cancelled, and interrupted states. Completion requires settled prompting and durable output/checkpoint. Cancellation requests Pi abort and escalates cleanup across managed processes; unconfirmed cleanup yields interruption. Restart reconciles prior nonterminal work and blocks unsafe continuation.
- **Authority and containment:** Preserve ADR 0006: mandatory per-invocation OS sandboxing for file/executable tools with no fallback, independent structured-write and shell-write roots, protected-path exclusions, canonical identity checks, sanitized environments/descriptors, and private scratch. Reject unsupported policy shapes before execution. The trusted supervisor/Pi provider client remains outside the tool sandbox; tool network is denied.
- **Tool integration:** Replace stock Pi execution callbacks with guarded public tool definitions. Fixed file helpers accept typed operations; shell never receives writer-helper authority. Prevent alternate callbacks, poisoned executable lookup, aliases, or mutable shared sandbox configuration from bypassing grants. Persist requested policy, resolved policy, and actual enforcement evidence separately before authorizing inference.
- **Resources:** Preserve ADR 0007: approved roots, stable skill identities, selected metadata-first loading, collision detection, resource hashes, and explicit reader requirements. Disable ambient Pi resources and command expansion. Load project instructions only within the approved project boundary; retain explicit context files independently of automatic instruction loading.
- **Communication:** Preserve ADR 0008: one worker-side `contact_main` capability for notes, questions, and improvement proposals. Persist before acknowledgement; commit a correlated reply before unblocking a question. Attach worker identity in the runtime. Observation is the guaranteed host delivery path; improvement proposals cause no automatic edits.
- **Limits and output:** Default to three active runs, 30-minute wall time including question waits, and 64 turns, subject to operator ceilings. Bound observation waits to 25 seconds and previews to 16 KiB with valid UTF-8 pagination. Keep startup, shell, helper, observation, and run deadlines distinct. Record missing usage/cost metadata as unknown.
- **Images:** Accept local PNG, JPEG, and WebP only, checking path, signature, size, and model support before admission. Default to at most four images of 10 MiB each; preserve accepted bytes privately.
- **Operations:** Provide serving, diagnostics, explicit model refresh and sandbox checking, operator-attested recovery, and dry-run/explicit garbage collection. Configuration version 2 rejects permissive version-1 inputs and unknown unsafe options. Ship enforced read-only, scoped-edit, and narrowly scoped output examples. Retain sensitive transcripts privately and redact recognized secrets from public diagnostics.
- **Technology:** Use strict TypeScript, ESM, npm, and the specified Node 24 baseline. Pin Pi, MCP, SRT, validation, and test dependencies after registry/public-API checks; record compatibility and exact system binary identities. Keep transport, durable service, storage, supervision, Pi/resource integration, authority resolution, sandbox adapter, and fixed helpers as explicit modules. Build a new MIT-licensed implementation with preserved notices for any reused material.

## Testing Decisions

- **Confirmed primary boundary:** Exercise the six public tools through an MCP SDK client connected to the compiled stdio server. Assert externally visible receipts, state, events, output, policy, and filesystem effects. Prefer this shared entry point for end-to-end scenarios instead of test-only APIs across every module.
- **Deterministic lifecycle coverage:** Exercise the durable service with controlled runtime behavior, real temporary storage where durability matters, and fault injection at dispatch/persistence boundaries. Cover admission, idempotency, conflicting commands, continuation races, state transitions, questions, observation, migration rejection, retention, and cleanup uncertainty. Assert outcomes rather than private method order.
- **Real Pi contract boundary:** Use the actual pinned SDK with a local fake provider to verify model identity, tool registration, save/reopen, steering, question replies, resource isolation, compaction, and settlement. Inspect observable prompts/tool calls to prove unselected resources stay absent. A fake runtime alone cannot establish Pi compatibility.
- **Actual OS boundary:** Run guarded helpers and shell through the pinned backend against disposable canaries. For each denial, include a nearby allowed operation. Cover source mutation, protected and missing paths, aliases, hard links, concurrent policies, environment and descriptor leakage, network/socket access, poisoned executables, parent loss, and descendant teardown. Policy snapshots alone cannot establish containment.
- **Modules under test:** The public transport and service, durable store, supervisor/Pi adapter, resource selection, authority resolver, sandbox launcher, and fixed file helpers are covered through these boundaries. Add focused lower-level tests only where deterministic fault injection or path edge cases cannot be observed adequately at the higher boundary.
- **Acceptance mapping:** Carry forward every A01–A30 product scenario and S01–S36 safety scenario as individually traceable acceptance cases. The existing matrices are test specifications, not executable prior art; no current test suite can be reused. Include Unicode pagination, literal command text, permission revocation, uncertain acknowledgements, and sandbox-cache invalidation.
- **Host and live checks:** Manually verify Codex discovery, direct spawn, independent host work, observe, question/reply, steering, continuation, and cancellation. Live tests require explicit enablement and credentials, with two distinct provider integrations and one vision-capable input required for release. Routine verification never contacts paid providers.
- **Platform evidence:** Run mandatory OS cases on each claimed platform and record OS/architecture, locked dependencies, binary identities, policy hash, canary changes, and cleanup evidence. An unsupported optional policy may pass by rejecting before execution; baseline source-read-only shell with separate scoped editing must actually work.
- **Quality of evidence:** Do not assert deterministic model judgment, task correctness from completion, or containment from successful configuration. Report pass, fail, blocked, and not run distinctly. Blocked sandbox tests fail verification rather than being counted as skipped passes. Record performance measurements with fixtures rather than inventing overhead claims.

## Out of Scope

Fixed roles, model rankings, task classifiers, a bridge planner, mandatory planning/review/TDD workflows, automatic skill routing or persistent learning, peer messaging, nested worker spawning, consensus loops, worktree management or automatic merging, and generic multi-runtime abstractions are excluded.

Remote serving, a persistent daemon, shared live workers between host windows, multi-tenant authorization, a dashboard, a marketplace, arbitrary extensions, browser/computer use, image generation, tool-network grants, per-command approval UI, and unsandboxed overrides are excluded from the initial release. Windows/WSL-specific support is not claimed tested. Registry publication is not required for first local use.

The product does not promise rollback, no data loss within authorized write roots, filesystem snapshot isolation, total shell read confinement, perfect secret detection, hard resource/dollar budgets, exactly-once external side effects, or protection against compromised trusted dependencies, the kernel, or hostile same-user processes.

## Further Notes

This spec synthesizes the existing implementation plan, governing philosophy, safety specification and acceptance matrix, implementation work order, domain glossary, and ADRs 0001–0008. The detailed normative contracts remain authoritative; this synthesis does not relax their limits or safety requirements. Specification 1.1 supersedes the earlier trusted-local-shell design for the same unreleased application 0.1.0.

Implement in the existing P0–P5 sequence: prove public Pi integration and OS enforcement, build durable state and authority resolution, implement sandboxed execution, add resources and communication, expose and validate the MCP/host interface, then complete release hardening. This is a multi-session build; a published spec is input to ticket decomposition, not permission to claim those milestones done.

Upstream versions are source-inspected targets until bootstrap verifies installation and behavior. No prototype or newly verified upstream claim is introduced here. Release 0.1.0 requires all mandatory deterministic, Pi, sandbox, host, and live gates; incomplete live verification yields a candidate, not a verified release.

Publish to GitHub Issues in Benson-mk/pi-spoke with the `ready-for-agent` label. The imported plan also references a changelog absent from the current package; no missing migration history has been invented.
