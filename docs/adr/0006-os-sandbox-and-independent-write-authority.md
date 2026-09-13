---
status: accepted
date: 2026-09-14
---

# Enforce tool authority with an OS sandbox and separate write grants

Specification 1.1 replaces the earlier trusted-local-shell design with mandatory OS-sandboxed tool subprocesses, using a pinned SRT adapter and no unsandboxed fallback. Separate structured file-write roots from shell-write roots under operator ceilings so granting editing does not make arbitrary shell code writable, and granting a tool does not grant workspace-wide authority. Accept platform-specific enforcement work and rejection of unsupported policies in exchange for a boundary enforced below model instructions.

## Consequences

Default tools are read/search only and both project-write grants are empty. Every invocation uses its own immutable policy; fixed file helpers never execute arbitrary shell with writer authority. Tool networking is denied, protected paths remain excluded, and the trusted Pi provider client is outside the tool sandbox. Authorized writes can damage content; cancellation is not rollback. macOS Seatbelt and Linux bubblewrap/seccomp support require actual enforcement tests before platform claims. The normative details and release gates are in [SAFETY_SPEC.md](../SAFETY_SPEC.md) and [SAFETY_TESTS.md](../SAFETY_TESTS.md).

Source: [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), specification 1.1, sections 1. Frozen v0.1 decisions; 8. Project context, tools, and resource loading; 12. Authentication and trust boundaries. Accepted in the specification; implementation and verification are pending.
