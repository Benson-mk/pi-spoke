# Issue tracker: GitHub

Specs and tickets live in [Benson-mk/pi-spoke GitHub Issues](https://github.com/Benson-mk/pi-spoke/issues). Use `gh` with `--repo Benson-mk/pi-spoke`.

## Publishing specs

1. Inspect existing issues for equivalent work; update the matching issue when the request revises it.
2. Use `--body-file` for multiline bodies. Apply the `ready-for-agent` role from the [label mapping](triage-labels.md) to a completed spec.
3. Read the published issue back and verify its body and label. Return its URL; if publication fails, retain the local draft and report it as unpublished.

## Working from tickets

Read the issue body, labels, and comments before acting. Keep ticket updates on that issue so later work sees the decisions and outstanding blockers.

PRs as a request surface: no.
