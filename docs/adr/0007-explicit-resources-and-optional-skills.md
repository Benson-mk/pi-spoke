---
status: accepted
date: 2026-09-14
---

# Load explicit project resources and optional skill metadata

Workers start with only explicitly selected resources: scoped project instructions, explicit context files, and an optional skill shortlist whose default is empty. Supply skill metadata and locations first, letting the worker decide whether to read the instructions, while disabling ambient Pi settings, extensions, templates, global skills, and system-prompt overrides. This keeps the initial context attributable and avoids an implicit harness, at the cost of explicit resource selection and a granted reader for nonempty shortlists.

## Consequences

A shortlist is not an access-control list: permitted reads can still encounter other repository skills. Skill text cannot expand authority, and a selected third-party skill may itself prescribe a workflow. Record resource paths and hashes, and reject unexpected changes before continuation; explicit shortlist replacement is supported between runs. Project `AGENTS.md` loading is bounded by the approved project root.

Source: [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), specification 1.1, sections 7. Optional skills and low-noise resource selection; 8. Project context, tools, and resource loading. Accepted in the specification; implementation and verification are pending.
