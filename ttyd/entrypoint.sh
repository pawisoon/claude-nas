#!/usr/bin/env bash
set -euo pipefail

# The web terminal exposes a real shell — refuse to start without basic-auth creds.
if [ -z "${TTYD_USER:-}" ] || [ -z "${TTYD_PASS:-}" ]; then
  echo "ERROR: TTYD_USER and TTYD_PASS must be set (the terminal exposes a shell)." >&2
  exit 1
fi

# What opens when you connect: 'bash' (default — a shell in /workspace, type `claude`)
# or 'claude' to drop straight into the Claude Code TUI.
SHELL_CMD="${TTYD_SHELL:-bash}"

echo "[claude-terminal] ttyd on :7681  shell=${SHELL_CMD}  cwd=$(pwd)"

exec ttyd \
  --writable \
  --port 7681 \
  --credential "${TTYD_USER}:${TTYD_PASS}" \
  "${SHELL_CMD}"
