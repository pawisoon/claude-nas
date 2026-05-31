# claude-nas — project context

Dockerized **Claude Code** in a hardened sandbox on a **Synology NAS**, with **two**
front-ends sharing the same sandbox + auth. See [README.md](README.md) for the full walkthrough.

1. **Chat** (`docker-compose.yml`) — Open WebUI → `bridge/` (OpenAI-compatible, Node + Agent SDK) → Claude Code.
2. **Terminal** (`docker-compose.terminal.yml`) — `ttyd/` serves the real Claude Code TUI in a browser.

## Git / commits — IMPORTANT

- Author all commits, pushes, and PR descriptions **as the user only (pawisoon)**.
- **Never** add `Co-Authored-By: Claude`, "🤖 Generated with Claude Code", or any other
  AI/assistant attribution to commit messages or PRs.
- Use the user's configured git identity; do not change it.

## Layout

```
docker-compose.yml            # chat: open-webui + bridge (internal :8000, UI :3000)
docker-compose.terminal.yml   # terminal: ttyd (:7681)
.env.example                  # shared config (token, PUID/PGID, paths, per-variant secrets)
bridge/  server.js Dockerfile package.json   # chat bridge (built-in http + @anthropic-ai/claude-agent-sdk)
ttyd/    Dockerfile entrypoint.sh            # ttyd static binary + real @anthropic-ai/claude-code CLI
.github/workflows/build.yml   # CI: multi-arch build of both images -> GHCR on push to main
portainer/  chat-stack.yml terminal-stack.yml   # image-based composes for Portainer (pull from GHCR)
```

## Shipping / CI

- `.github/workflows/build.yml` builds `claude-nas-bridge` + `claude-nas-terminal` for amd64+arm64 and pushes to
  `ghcr.io/pawisoon/*` on every push to main (+ `v*` tags). Uses GITHUB_TOKEN, `packages: write`.
- Make the GHCR packages **public** after first build, or add ghcr creds in Portainer.
- Local dev still uses the `build:` composes; Portainer/prod uses the image-based `portainer/` composes.

## Key facts

- Both images ship their own Node → sidestep the Synology packaged-Node segfault.
- Both run **non-root** (`user: PUID:PGID`), `cap_drop: ALL`, no Docker socket, mount only `/workspace` + `/config`.
- Build **on the NAS** so the arch matches: the Agent SDK pulls a native binary (don't skip optional deps),
  and `ttyd/Dockerfile` downloads the ttyd static binary by arch (amd64→x86_64, arm64→aarch64).
- Auth: `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (Pro/Max). Chat (headless) draws from the
  separate monthly Agent SDK credit pool; terminal (interactive) uses normal interactive allowance.
- Chat caveat: no plan mode / permission prompts (runs `bypassPermissions`); terminal is 100% fidelity.
- Chat multi-user: provision in Admin → Users; mark the model **Public** (Admin → Settings → Models) or non-admins see no models.

## Common commands

```bash
sudo docker compose up -d --build                              # chat
sudo docker compose -f docker-compose.terminal.yml up -d --build   # terminal
node --check bridge/server.js                                  # local sanity
docker compose config                                          # validate compose
```

## Local testing

`.local-test/` holds throwaway workspace/config/webui dirs used to verify the stack on a dev machine
(gitignored). A real `.env` with the token may exist locally (gitignored — never committed).
