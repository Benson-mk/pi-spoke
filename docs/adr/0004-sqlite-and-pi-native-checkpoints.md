---
status: accepted
date: 2026-09-14
---

# Store runtime metadata in SQLite and conversations in Pi-native files

The supervisor needs transactional admission, receipts, events, and lifecycle constraints, while Pi owns the conversation representation needed for continuation. Use parent-owned SQLite metadata with Pi-native session files, keeping built-in `node:sqlite` access inside the storage module. The plan accepts that module's documented release-candidate baseline to avoid another native SQLite dependency, and accepts coordinating file durability with database references instead of duplicating Pi's transcript format.

## Consequences

Use short transactions, foreign keys, WAL, and `synchronous=FULL`; persist and fsync promised artifacts before committing durable references. Safe continuation requires a validated conversation branch without unresolved tool-result obligations, not merely an existing session file. Dependency availability and compatibility remain P0 verification work.

Source: [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), specification 1.1, sections 3. Technical baseline and dependency policy; 10. State, durability, cancellation, and recovery. Accepted in the specification; implementation and verification are pending.
