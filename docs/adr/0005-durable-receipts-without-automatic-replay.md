---
status: accepted
date: 2026-09-14
---

# Suppress duplicate requests and preserve uncertain outcomes

Persist spawn/send acceptance and its request-key receipt before dispatching work, returning the same receipt for the same accepted input and rejecting conflicting reuse. After a crash, preserve uncertain delivery and mark lost runs interrupted rather than automatically replaying commands or tasks. This favors honest side-effect accounting over automatic recovery because the runtime cannot transact atomically with tools or model providers.

## Consequences

This is duplicate suppression, not exactly-once tool execution or provider billing. Retain request-key tombstones when pruning payloads. Explicit continuation requires a safe checkpoint and confirmed or explicitly operator-attested cleanup; never fabricate a tool result to repair history. If cleanup cannot be confirmed, report interruption rather than successful cancellation.

Source: [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), specification 1.1, sections 10. State, durability, cancellation, and recovery; 11. Error and observability contract. Accepted in the specification; implementation and verification are pending.
