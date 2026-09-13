# pi-spoke — Implementation Work Order

**Specification 1.1 · application target 0.1.0 · 14 September 2026**

This order implements the product; it is not a workflow engine imposed on its agents. [PHILOSOPHY.md](PHILOSOPHY.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), [SAFETY_SPEC.md](SAFETY_SPEC.md), and [SAFETY_TESTS.md](SAFETY_TESTS.md) are the implementation contract. Specification 1.0's unsandboxed shell is superseded.

## P0 — Prove public integration and OS enforcement first

Create the independent TypeScript/ESM repository, original MIT license, test runner, exact dependency lock, and contributor instructions. Do not copy the upstream project wholesale. Verify package availability/public exports and record installed versions, source revisions, binary paths/identities, and supported OS/architectures in `docs/compatibility.md`.

Build a real Pi contract fixture with a local fake provider. Exercise a registered tool, session save/reopen, steering, an asynchronous `contact_main`, explicit model/thinking mismatch rejection, and resource overrides. Verify empty/two-skill shortlists and rejection of implicit global/project workflows and SYSTEM/APPEND_SYSTEM discovery. Disable command/template expansion for ordinary task text.

In parallel, implement the smallest SRT adapter spike: complete private config, one launcher per invocation, validated public argv/wrapper execution, sanitized environment/descriptors, and isolated scratch. Verify source-read-only shell and separately authorized structured edit using the real OS boundary. Read/search executables must not bypass it. Inventory implicit backend writable paths and prove no broad host `/tmp` grant.

Run representative real-OS tests S04–S08, S11–S12, S25–S29. Investigate S14 and S20 now: missing protected paths and writable hard-link/alias topologies. Reject unsupported permission shapes rather than allowing them with warnings. A missing sandbox is not permission to drop back to Pi's stock tools.

**Deliverable:** compiling skeleton and passing no-paid-inference Pi + sandbox compatibility slice. Unsupported optional policies are explicitly mapped to rejection. If the baseline cannot be enforced on a target platform, record that blocker and do not claim support.

## P1 — Implement the durable core and authority resolver

Implement configuration version 2, strict MCP/application schemas, canonical root resolution, independent file/shell write ceilings, protected-path rules, immutable session grants, and permission hashes. Unknown/unsafe flags and version-1 configurations fail explicitly. Neither tool selection nor omitted root lists grant write authority.

Implement SQLite migrations, ownership lock, run state machine, admission ceilings, request receipts/hash comparison, command-delivery states, event cursors, questions, and tool-invocation records. Do not import Pi, MCP, or SRT into `src/core`.

Use fake runtimes for races, duplicate requests, lost acknowledgments, cancellation/completion, database failure, startup recovery, changed policy, retention tombstones, and safe-checkpoint fields. Receipt idempotency must never become an automatic tool replay after an ambiguous mutation.

**Required coverage:** A06–A10, A17–A19, A23–A25, A28; S01–S03, S18, S30–S31, S33, S36.

**Deliverable:** durable service and deterministic permission tests without paid inference. Reject unauthorized requests in full; do not silently intersect permissions.

## P2 — Implement supervised, sandboxed Pi execution

Build typed parent/worker/launcher IPC, readiness/configuration handshake, model validation, normalized events, persistent Pi mapping, and bounded payloads. Authorize inference only after identity, effective policy, and sandbox readiness have been persisted.

Replace the actual public Pi tool definitions with guarded callbacks. Implement fixed file helpers for read/search/edit/write and the separate shell sandbox. The writer helper accepts operations, not arbitrary executable code; shell never receives writer authority. Apply canonical/identity/link checks, protected metadata/skills, sanitized environment, private scratch, denied tool network, and safe file commit/conflict handling from [SAFETY_SPEC.md](SAFETY_SPEC.md).

Use one SRT launcher/configuration per invocation. Check support for the exact root/protection shape, not only the presence of `bwrap`. Keep backend imports under `src/sandbox`, trusted fixed file operations under `src/helpers`, and grants under `src/security`. Do not add a general plugin framework or destructive-command parser.

Implement persistent context, explicit continuation, image inputs, tool limits, safe checkpoint validation, and cancellation/cleanup across worker, launcher, helper, shell, and descendants. Preserve sandbox restrictions through child creation. Parent death and unconfirmed cleanup must produce honest interrupted state, not invisible background work.

**Required coverage:** A05, A14–A22, A26–A29; real execution for S04–S29, S32–S34.

**Deliverable:** real Pi loop against local providers using the actual sandboxed tool paths, durable results, and demonstrated filesystem/network boundaries.

## P3 — Implement optional expertise and upward communication

