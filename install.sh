#!/usr/bin/env bash
# Local: bash install.sh. Downloaded/piped: fetch the source, then open the wizard.
set -euo pipefail

pi_spoke_install() {
  case "${1:-}" in
    -h|--help)
      printf '%s\n' 'Pi Spoke Installer' 'Usage: bash install.sh' \
        'Installs with defaults, asks for a workspace, checks the MCP server,' \
        'and registers it with Codex after confirmation. See README for model setup.' \
        'Requires an interactive terminal. PI_SPOKE_REF selects a source ref (default: main).'
      return ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; return 1 ;;
  esac
  if ! ( : </dev/tty ) 2>/dev/null; then
    printf 'An interactive terminal is required. Download this script and run: bash install.sh\n' >&2
    return 1
  fi
  # Keep answers separate from a curl | bash script stream.
  exec </dev/tty
  local source_path="${BASH_SOURCE[0]:-}" source_dir="" staging="" ref="${PI_SPOKE_REF:-main}"
  if [[ -n "$source_path" && -f "$source_path" ]]; then
    source_dir=$(cd -- "$(dirname -- "$source_path")" && pwd -P)
  fi
  if [[ -n "$source_dir" && -f "$source_dir/scripts/setup.sh" ]]; then
    bash "$source_dir/scripts/setup.sh"
    return
  fi
  [[ "$ref" =~ ^[a-zA-Z0-9._/-]+$ ]] || { printf 'Invalid PI_SPOKE_REF.\n' >&2; return 1; }
  command -v curl >/dev/null || { printf 'Install curl, then retry.\n' >&2; return 1; }
  command -v tar >/dev/null || { printf 'Install tar, then retry.\n' >&2; return 1; }
  staging=$(mktemp -d "${TMPDIR:-/tmp}/pi-spoke-source.XXXXXX")
  # The trap is intentionally literal; variable contents are never evaluated as code.
  trap 'rm -rf -- "$staging"' EXIT
  printf 'Downloading pi-spoke source (%s)…\n' "$ref"
  curl --proto '=https' --tlsv1.2 --fail --location --show-error \
    "https://codeload.github.com/Benson-mk/pi-spoke/tar.gz/$ref" -o "$staging/source.tar.gz"
  mkdir "$staging/source"
  tar -xzf "$staging/source.tar.gz" -C "$staging/source" --strip-components=1
  bash "$staging/source/scripts/setup.sh"
  rm -rf -- "$staging"
  trap - EXIT
}

pi_spoke_install "$@"
