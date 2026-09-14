# Project documentation

pi-spoke is a local delegation and communication layer between a main agent and independent Pi workers. This repository contains specification 1.1 and an unpublished, release-qualified implementation of application 0.1.0 on the pinned macOS host. Release readiness is tracked with observed evidence; qualification is scoped to recorded host/toolchain identities. Linux execution is implemented for the pinned OrbStack VM; its external release gates remain pending.

| Read when you need… | Document |
|---|---|
| Implemented milestones and remaining gates | [Implementation status](implementation-status.md) · [Acceptance ledger](acceptance-status.json) · [Release audit](release-audit.md) |
| Local operation and Codex configuration | [Operations](operations.md) · [Host verification](codex-host-verification.md) · [Linux host verification](linux-host-verification.md) |
| Qualified dependencies and limitations | [Compatibility](compatibility.md) |
| Initial release specification | [pi-spoke 0.1.0 spec](specs/pi-spoke-v0.1.md) · [GitHub issue #1](https://github.com/Benson-mk/pi-spoke/issues/1) |
| Shared project terminology | [Context glossary](../CONTEXT.md) |
| Architectural decisions and their rationale | [ADR index](adr/README.md) |
| Product ownership, autonomy, and scope | [Philosophy](PHILOSOPHY.md) |
| Runtime design, public API, lifecycle, and release criteria | [Implementation plan](IMPLEMENTATION_PLAN.md) |
| Permission and OS sandbox requirements | [Safety specification](SAFETY_SPEC.md) |
| Required sandbox acceptance scenarios | [Safety tests](SAFETY_TESTS.md) |
| Implementation sequence and milestone deliverables | [Implementation tasks](IMPLEMENTATION_TASKS.md) |

## Authority and evidence

[Philosophy](PHILOSOPHY.md) governs product ownership and scope. The [implementation plan](IMPLEMENTATION_PLAN.md) and [safety specification](SAFETY_SPEC.md) jointly define the implementation contract; the plan's A01–A30 cases and [safety tests](SAFETY_TESTS.md) define acceptance. For execution, permissions, recovery, or release work, read the applicable safety requirements and cases alongside the plan.

The release spec synthesizes these contracts, ADRs preserve decision rationale, and the work order sequences delivery. Resolve disagreements against the governing documents and record any deliberate change explicitly.

The ADRs were extracted from the plan without revalidating its upstream dependency claims. Exact dependency installation, compatibility checks, and sandbox enforcement remain implementation work. The plan references a `CHANGELOG.md` that was not included in the imported planning package.