Build the operator-approved skill catalog, stable IDs, duplicate-name detection, resource/hash manifests, and selected loading. Skills remain metadata-first suggestions; using none is allowed. The selected skill resources become read-accessible but protected from worker mutation. Skill scripts require an explicitly granted sandboxed execution tool.

Implement `contact_main` notes, correlated questions, and improvement proposals. Persist before acknowledgment; add exact question replies, cancellation, and same-key deduplication. A reply is text, not a permission grant. Skill-shortlist changes occur only on explicit continuation and never widen write permissions.

Test that the worker cannot mutate its loaded skill, config, or project instructions to install an improvement. The main agent can deliberate on the proposal and act within its own separate authorization; no bridge-owned learning loop is added.

**Required coverage:** A02–A04, A11–A13, A23, A26, A30; S17, S23, S30–S31.

**Deliverable:** low-noise optional expertise and main-mediated communication without roles, peer mailboxes, automatic promotion, or policy escalation.

## P4 — Expose the six MCP tools and validate Codex use

Register the unchanged six host tools with revised schemas, truthful annotations, bounded observation, pagination, and stderr-only logs. Expose actual tool availability, operator ceilings relevant to cwd, protected exclusions, sandbox readiness, effective policy, and cleanup state. Keep application logic outside transport handlers.

Implement `serve`, read-oriented `doctor`, explicit `doctor --sandbox-check`, explicit catalog refresh, operator-attested recovery, and dry-run/explicit GC. `--sandbox-check` uses disposable bundled canaries; no user-repo deletion tests, automatic package installation, `sudo`, host security-setting changes, or paid inference. Backend failure leaves diagnostics/observation available but cannot authorize executable tools.

Ship the three version-2 configs and Codex TOML. Primary example is enforced read-only. The scoped-edit example keeps shell source-read-only; the output example adds only an explicitly selectable existing build directory. No unsandboxed example, auto-installed host skill, Desktop injection, or OpenCode/Oh My OpenAgent change.

Run an MCP SDK client against the compiled subprocess. Manually exercise Codex discovery, explicit model/permission selection, spawn, independent host work, observe, question/reply, steering, continuation, and cancellation. Also verify the host is free not to delegate.

**Required coverage:** A01, A09–A12, A24, A27, A30; MCP-level S01–S04, S27, S30–S31, S34, S36.

**Deliverable:** usable Codex integration with no init ritual and no implied permission escalation through MCP approvals.

## P5 — Run release security, lifecycle, and live checks

Run all A01–A30 and S01–S36 cases on every claimed platform. Include source deletion/overwrite through multiple interpreters, protected metadata and missing paths, symlink/hard-link escapes, network/socket denial, unrelated `/tmp` writes, poisoned executable lookup, mutable-backend configuration leaks, lost IPC, double-fork teardown, disk-full conditions, and ambiguous file outcomes.

Run opt-in live tests with two configured provider integrations and one vision-capable input. Use disposable projects. The provider client may connect; tool subprocesses still must not inherit provider egress or secrets. No live-provider test runs in the default suite.

Measure startup, per-tool sandbox cost, memory, cached/uncached preflight, concurrency, cancellation, and output handling. Report actual measurements; do not claim lightweight performance from line counts or dependency count alone. Test upgrade invalidation S35.

Document supported/rejected policy shapes, control-plane trust, allowed-write data-loss risk, provider-context disclosure, no rollback, and resource-limit gaps. A backend limitation produces a tested error, never a quiet weakening of the contract.

**Deliverable:** release 0.1.0 only when all mandatory gates pass. Missing credentials, an untested OS, or failed sandbox enforcement results in a clearly labelled candidate/blocker, not fabricated passing results.

## Required scripts

```text
npm run build              compile executables and fixed helpers
npm run typecheck          strict type validation
npm test                   deterministic unit tests; no paid inference
npm run test:contract      actual Pi SDK with local fake providers
npm run test:integration   subprocess / SQLite / MCP integration
npm run test:sandbox       real OS boundary tests on disposable fixtures
npm run test:live          explicit enable flag and credentials required
npm run verify             typecheck + unit + contract + integration + sandbox + build
```

`verify` never calls `test:live`. Run real sandbox tests only where prerequisites are installed; a blocked suite fails verification rather than being skipped as passed. Build/pretest dependencies must prepare executables before subprocess suites. Non-live CI denies accidental paid-provider traffic. Keep public model names in test configuration, never task-routing code.

## Completion criterion

The lockfile build works; six tools satisfy their lifecycle contracts; main-agent judgment and optional skills remain free; and the actual OS boundary prevents out-of-scope tool operations without silently weakening permissions. Documentation describes only observed guarantees. Read/write authority, model intelligence, optional expertise, and workflow decisions remain separate.
