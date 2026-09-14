# pi-spoke

A local delegation and communication layer between a main agent and independent Pi workers.

Unpublished **0.1.0 — release gates passed on the qualified macOS host**. It implements six stdio MCP
tools, explicit-model Pi workers, durable receipts and continuation, optional
skills, main-mediated questions, and guarded OS-sandboxed file tools. Project
shell-write policies remain unsupported, and arbitrary-shell descendant cleanup
is reported as unconfirmed.

Platform support is limited to the exact host and toolchain identities in
[compatibility](docs/compatibility.md):

- **macOS arm64:** all required release gates passed on the pinned host.
- **Linux arm64:** sandbox execution is implemented and locally verified on the
  pinned Ubuntu 24.04.5 OrbStack VM. Live-provider and actual Codex host
  verification remain pending; Linux release readiness is not claimed.

Other host identities fail closed until requalified. Linux tools use mandatory
bubblewrap/seccomp enforcement; macOS tools use Seatbelt. There is no
unrestricted execution fallback.

Use the qualified Node 24.15.0 binary. On Linux, install `bubblewrap`, `socat`,
`ripgrep`, and `build-essential` first; the build compiles a mandatory native
seccomp filter with `/usr/bin/cc`. Run `npm ci --ignore-scripts` and
`npm run build`, then follow
[operator and Codex setup](docs/operations.md). Start with the enforced
[read-only configuration](examples/read-only.json). No host setup or paid
provider test runs automatically. Replace the example's placeholder absolute
paths and configure provider credentials before use.

`npm run verify` runs typechecking and the local unit, Pi contract, integration,
and actual-sandbox suites. Fixtures are disposable; no live provider is used.
Sandbox tests need a host that permits the sandbox backend to initialize;
Linux fixtures also require a writable `/private/tmp` directory.
See [milestone evidence](docs/implementation-status.md) and the
[macOS acceptance ledger](docs/acceptance-status.json) and
[Linux acceptance ledger](docs/evidence/linux-support/acceptance.json) for
platform-specific evidence. No package or release has been published.

Start with the [documentation index](docs/README.md) for project status, specifications, architectural decisions, and acceptance requirements. The [glossary](CONTEXT.md) defines shared terminology; [agent guidance](AGENTS.md) directs repository work.
