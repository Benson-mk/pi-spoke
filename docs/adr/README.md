# Architecture decisions

These ADRs import the durable decisions already resolved in [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), specification 1.1, dated 14 September 2026, targeting application release 0.1.0. `accepted` means accepted in that specification, not implemented or verified. Implementation and qualification evidence are tracked in [implementation status](../implementation-status.md).

The records preserve rationale and consequences; the plan retains the detailed implementation contract. [PHILOSOPHY.md](../PHILOSOPHY.md) governs product ownership and scope, and [SAFETY_SPEC.md](../SAFETY_SPEC.md) is normative together with the plan. The safety revision replaces specification 1.0's trusted-local-shell design; no older ADRs were present to supersede.

| ADR | Decision |
|---|---|
| 0001 | [Keep orchestration with the main agent](0001-main-agent-owns-orchestration.md) |
| 0002 | [Use local MCP and a supervised Pi process per run](0002-local-mcp-and-supervised-pi-workers.md) |
| 0003 | [Separate persistent sessions from disposable runs](0003-separate-session-and-run-identities.md) |
| 0004 | [Store runtime metadata in SQLite and conversations in Pi-native files](0004-sqlite-and-pi-native-checkpoints.md) |
| 0005 | [Suppress duplicate requests and preserve uncertain outcomes](0005-durable-receipts-without-automatic-replay.md) |
| 0006 | [Enforce tool authority with an OS sandbox and separate write grants](0006-os-sandbox-and-independent-write-authority.md) |
| 0007 | [Load explicit project resources and optional skill metadata](0007-explicit-resources-and-optional-skills.md) |
| 0008 | [Use pull observation and main-mediated worker communication](0008-pull-observation-and-main-mediated-communication.md) |

When changing a recorded architectural decision, add the next numbered ADR with the reason and trade-off, then mark the prior record superseded and link its replacement. Keep API fields, dependency versions, and test matrices in their detailed source documents.
