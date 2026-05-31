# claude-nas — project context

Dockerized **Claude Code** running in a hardened sandbox on a **Synology NAS**, with an
**Open WebUI** chat front-end (Ollama-style) talking to it through an OpenAI-compatible
bridge. See [README.md](README.md) for the full walkthrough.

## Git / commits — IMPORTANT

- Author all commits, pushes, and PR descriptions **as the user only (pawisoon)**.
- **Never** add `Co-Authored-By: Claude`, "🤖 Generated with Claude Code", or any other
  AI/assistant attribution or footer to commit messages or PRs.
- Use the user's configured git identity; do not change it.

## Architecture

```
Browser → Open WebUI (chat) → bridge (OpenAI API) → Claude Agent SDK → Claude Code → /workspace
```

- `bridge/server.js` — ~200-line Node service (built-in `http` + `@anthropic-ai/claude-agent-sdk`,
  no other deps). Exposes `/v1/models`, `/v1/chat/completions` (stream + non-stream), `/health`.
  Translates OpenAI chat calls into `query({ prompt, options })` against Claude Code in `/workspace`.
- `bridge/Dockerfile` — `node:20-bookworm-slim`, runs non-root, ships its own Node (sidesteps the
  Synology packaged-Node segfault). The SDK pulls a native CC binary per build arch — **build on the
  NAS** and never skip optional deps.
- `docker-compose.yml` — `bridge` (internal only) + `open-webui` (publishes the UI port).
- `.env` (from `.env.example`) — token, `BRIDGE_API_KEY`, `PUID/PGID`, host paths.

## Security model

The sandbox is the safety boundary (chat UI can't show permission prompts, so the agent runs
`bypassPermissions`): only `/workspace` mounted, non-root, `cap_drop: ALL`, no Docker socket,
bridge off the LAN. Stricter mode: `CLAUDE_PERMISSION_MODE=dontAsk` + `ALLOWED_TOOLS=...`.

## Common commands

```bash
# Deploy / update on the NAS
sudo docker compose up -d --build
sudo docker compose pull && sudo docker compose up -d   # update Open WebUI
sudo docker logs claude-bridge                          # bridge logs

# Local sanity checks
node --check bridge/server.js
docker compose config
```

## Auth

`CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (Pro/Max). Subscription Agent-SDK/headless
usage draws from a separate monthly credit pool (effective ~mid-June 2026).
