# Linux Codex host verification

Status: prepared on 2026-09-14; actual host exercise NOT RUN.
The `pi_spoke_linux` server is registered in the operator's Codex configuration.
This uses the documented [Codex stdio MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
The existing macOS `pi_spoke` registration is unchanged.

The transport runs the server and workers inside the isolated
`pi-spoke-linux-test` OrbStack VM. Codex itself runs on macOS. This can verify
Codex-to-Linux-server integration; it does not qualify a native Linux Codex
installation. No host filesystem sharing is needed.

- Host launcher: `/private/tmp/ps-linux-host-launch.py`, run by
  `/Library/Frameworks/Python.framework/Versions/3.12/bin/python3`.
- VM Node: `/home/benson/runtime/node-v24.15.0-linux-arm64/bin/node`.
- VM server: `/home/benson/pi-spoke/dist/cli.js`.
- VM config: `/private/tmp/ps-linux-host-verification/config.json`.
- VM workspace: `/private/tmp/ps-linux-host-verification/project`.
- Instance: `codex-linux-host-verification`.
- Model: provider `operator-gateway`, ID `iFiy/spark-x2.5-4b`.
- Tools: `read`; no file/shell write roots, skills or project context.
- Canary: `canary.txt` contains `LINUX-HOST-CANARY-20260914` and a newline.

The launcher copies only the existing private gateway verification credentials
into the VM when a connection starts. It removes the VM auth/model files when
the server exits, while retaining private session state for inspection. A
connection lock rejects concurrent starts. The prepared transport was connected,
all six tools were discovered, and disconnection removed the credentials and
lock. [Transport evidence](evidence/linux-support/host-transport.json).
This is transport preflight, not actual Codex tool-call evidence.

Reload Codex's MCP tools (restart the app if needed), reopen this task, and say:
**Run the prepared Linux Codex host verification.** Use registered
`pi_spoke_linux` tools and the workspace/model above to execute the full
[host checklist](codex-host-verification.md#checklist-to-execute-through-codexs-registered-pi_spoke-tools):
catalog/sessions, sandboxed read, correlated question/reply, native continuation,
steering, cancellation and cleanup. Record results in
`docs/evidence/linux-support/codex-host.json`; only mark the Linux host gate
passed after observing the required behaviors.

No new authorization is needed for the already-authorized temporary credential
transfer and disposable live checks. Do not replay uncertain runs. If the VM or
launcher is killed before its exit cleanup runs, inspect processes and saved
runs before removing a stale connection lock. Never infer cleanup from the lock.

After verification, remove the temporary connection with
`codex mcp remove pi_spoke_linux`, reload/stop it, verify the VM auth/model files
are absent, and remove the host launcher when no longer needed. The launcher
and its original private gateway files are temporary operator fixtures, not a
permanent installation. The two-provider/vision live gate has passed. Keep Linux readiness false until
the actual-host gate is also evidenced.
