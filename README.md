# claude-nas

Run **Claude Code** in a hardened Docker sandbox on a **Synology NAS**, and talk to it
from a browser through an **Open WebUI** chat (the Ollama-style UI) — no SSH needed.

```
 Browser ──http──> Open WebUI ──OpenAI API──> bridge ──> Claude Agent SDK ──> Claude
 (you)            (chat UI)     (internal net)  (Node)     (headless Claude Code)
                                                  │
                                                  └── can only touch /workspace
```

Why Docker also *fixes* the well-known Synology crash: the segfault people hit comes
from DSM's **packaged** Node.js being binary-incompatible after a DSM update. This
container ships its **own** Node, so it never touches Synology's Node — the crash is
gone as a side effect.

---

## ⚠️ Read this first — what the chat UI trades away

You asked for an "Ollama-like" chat. That's what this builds. Be aware of the tradeoff:

A chat UI is **stateless**; Claude Code is a **stateful agent**. Wrapping it in a chat
loses the interactive parts:

- **No permission prompts.** A chat can't pop "allow this command?" dialogs. So the
  agent runs in `bypassPermissions` mode — it acts unattended. **The sandbox (only
  `/workspace` mounted, non-root, no Docker socket) is the safety boundary, not a
  prompt.** Don't mount anything into `/workspace` you aren't OK with the agent editing.
- **No plan mode**, no `/slash` command UI, no diff-approval flow.
- Streaming is **chunk-level**, not token-by-token.
- Each message re-sends the conversation as context (no live session memory between turns).

If those matter to you, a **web terminal** (ttyd) running the real Claude Code TUI keeps
100% of the features — ask and that variant is a small change. This repo is the chat build.

---

## Prerequisites

- Synology NAS with **DSM 7.2+** and **Container Manager** installed.
- A **Claude Pro or Max** subscription (used for auth).
- A few minutes of SSH access (to create folders / set ownership).
- Know your NAS CPU arch: SSH in and run `uname -m` → `x86_64` or `aarch64`.
  You'll **build the image on the NAS**, so the arch matches automatically.

> Billing note: as of mid-June 2026, Agent-SDK / headless (`claude -p`) usage on a
> subscription draws from a **separate monthly Agent SDK credit pool**, distinct from
> interactive Claude Code usage. Heavy automated use can exhaust it — keep an eye on it.

---

## Install

### 1. Get a Claude auth token

On **any** machine that has Claude Code installed and is logged into your Pro/Max account:

```bash
claude setup-token
```

Copy the printed token (starts with `sk-ant-oat01-...`). It's long-lived (~1 year).

### 2. Put the project on the NAS

Copy this folder to e.g. `/volume1/docker/claude-nas` (File Station, or `git clone` over SSH).

### 3. Create the data folders and fix ownership

Over SSH (adjust paths if you changed them in `.env`):

```bash
sudo mkdir -p /volume1/docker/claude-nas/{workspace,config,webui}

# Own workspace + config as the user the container runs as (PUID:PGID from .env).
# 1026:100 are typical Synology defaults — confirm with `id`.
sudo chown -R 1026:100 /volume1/docker/claude-nas/workspace
sudo chown -R 1026:100 /volume1/docker/claude-nas/config
```

`workspace/` is the only place the agent can read or write. Put the projects/scripts
you want it to work on there (or let it create them).

### 4. Configure

```bash
cd /volume1/docker/claude-nas
cp .env.example .env
```

Edit `.env` and set at least:

- `CLAUDE_CODE_OAUTH_TOKEN` — the token from step 1.
- `BRIDGE_API_KEY` — any long random string (`openssl rand -hex 32`).
- `PUID` / `PGID` — from `id` (defaults usually fine).

### 5. Deploy

**Option A — Container Manager (GUI):**
Container Manager → **Project** → **Create** → set the path to
`/volume1/docker/claude-nas` → it detects `docker-compose.yml` → **Build** → **Run**.

**Option B — SSH (if the GUI build is fussy):**

```bash
cd /volume1/docker/claude-nas
sudo docker compose up -d --build
```

First build pulls the Node image + SDK (a few minutes).

### 6. Use it

