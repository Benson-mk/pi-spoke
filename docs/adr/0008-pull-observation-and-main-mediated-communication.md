---
status: accepted
date: 2026-09-14
---

# Use pull observation and main-mediated worker communication

Expose one worker-side `contact_main` tool for notes, questions, and improvement proposals, with identity attached by the runtime and coordination routed through the main agent. Guarantee delivery visibility through durable events and bounded host observation because MCP notifications do not guarantee that the host schedules a new agent turn. This avoids peer messaging and hidden coordination loops, while requiring the main agent to observe workers and answer correlated questions explicitly.

## Consequences

Notes and improvement proposals are nonblocking evidence. A question waits for its committed correlated reply, cancellation, or deadline; steering cannot substitute for that reply. Observation is non-destructive and starts no model work, and its timeout does not cancel a run. Improvement proposals never automatically modify skills, instructions, or future behavior.

Source: [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), specification 1.1, sections 5.4 spoke_observe; 5.5 spoke_send; 9. Worker communication and improvement. Accepted in the specification; implementation and verification are pending.
