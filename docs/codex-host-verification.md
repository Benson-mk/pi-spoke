# Codex host verification

Setup is ready; actual host execution remains NOT RUN. The operator requested
this verification. Apple Events S26 has separately passed.

`pi_spoke` is registered in the operator's `~/.codex/config.toml` using the
qualified Node 24 binary and compiled repository entry point. Existing host
configuration was backed up to `~/.codex/config.toml.before-pi-spoke-host-verification`.
Setup follows the [official MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

This is a temporary verification instance:

- Instance: `codex-host-verification`.
- Operator configuration: `/private/tmp/ps-host-i53_cygw/config.json`.
- Workspace: `/private/tmp/ps-host-i53_cygw/project`.
- Explicit model: provider `operator-gateway`, ID `iFiy/spark-x2.5-4b`.
- Granted tool: `read`; file-write and shell-write roots empty; no selected skills;
  project context `none`. `contact_main` is the built-in communication tool.
- Credentials are in a private mode-0600 file outside the repository, retained
  for this verification. Do not print or commit their contents.
- Baseline actual sandbox and direct MCP six-tool discovery passed. Neither
  establishes that Codex itself can call the tools.

Restart Codex, reopen this task, and say: **Run the prepared Codex host verification.**
The current turn does not have the newly registered tool handles. If a restart
does not expose them, inspect MCP connection status rather than substituting a
shell-launched MCP client as proof of host integration.

## Checklist to execute through Codex's registered pi_spoke tools

1. Discover `spoke_catalog`, `spoke_spawn`, `spoke_observe`, `spoke_send`,
   `spoke_cancel`, and `spoke_sessions`. Query model/tool/skill catalogs and sessions.
   Check that the explicit model and read-only authority are visible.
2. Spawn with a fresh request key and the model/workspace/grants above. Task:
   “First use contact_main with kind question to ask which file to read. Wait
   for the answer. Then use read on that file and report its exact contents.”
   Retain the receipt and run/session IDs; do not replay under a new key.
3. Before waiting for completion, do independent main-agent work: calculate
   17 × 23 locally and report 391. This also demonstrates a main-agent task
   handled without delegation.
4. Observe until the question appears. Record its question ID. Observe again
   and verify observation did not answer or dismiss it.
5. Send a `steer` command to the active run: “Prefix your final answer with
   HOST-VERIFIED.” Then send a `reply` for the exact question ID: “Read canary.txt.”
   Use distinct retained request keys. Observe the completed run, inspect
   effective configuration, command delivery, output and confirmed cleanup.
6. Continue that same session with `expected_last_run_id` and a fresh key:
   “Repeat the file contents from the previous turn without reading again.”
   Verify native continuation and confirmed cleanup, then query sessions again.
7. Spawn a separate run with tools empty and the same explicit model/workspace:
   “Ask main a question with contact_main and wait for its reply.” Observe the
   pending question, cancel the run, and verify terminal cancellation and actual
   cleanup status. Never label unconfirmed cleanup as successful.
8. Record host tool call results, IDs, output assertions and any blocked or
   failed step in `docs/evidence/codex-host-verification.json`. Update the ledger
   only after all required checks are evidenced. No push or release is authorized.

Do not fabricate question/steering behavior if the live model does not follow
its task. Record what happened and diagnose the exact failed step.

After verification, remove the temporary server with `codex mcp remove pi_spoke`
if it is no longer wanted. Stop/reload the host connection before removing its
private fixture directory, and inspect uncertain runs before cleanup. Temporary
Node and fixture paths may disappear after system cleanup; this setup is not a
permanent installation.
