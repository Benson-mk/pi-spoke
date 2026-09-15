# Interactive installation

Run `bash install.sh` from the repository in a terminal. The normal flow asks
for **one workspace and one confirmation**. When an existing Pi configuration
is found, one extra prompt offers to load it. Missing system prerequisites may
need an installation approval.

## Flow

1. **Install:** Detect prerequisites, reuse or install Node 24.15.0, and reuse or
   build pi-spoke with `npm ci --ignore-scripts` and `npm run build`. Missing
   prerequisites can be installed through Homebrew or Ubuntu's apt, or Apple's
   command-line tools installer, after confirmation.
2. **Workspace and defaults:** Choose an existing workspace. If Pi files are
   detected, choose whether to load them. Review paths, tools, and limits, then
   confirm saving, verification, and Codex registration.
3. **Verify and connect:** Run doctor, sandbox canaries, and a six-tool MCP
   handshake automatically. After successful checks, register with Codex if it
   is available. Otherwise, use the generated `codex.toml` connection snippet.

Configure new providers using the
[README model configuration guide](../README.md#model-configuration).

## Defaults

| Setting | New installation default |
|---|---|
| Runtime | `~/.local/share/pi-spoke/current` |
| Private Node | `~/.local/share/pi-spoke/node-v24.15.0` (or an existing matching Node) |
| Configuration | `~/.config/pi-spoke/config.json` |
| State | `~/.local/share/pi-spoke/state` |
| Scratch | `~/.ps-tmp` |
| MCP instance | `codex` |
| Tools | `read`, `grep`, `find`, `ls` |
| File/shell write grants | None |
| Tool network | Disabled |
| Limits | 180 seconds, 12 turns, 3 concurrent runs |
| Models | Empty allowlist unless existing Pi configuration is loaded |
| Worker skills | Disabled |

Existing permissions, limits, and additional workspaces are retained. The chosen
workspace is added if needed. Declining Pi import preserves existing model paths
and restrictions. Accepting points to Pi's `auth.json` and optional `models.json`
and removes the pi-spoke model allowlist, making Pi's catalog available. Detection
uses `PI_CODING_AGENT_DIR` or `~/.pi/agent`; it only checks file presence. Provider
files are never copied or edited. Pi UI settings and extensions are not imported.
Version-1 pi-spoke configurations require explicit migration.

Advanced setups can override paths without adding wizard prompts:

| Environment variable | Purpose |
|---|---|
| `PI_SPOKE_NODE` | Existing qualified Node binary |
| `PI_SPOKE_INSTALL_DIR` | Existing build or a new installation directory |
| `PI_SPOKE_CONFIG_DIR` | Operator configuration folder |
| `PI_SPOKE_INSTANCE` | MCP instance name |
| `PI_SPOKE_CODEX=0` | Save the connection snippet without registering in Codex |
| `PI_CODING_AGENT_DIR` | Existing Pi configuration directory to detect |
| `PI_SPOKE_REF` | Source branch, tag, or commit for download mode |

Override paths must be absolute (Pi's agent directory also accepts `~`).
Installation, configuration, state, and scratch must stay outside worker
workspaces. To upgrade, select a new installation directory with
`PI_SPOKE_INSTALL_DIR` and reuse the configuration folder. Existing runtime
directories are never overwritten; choose a fresh directory after a failed build.

## Saving and verification

The installer creates `config.json` and a `codex.toml` snippet. Existing files get
private backups before replacement. New files and private directories use modes
0600 and 0700. Temporary answers and the review plan are removed on exit; runtime
installation persists if configuration is cancelled. Files changed since review
cause saving to abort. Each file is atomically replaced, but the group is not a
filesystem transaction; inspect reported paths/backups if saving fails partway.

The MCP check uses disposable state and empty credentials. It confirms server
startup and tool discovery without accessing your providers or locking an
existing instance. It does not validate model configuration or entitlement.
Sandbox canaries check the qualified host baseline; see
[compatibility](compatibility.md) for exact macOS/Linux arm64 identities. Linux's
current fixtures require a writable `/private/tmp`. Failed checks prevent
automatic Codex registration; no unrestricted fallback is enabled.

Automatic Codex registration backs up the host configuration and replaces the
`pi_spoke` entry through `codex mcp add`, using CLI timeout defaults. The snippet
includes the repository's recommended 20-second startup and 45-second tool
timeouts for manual configuration. Restart Codex after registration or model
configuration changes.

## Download mode

When no checkout is available, `install.sh` downloads source from
`Benson-mk/pi-spoke` on GitHub, defaulting to `main`. Set `PI_SPOKE_REF` to a
published commit or tag for reproducible source selection. The installer files
must first be published at that ref. Piped invocation still needs a terminal.

See [operations](operations.md) for manual setup and recovery.