Open `http://<nas-ip>:3000`. Create the first Open WebUI account (it becomes admin —
this login is Open WebUI's own, local to your NAS). Pick the **`claude-code`** model and
chat. Ask it to read/write files — they appear in your `workspace/` share.

---

## Security model

This is built around the isolation the Reddit commenter was worried about:

| Control | What it does |
|---|---|
| Single volume mount (`/workspace`) | Agent literally cannot see the rest of the NAS. |
| Non-root (`user: PUID:PGID`) | No root inside the container; files stay editable from DSM. |
| `cap_drop: ALL` + `no-new-privileges` | Strips Linux capabilities; blocks privilege escalation. |
| **No** `/var/run/docker.sock` | Agent can't control other containers or escape to the host. |
| Bridge not published | Only Open WebUI (internal network) can reach the agent; it's off the LAN. |
| `BRIDGE_API_KEY` | Open WebUI must present the shared key to call the agent. |
| `MAX_TURNS` | Caps agentic steps per message — runaway guard. |

**Want it stricter?** In `.env` set `CLAUDE_PERMISSION_MODE=dontAsk` and
`ALLOWED_TOOLS=Read,Grep,Glob,LS` — the agent then can only use those (read-only) tools
and can't run commands or edit files.

**Exposing beyond your LAN?** Put it behind Synology's reverse proxy with HTTPS, and/or
Synology's VPN. Don't port-forward `3000` to the internet as-is.

---

## Configuration reference

All set in `.env`:

| Var | Default | Meaning |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Token from `claude setup-token`. **Required.** |
| `BRIDGE_API_KEY` | — | Shared secret between UI and bridge. **Required.** |
| `PUID` / `PGID` | `1026` / `100` | NAS user/group the container runs as. |
| `WORKSPACE_DIR` | `.../workspace` | Host folder bind-mounted to `/workspace`. |
| `CONFIG_DIR` | `.../config` | Persists Claude Code config/cache. |
| `WEBUI_DATA_DIR` | `.../webui` | Open WebUI's own data. |
| `WEBUI_PORT` | `3000` | Host port for the chat UI. |
| `CLAUDE_MODEL` | `sonnet` | `sonnet` \| `opus` \| `haiku` \| full id. |
| `CLAUDE_PERMISSION_MODE` | `bypassPermissions` | Or `dontAsk` (+ `ALLOWED_TOOLS`). |
| `ALLOWED_TOOLS` | — | Used with `dontAsk`, e.g. `Read,Grep,Glob`. |
| `SHOW_TOOL_CALLS` | `true` | Show `🔧 Tool` activity lines in chat. |
| `MAX_TURNS` | `40` | Max agentic steps per message. |

---

## Updating

```bash
cd /volume1/docker/claude-nas
sudo docker compose pull          # newer Open WebUI
sudo docker compose build --no-cache bridge   # newer Agent SDK / Claude Code
sudo docker compose up -d
```

---

## Troubleshooting

- **UI loads but no models / 401 from bridge** → `BRIDGE_API_KEY` in `.env` must match;
  Open WebUI sends it as the OpenAI key. Re-deploy after editing `.env`.
- **"Invalid API key" / auth errors in `docker logs claude-bridge`** → token wrong or
  expired. Re-run `claude setup-token`, update `.env`, redeploy.
- **Agent does nothing / "raised permissions while running as root"** → it must run
  non-root. Ensure `PUID`/`PGID` are set (not 0) and the folders are chowned to them.
- **`Exec format error` / native binary won't run** → image built for the wrong arch.
  Build **on the NAS** (`uname -m` to confirm), or rebuild with `--no-cache`. Make sure
  npm didn't skip optional deps.
- **Agent can't write files** → `WORKSPACE_DIR` and `CONFIG_DIR` must be owned by
  `PUID:PGID`. Re-run the `chown` from step 3.
- **Logs**: `sudo docker logs claude-bridge` and `sudo docker logs claude-webui`.

---

## Limitations / possible next steps

- No plan mode, permission prompts, or slash-command UI (chat-UI tradeoff, above).
- Stateless per message (history re-sent each turn). Real session resume is a possible
  enhancement (`resume`/`sessionId` in the SDK).
- Single bridge process; fine for personal use, not tuned for many concurrent chats.
- Alternative front-ends if you change your mind: **ttyd web terminal** (full-fidelity
  Claude Code in a browser) or **code-server** (VS Code + Claude in the terminal).

---

## How it works (the bridge)

`bridge/server.js` is ~200 lines of dependency-light Node (built-in `http` + the official
`@anthropic-ai/claude-agent-sdk`, nothing else — deliberately auditable). It exposes
`GET /v1/models`, `POST /v1/chat/completions` (streaming + non-streaming), and
`GET /health`, translating OpenAI chat calls into `query({ prompt, options })` against
Claude Code running in `/workspace`.

## Credits / sources

- Claude Agent SDK (TypeScript): <https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk>
  and <https://github.com/anthropics/claude-agent-sdk-typescript>
- Open WebUI: <https://github.com/open-webui/open-webui>
- Origin: a Synology subreddit thread about Claude Code segfaulting after a DSM update
  (Node binary incompatibility) and a comment suggesting Docker isolation.
