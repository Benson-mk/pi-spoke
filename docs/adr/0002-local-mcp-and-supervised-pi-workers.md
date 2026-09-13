---
status: accepted
date: 2026-09-14
---

# Use local MCP and a supervised Pi process per run

Use a local stdio MCP server with six host tools and a supervised Node child process embedding the public Pi SDK for each active run. The process boundary contains worker crashes and provides a cancellation fallback, while disposing children after checkpointed completion avoids idle workers and dependence on a global Pi CLI. Accept startup and memory overhead, which must be measured, and keep one active server per instance rather than introducing a daemon, shared live workers, or desktop lifecycle integration.

## Consequences

The six host tools are `spoke_catalog`, `spoke_spawn`, `spoke_observe`, `spoke_send`, `spoke_cancel`, and `spoke_sessions`. MCP stdout is protocol-only. Closing MCP stdin shuts down supervised work; saved conversations can be continued later. A worker process is not itself a security sandbox; tool containment is recorded in ADR 0006.

Source: [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), specification 1.1, sections 4. Runtime architecture; 5. Public MCP contract. Accepted in the specification; implementation and verification are pending.
