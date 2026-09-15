# Interactive installation

Run `bash install.sh` from the repository in a terminal. The installer uses Bash,
curl, tar, a SHA-256 utility, and a private Node 24.15.0 runtime. It supports the
qualified macOS and Linux arm64 platforms; see [compatibility](compatibility.md)
for the exact identities required to run worker tools. It can install missing
packages through Homebrew or Ubuntu's apt after confirmation, or open Apple's
command-line tools installer. Other systems receive manual prerequisite steps.

## Stages

1. **Host prerequisites:** Check platform, download utilities, compiler, and sandbox/search tools.
2. **Installation:** Reuse an existing build, or download checksum-verified Node
   24.15.0, copy runtime sources into a new private directory, install the locked
   dependencies with `npm ci --ignore-scripts`, and build.
3. **Paths:** Choose configuration, an existing worker workspace, private state,
   short scratch path, and an instance name. Installation/configuration/private
   paths must be separate from workspaces.
4. **Credentials:** Reuse Pi authentication and optional model files, or enter a
   new provider API key with hidden input. OAuth users should reuse the files
   created by Pi's `/login`. New files accept literal API keys; existing Pi files
   may use Pi's credential resolution features.
5. **Model:** Enter exact provider/model IDs and an optional description. New
   custom providers also need their documented base URL, API protocol, token
   limits, reasoning support, and input capabilities. Reuse an existing
   `models.json` for advanced provider compatibility settings.
6. **Permissions:** Choose read-only, structured editing in an explicit existing
   directory, or preserve existing policy. Set run duration, turns, and concurrency.
7. **Review/save:** Validate with the selected installation's configuration,
   permission, and Pi model parsers, then display the proposed settings and files.
   Saving creates private directories and files with modes 0700 and 0600. Existing
   configuration/snippets get backups before replacement. Provider files are never
   overwritten. Credential values are not displayed.
8. **Checks:** Run plain doctor, then optionally sandbox canaries and an actual
   MCP initialize/list-tools/shutdown exchange. The MCP check creates instance
   state. It does not start workers or contact inference providers. Stop an
   existing server using the same instance before checking.
9. **Codex:** After successful checks, optionally register through `codex mcp add`
   with a backup of the existing host configuration. Otherwise, use the generated
   `codex.toml` connection snippet. Restart Codex after registration.

## Files and reruns

The default configuration directory is `~/.config/pi-spoke`. `config.json` is
pi-spoke policy; `auth.json` and `models.json` use Pi's formats. Reused Pi files
stay at their existing locations. `codex.toml` is a host connection snippet,
not another Pi settings file. Automatic registration uses the Codex CLI's timeout
defaults; the snippet includes the repository's recommended 20-second startup
and 45-second tool timeouts for manual configuration.

Answers and a private review plan live in a temporary directory removed on exit.
Cancellation before saving discards the answers; an already installed runtime
remains available to reuse. Stop the existing MCP instance before changing its
configuration. On reruns, additional workspaces/models and unprompted settings
are retained. The selected model's description is updated. Read/edit policy
choices explicitly replace the tool/write policy; keep preserves it.

For a new custom provider, use a new configuration folder if its `auth.json` or
`models.json` already exists, or configure it through Pi and choose reuse.
Version-1 operator configurations require explicit migration and are rejected.

An existing installation directory is never overwritten. To rebuild from a newer
checkout, choose a new installation directory and reuse the same configuration
folder. If a build fails, retain the reported directory for inspection and choose
a fresh directory on the next attempt. The installer does not delete old runtime
installations or worker sessions.

Each file is saved by atomic replacement with a backup where applicable; the
whole group is not a filesystem transaction. If saving fails partway, inspect
the reported paths/backups and rerun. Files changed since review cause the save
to abort before writing.

## Download mode and verification

The standalone `install.sh` bootstrap fetches the source archive from
`Benson-mk/pi-spoke` on GitHub when no local checkout is available. It defaults to
`main`; set `PI_SPOKE_REF` to a specific published commit or tag for reproducible
source selection. An interactive terminal is still required even when the script
is piped to Bash. The installer must first be published at that ref.

Installation and a successful MCP handshake do not establish sandbox readiness
or provider entitlement. Sandbox canaries verify the supported host baseline;
different toolchain identities fail closed and require qualification. Linux's
current canary fixtures also require a writable `/private/tmp`. Checks never
enable an unrestricted fallback or perform live model calls. Failed or skipped
checks are listed as remaining work and disable automatic Codex registration.

See [operations](operations.md) for manual setup, live checks, and recovery.
