# pi-spoke

A local delegation and communication layer between a main agent and independent Pi workers.

Unreleased **0.1.0 candidate — not release-ready**. It implements six stdio MCP
tools, explicit-model Pi workers, durable receipts and continuation, optional
skills, main-mediated questions, and guarded OS-sandboxed file tools. Project
shell-write policies remain unsupported, and arbitrary-shell descendant cleanup
is reported as unconfirmed. No platform release support is claimed yet.

Use Node 24.15.0, run `npm ci --ignore-scripts` and `npm run build`, then follow
[operator and Codex setup](docs/operations.md). Start with the enforced
[read-only configuration](examples/read-only.json). No host setup or paid
provider test runs automatically.

`npm run verify` runs typechecking and the local unit, Pi contract, integration,
and actual-sandbox suites. Fixtures are disposable; no live provider is used.
See [milestone evidence](docs/implementation-status.md) and the
[acceptance ledger](docs/acceptance-status.json) for incomplete release gates.

Start with the [documentation index](docs/README.md) for project status, specifications, architectural decisions, and acceptance requirements. The [glossary](CONTEXT.md) defines shared terminology; [agent guidance](AGENTS.md) directs repository work.
