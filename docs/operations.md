# Running the implementation candidate

This is an unpublished 0.1.0 source build with release gates passed on the
exact qualified macOS host. Read [implementation status](implementation-status.md)
and [compatibility](compatibility.md) before enabling tools. Qualification does not extend to different platform/toolchain identities or
unconfirmed arbitrary shell descendant cleanup.

Use Node 24.15.0 and the exact lockfile. Run `npm ci --ignore-scripts` and
`npm run build`. The server entry point is `dist/cli.js`. Pi authentication and
optional models configuration belong to the operator; MCP callers cannot supply
credential paths or executable configuration. Provider calls occur only when a
worker is started, steered or explicitly continued; normal catalog discovery
does not validate provider entitlement or make a paid inference call.

Copy and edit one example outside the workspace. Replace every absolute path.
Workspace and granted write directories must already exist. Keep installation,
state, credentials and scratch outside workspaces. Use a short scratch path:
macOS Unix socket path limits apply to the sandbox backend. An instance ID owns
one state lock; use separate IDs for separate hosts. Start with
[read-only.json](../examples/read-only.json). [scoped-edit.json](../examples/scoped-edit.json)
adds a file-write ceiling while shell source stays read-only. Each spawn must
still select narrower write roots explicitly.

[isolated-output.json](../examples/isolated-output.json) shows an existing build
directory as an independent ceiling. Fixed file helpers can select that directory.
**Selecting its project shell-write grant currently fails with
`SANDBOX_POLICY_UNSUPPORTED`**; this optional policy is not qualified. Selecting
`bash` with no project shell-write grant uses private scratch. Every shell run
currently ends interrupted with unconfirmed descendant cleanup, even when its
output is available. No unrestricted fallback exists.

```sh
node /absolute/pi-spoke/dist/cli.js serve --config /absolute/pi-spoke.json --instance project-a
node /absolute/pi-spoke/dist/cli.js doctor --config /absolute/pi-spoke.json --instance project-a
node /absolute/pi-spoke/dist/cli.js doctor --config /absolute/pi-spoke.json --instance project-a --sandbox-check
node /absolute/pi-spoke/dist/cli.js doctor --config /absolute/pi-spoke.json --instance project-a --refresh-models
node /absolute/pi-spoke/dist/cli.js recover --config /absolute/pi-spoke.json --instance project-a --run run_ID --acknowledge-cleanup
node /absolute/pi-spoke/dist/cli.js gc --config /absolute/pi-spoke.json --instance project-a --older-than 30 --dry-run
node /absolute/pi-spoke/dist/cli.js gc --config /absolute/pi-spoke.json --instance project-a --older-than 30 --delete
```

Plain doctor reads configuration and host readiness without creating state,
clearing locks, changing security settings or running inference. The explicit
sandbox check uses disposable bundled canaries. Model refresh explicitly enables
catalog network access; it does not verify paid access. Recovery requires the
server to be stopped and independent operator inspection of uncertain work and
descendants. A live recorded PID prevents attestation. PID reuse conservatively
blocks attestation; this candidate never signals a PID to solve that ambiguity.
Recovery records `operator_attested`, never `confirmed`, and never replays work.
Continuation still revalidates the checkpoint, resources and authority.

GC requires the server to be stopped. Dry run lists eligible terminal runs.
Delete removes their event/output/input payloads, preserving request-key
tombstones and native session checkpoints. It retains uncertain-cleanup runs and
scratch; inspect scratch separately while the instance is stopped. Retained
native context can still contain provider-visible text or images.

