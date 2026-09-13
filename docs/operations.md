# Running the implementation candidate

This is an unreleased 0.1.0 candidate. Read [implementation status](implementation-status.md)
and [compatibility](compatibility.md) before enabling tools. No platform release
claim or successful descendant-cleanup claim is made.

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
This repository does not install host configuration or a mandatory host skill.
The main agent can choose not to delegate. If it delegates, choose a model
explicitly, use self-contained tasks, retain request keys across retries, observe
without adding turns, and answer the exact pending question ID. Observation
never acknowledges questions. MCP approvals do not enlarge session permissions.

Manual host gate (NOT RUN): discover all six tools in Codex, choose model and
permissions explicitly, spawn while doing independent host work, observe,
question/reply, steer, continue and cancel. Verify a task can remain entirely
with the main agent. No package publication or release is authorized.
