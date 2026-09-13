---
status: accepted
date: 2026-09-14
---

# Separate persistent sessions from disposable runs

A session is a persistent worker conversation, while a run is one host-requested execution in that conversation and a child process is its disposable execution machinery. Spawn creates a fresh conversation; explicit continuation creates a new run from a validated checkpoint, with at most one active run per session. Keep the model, tools, write roots, working directory, and project-context policy fixed for the session so continuation cannot silently become a different identity or authority grant.

## Consequences

A different model, directory, or stronger permission grant requires a new session with an explicit handoff. Continuation revalidates existing authority and resources, and uses `expected_last_run_id` to reject stale requests. A skill shortlist can be explicitly replaced between runs. Fresh conversation context does not isolate shared filesystem changes; the main agent owns worktrees and integration.

Source: [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), specification 1.1, sections 4. Runtime architecture; 5.5 spoke_send; 10. State, durability, cancellation, and recovery. Accepted in the specification; implementation and verification are pending.