For Codex, adapt [codex.toml](../examples/codex.toml) in your host configuration.
The command/args and timeout fields follow the [official MCP configuration
documentation](https://developers.openai.com/codex/mcp), fetched 2026-09-14.
The optional [setup wizard](setup.md) can register the server with Codex after
verification and confirmation. Manual setup remains available; a host skill is optional.
The main agent can choose not to delegate. If it delegates, choose a model
explicitly, use self-contained tasks, retain request keys across retries, observe
without adding turns, and answer the exact pending question ID. Observation
never acknowledges questions. MCP approvals do not enlarge session permissions.

Keep the MCP connection and returned `instance_id` alongside each `session_id`
and `run_id`. The instance identity is an opaque, persistent identifier for its
private state store; two connections can use the same configured `--instance`
label under different state roots and still own different handles. Catalog,
receipts, sessions, and observations show the identity. An unknown handle is
looked up only in the current connection; check the recorded owning connection
before assuming work disappeared. Reopening that instance preserves saved
sessions.

Manual host gate (PASS, recorded 2026-09-14): discover all six tools in Codex, choose model and
permissions explicitly, spawn while doing independent host work, observe,
question/reply, steer, continue and cancel. Verify a task can remain entirely
with the main agent. Follow the [prepared host checklist](codex-host-verification.md).
No package publication or release is authorized.

## Remaining explicit release checks

`npm run release:check` reads the complete A01–A30/S01–S36 ledger and exits
nonzero while required gates remain. `npm run verify` intentionally excludes
live inference and host-consent flows. The separately recorded disposable-volume
check is `node scripts/volume-canary.mjs docs/evidence/volume-macos.json`; it
creates one 16 MiB image, confirms its mount identity, tests real disk exhaustion,
and detaches/removes it. It never formats an existing device.

The noninteractive Apple Events fixture is
`node scripts/apple-events-canary.mjs docs/evidence/apple-events-macos.json`.
It compiled and ran a finite non-UI receiver, but macOS returned `-1744`
(`errAEEventWouldRequireUserConsent`) for its positive control. This is a blocked
check, not successful containment. An operator who explicitly chooses to perform
the host interaction can run:

```sh
PI_SPOKE_APPLE_EVENTS_ALLOW_PROMPT=1 node scripts/apple-events-canary.mjs docs/evidence/apple-events-macos.json
```

That opt-in permits a consent prompt targeting only the newly created test
receiver. It then tests sandbox denial, rechecks the positive control, waits for
the finite receiver to exit, and removes the fixture. The default path never
requests consent or alters privacy settings. The operator subsequently ran this interactive variant successfully: positive
code `0`, sandbox code `-600`, with cleanup checked before output.
[Recorded result](evidence/apple-events-macos-interactive.json).

For live verification, keep credentials in an operator-owned Pi auth file and
model definitions in the usual models file. Create a separate selection JSON:

```json
{
  "models": [
    { "provider": "first-configured-provider", "id": "explicit-model-id" },
    { "provider": "second-configured-provider", "id": "explicit-model-id" }
  ],
  "vision": { "provider": "configured-provider", "id": "explicit-vision-model-id" }
}
```

Then explicitly enable the three live calls:

```sh
PI_SPOKE_LIVE=1 \
PI_SPOKE_LIVE_CONFIG=/absolute/operator-config.json \
PI_SPOKE_LIVE_SELECTION=/absolute/live-selection.json \
npm run test:live
```

The runner uses disposable state/workspace, an actual OS-sandboxed `read` tool,
a random file-content check, native same-session continuation, and one PNG
attachment. The read and continuation checks run for each selected model.
Selections sharing one provider configuration can be tested, but cannot pass
the two-integration gate. Two aliases alone do not prove distinct integrations. It never prints provider response
content or credentials, never retries uncertain work, and does not run from
`verify`. Model quota/entitlement and any provider-side billing remain external.
The supplied gateway was tested explicitly on 2026-09-14: Gemini passed
read/continuation/image input; Llama failed tool calling because its upstream
requires `--enable-auto-tool-choice` and a compatible `--tool-call-parser`.
See [live evidence](evidence/live-gateway-macos.json). The disabled gate remains
checked separately; live inference is never enabled by default.

The subsequently selected `iFiy/spark-x2.5-4b` passed sandboxed read and
same-session continuation through MCP, with confirmed cleanup.
[Spark evidence](evidence/live-spark-macos.json). It provides a working alternative
to the Llama tool configuration; the shared gateway still does not establish
two distinct provider integrations. No additional vision request was made.

Model catalog authentication metadata is true when stored credential metadata
or a populated Pi snapshot establishes configuration; otherwise it is null
(unknown). This never verifies entitlement and does not execute credential
commands or refresh provider tokens.

To explain what an allowed model is useful for, add an optional `description`
to its entry in the pi-spoke configuration file's `allowed_models` array:

```json
{
  "provider": "your-provider",
  "id": "your-model-id",
  "description": "For short text tasks and focused repository-file inspection."
}
```

Use a single line of 1–512 characters. Keep the exact provider and model ID,
and retain the other allowed entries. Restart the MCP server after editing.
`spoke_catalog` returns the description with `description_provenance` set to
`"operator configuration"`; both fields are null when no description is supplied.
Catalog queries also match description text. This is operator guidance for the
main agent, not a benchmark result or an automatic model-selection rule.
Descriptions belong in the pi-spoke configuration, not Pi's `models.json` or
the `spoke_spawn` model reference.

All required release gates now pass for the pinned macOS host. The explicitly
authorized OpenRouter retry passed read and continuation; earlier failures are
retained as history. Plain doctor reports release_ready as null because it
does not execute the release audit; use `npm run release:check` for that ledger.


## Linux setup

Linux tool execution supports the exact OrbStack arm64 identity in
[compatibility](compatibility.md#linux-execution-support). Install Node 24.15.0,
`bubblewrap`, `socat`, `ripgrep`, and `build-essential` in the VM, then run
`npm ci --ignore-scripts` and `npm run build`. The build compiles the mandatory
native seccomp filter using `/usr/bin/cc`; build or qualification failure must
not be bypassed. Use the existing configuration examples with Linux absolute
paths and separate private state/scratch directories. No host filesystem sharing
is required. Start the same `node dist/cli.js` MCP entry point.

The current test fixtures require a writable `/private/tmp` directory on Linux.
`npm run verify` uses fake providers; it does not need live credentials.
`scripts/linux-volume-canary.mjs` requires root in a disposable VM and mounts
only its newly created 16 MiB tmpfs fixture. Do not run destructive canaries
against existing mounts. Live checks remain explicitly opt-in.

`npm run release:check` audits the current platform’s recorded qualification.
From another OS, use `npm run release:check -- --platform linux` (or `darwin`).
This checks the evidence ledger, not the current machine’s binary identities.
The pinned Linux ledger now passes; future incomplete gates produce a nonzero
exit. Keep scratch paths short enough for SRT’s Unix socket names after the
instance/run suffixes are appended. For the completed actual Codex exercise, see [Linux host verification](linux-host-verification.md).
