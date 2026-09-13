# Contributing

Use Node 24.15 or later within Node 24, and install the committed lock with
`npm ci`. The implementation follows the governing documents linked in
[docs/README.md](docs/README.md). Preserve the glossary and module boundaries.

Run `npm run typecheck`, `npm test`, `npm run test:contract`, and the applicable
integration suites. `npm run verify` must fail while any required suite is
blocked or absent. Routine tests use local fake providers and never paid
inference. `npm run test:live` is explicitly gated by `PI_SPOKE_LIVE=1` and
configured credentials; an opt-in flag alone cannot turn unimplemented checks
into passes.

Real sandbox tests require a host where SRT can create its local infrastructure
and establish its own OS boundary. An enclosing development sandbox can prevent
initialization; that is a blocked check, not successful containment. Destructive
probes use only test-owned disposable directories. Do not weaken host security
settings, install system software automatically, or retry tools unsandboxed.

Record evidence and incomplete cases in `docs/implementation-status.md`. Keep
commits coherent and use Conventional Commits. A passing compatibility probe
does not establish a passing release acceptance case. Never claim successful
cleanup solely from one process exiting.
