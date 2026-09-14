# Linux Codex host verification

Status: PASS on 2026-09-14 through actual registered `pi_spoke_linux` tools.
[Recorded results](evidence/linux-support/codex-host.json). The temporary
registration was removed after verification; the existing macOS `pi_spoke`
registration was unchanged.

Codex ran on macOS and called the server and workers inside the isolated
`pi-spoke-linux-test` OrbStack VM over stdio. This qualifies Codex-to-Linux-server
integration, not a native Linux Codex installation. No host filesystem sharing
was needed. Setup followed the documented
[Codex stdio MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Verified behavior

All six tools were called through Codex. Catalogs exposed the explicit model,
read-only authority and empty skills. The main agent independently calculated
17 × 23 = 391 while a worker ran. Repeated observation left its question pending;
steering while waiting correctly returned `QUESTION_REPLY_REQUIRED`. A reply to
the exact question ID unblocked a real sandboxed read. Native continuation
repeated the canary from the same conversation using zero tools.

Cancellation of a separate worker waiting on a question completed with confirmed
cleanup. An active multi-step read fixture recorded `steer_queued` and
`steer_delivered`, then ended with `LINUX-HOST-VERIFIED`. One in-progress read
finished after delivery; steering does not interrupt a current tool. All runs
were terminal with confirmed cleanup and no active sessions remained.

## Fixture and correction

- VM Node: `/home/benson/runtime/node-v24.15.0-linux-arm64/bin/node`.
- VM server: `/home/benson/pi-spoke/dist/cli.js`.
- VM config: `/private/tmp/ps-linux-host-verification/config.json`.
- VM workspace: `/private/tmp/ps-linux-host-verification/project`.
- Instance: `codex-linux-host-verification`.
- Model: `operator-gateway` / `iFiy/spark-x2.5-4b`.
- Tools: `read`; no file/shell write roots, skills or project context.
- Canary: `canary.txt` held `LINUX-HOST-CANARY-20260914` and a newline.
- Canonical scratch root: `/private/tmp/ps-lhs`.

The initial fixture failed before inference because its full scratch path plus
SRT socket name exceeded Linux’s Unix socket pathname limit. Scratch was moved
to the shorter root, with the former scratch path retained as an alias for the
already-loaded connection. Canonical policy resolution and sandbox grants were
unchanged. Future reproduction should use the short scratch root directly.
The first arithmetic steering fixture finished before delivery and correctly
returned `RUN_NOT_ACTIVE`; that attempt was not counted as a steering pass.
Both observations are retained in the evidence.

## Cleanup and reproduction

The temporary server was gracefully stopped after checking its process identity.
Its auth/model copies and connection lock were verified absent. The temporary
Codex registration and host launcher were removed. Saved private sessions and
disposable canaries remain for inspection; original macOS credentials were not
changed. No package was published.

To reproduce, prepare a fresh private fixture using a short scratch root, register
its stdio transport, reload Codex tools and run the full
[host checklist](codex-host-verification.md#checklist-to-execute-through-codexs-registered-pi_spoke-tools)
through the registered Linux tools. Existing session authorization covers the
specified temporary credential transfer and disposable checks. Preserve uncertain
runs and verify process exit before removing credentials or stale locks. Transport
discovery alone is not actual host verification.

The two-provider/vision and actual-host gates now pass for the pinned Linux VM.
