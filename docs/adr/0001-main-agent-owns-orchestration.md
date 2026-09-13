---
status: accepted
date: 2026-09-14
---

# Keep orchestration with the main agent

pi-spoke exists to expose independent Pi workers while preserving the host agent's ownership of delegation, model choice, coordination, verification, and integration. Keep the runtime deterministic and limited to capabilities and execution invariants; require an explicit provider/model selection and leave the worker's local method to the worker. This avoids a second planner, fixed roles, task classifiers, automatic model fallback, and mandatory workflows, at the cost of requiring the main agent to supply self-contained assignments and judge results.

## Consequences

A worker's completed run is evidence of execution, not acceptance of its work. Pi-native context compaction remains enabled and observable; it does not introduce a bridge-owned summarization agent.

Source: [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), specification 1.1, sections 2. Philosophy as an implementation contract; 6. Dynamic models without a hidden router. Accepted in the specification; implementation and verification are pending.
