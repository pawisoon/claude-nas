# claude-nas

Run Claude Code on a Synology NAS, in Docker, and use it from your browser instead of SSH-ing in every time.

There are two front-ends, and they sit on top of the same container:

- **Chat** — a chat website (Open WebUI) wired up to Claude Code. Handy for quick questions, using it from your phone, or letting other people in the house use it.
- **Terminal** — the actual Claude Code terminal, served in a browser tab (ttyd). Everything Claude Code can do, exactly the way it works over SSH.

Run one or both. Either way, the container can only see the one folder you mount into it — nothing else on the NAS.

## Background

People have been running Claude Code straight on DSM over SSH for a while. A recent DSM update broke that: Synology's bundled Node.js started segfaulting, and Claude Code would die a few seconds after launch. The fix that worked was to stop using Synology's Node.

That's what these containers do — they bring their own Node, so DSM's copy never enters the picture and the crash doesn't happen. Running it in Docker also keeps it fenced in: an agent that gets a little too determined can only reach the folder you handed it, not the whole NAS.

## What you need

- A Synology NAS on DSM 7.2 or newer with Container Manager installed.
- A Claude Pro or Max subscription — that's what it logs in with.
- SSH access for a couple of one-time commands.

One thing on billing: the chat option runs Claude headless, which draws from the monthly Agent SDK credits included with your plan (separate from your normal interactive usage). The terminal option is interactive, so it uses your regular allowance.

## Setup

You only do this once.

1. Get a login token. On any computer that already has Claude Code signed in to your account, run:

   ```
   claude setup-token
   ```

   Copy the token it prints — it starts with `sk-ant-oat01-`.

2. Copy this project onto the NAS, for example to `/volume1/docker/claude-nas`.

3. Create the folders and make them yours (over SSH). The `webui` one is only needed for the chat option:

   ```
   sudo mkdir -p /volume1/docker/claude-nas/{workspace,config,webui}
   sudo chown -R 1026:100 /volume1/docker/claude-nas/{workspace,config}
   ```

   `1026:100` is the usual Synology admin user and group — run `id` to confirm yours.

4. Make your config file and fill it in:

   ```
   cd /volume1/docker/claude-nas
   cp .env.example .env
   ```

   Set your token, your user/group IDs, and the bits for whichever option you're running.

`workspace` is the only folder Claude can read or write, so put the projects you want it to work on in there.

## Option A — Chat

Set `BRIDGE_API_KEY` in `.env` to any long random string (`openssl rand -hex 32` is an easy way to get one).

Start it from Container Manager (Project → Create → point it at this folder → Run), or over SSH:

```
sudo docker compose up -d --build
```

Open `http://your-nas:3000`, make an account — the first one becomes the admin — pick the `claude-code` model, and start chatting. Anything it creates lands in your `workspace` folder.

A few things to know about the chat option:

- It's a chat box, so it can't show the "allow this command?" prompts the real Claude Code does. Instead it runs with those prompts off and does its work inside the sandbox. Don't put anything in `workspace` you wouldn't be happy for it to change.
- Plan mode and slash commands aren't really a chat thing, so they're not here. Use the terminal option if you want them.
- To let other people use it: there's no open sign-up once an admin exists, which is what you want. Add people under Admin Panel → Users, then turn the model on for them under Admin Panel → Settings → Models → `claude-code` → Access → Public. Miss that last step and they'll just see an empty model list.

## Option B — Terminal

Set `TTYD_USER` and `TTYD_PASS` in `.env`. This is a real shell behind a web page, so give it a real password. (Set `TTYD_SHELL=claude` if you'd rather land straight in Claude Code than at a shell prompt.)

Start it:

```
sudo docker compose -f docker-compose.terminal.yml up -d --build
```

Open `http://your-nas:7681`, log in, and you get a shell sitting in `workspace`. Type `claude` and you're in the normal Claude Code terminal — plan mode, permission prompts, slash commands, MCP, all of it.

The first time you start `claude` here it'll ask you to log in — choose the subscription option and do the one-time browser login. After that it's remembered, because the config lives in the `config` folder you mounted, so you go straight to the prompt from then on. (The token in `.env` covers the chat option and any headless `claude -p` you run in this shell — those work right away.)

It's a shell with your token in it, so keep the password on. If you want to reach it from outside your house, put it behind Synology's reverse proxy with HTTPS or a VPN rather than forwarding port 7681 straight to the internet.

## Run it from the registry (Portainer)

You don't have to build on the NAS. Every push to `main` kicks off a GitHub Actions workflow (`.github/workflows/build.yml`) that builds both images for amd64 and arm64 and pushes them to GitHub's container registry:

- `ghcr.io/pawisoon/claude-nas-bridge`
- `ghcr.io/pawisoon/claude-nas-terminal`

After the first build finishes, make those two packages public (GitHub → your profile → Packages → the package → Package settings → Change visibility → Public) so the NAS can pull them without logging in. If you'd rather keep them private, add `ghcr.io` as a registry in Portainer with a personal access token instead.

### Create these folders first

Over SSH on the NAS (skip `webui` if you only run the terminal stack):

```
sudo mkdir -p /volume1/docker/claude-nas/{workspace,config,webui}
sudo chown -R 1026:100 /volume1/docker/claude-nas/{workspace,config}
```

| Folder | Mounted at | What it holds |
|---|---|---|
| `workspace` | `/workspace` | the only place Claude can read/write — your projects, or point it elsewhere (below) |
| `config` | `/config` | Claude's settings and login, kept between restarts |
| `webui` | Open WebUI data | the chat UI's database (chat stack only) |

`workspace` and `config` mount **read-write**, and must be owned by the `PUID:PGID` the container runs as — `1026:100` is the usual Synology admin user/group (run `id` to confirm yours). To point Claude at something else, like a media library, set `WORKSPACE_DIR` to that share instead of the `workspace` folder and make sure that user can write there.

### Terminal stack

Portainer → **Stacks → Add stack** → name it `claude-nas-terminal` → paste this → fill the environment variables → **Deploy**.

```yaml
services:
  terminal:
    image: ghcr.io/pawisoon/claude-nas-terminal:latest
    container_name: claude-terminal
    restart: unless-stopped
    user: "${PUID}:${PGID}"
    environment:
      - CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN}
      - TTYD_USER=${TTYD_USER}
      - TTYD_PASS=${TTYD_PASS}
      - TTYD_SHELL=${TTYD_SHELL:-bash}
      - DISABLE_AUTOUPDATER=1
    ports:
      - "${TTYD_PORT:-7681}:7681"
    volumes:
      - ${WORKSPACE_DIR}:/workspace
      - ${CONFIG_DIR}:/config
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    networks: [claude-net]
networks:
  claude-net:
    driver: bridge
```

Environment variables: `PUID`, `PGID`, `CLAUDE_CODE_OAUTH_TOKEN`, `TTYD_USER`, `TTYD_PASS`, `WORKSPACE_DIR`, `CONFIG_DIR`, `TTYD_PORT`.

### Chat stack

Same steps, named `claude-nas-chat`:

```yaml
services:
  bridge:
    image: ghcr.io/pawisoon/claude-nas-bridge:latest
    container_name: claude-bridge
    restart: unless-stopped
    user: "${PUID}:${PGID}"
    environment:
      - PORT=8000
      - CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN}
      - BRIDGE_API_KEY=${BRIDGE_API_KEY}
      - CLAUDE_MODEL=${CLAUDE_MODEL:-sonnet}
      - CLAUDE_PERMISSION_MODE=${CLAUDE_PERMISSION_MODE:-bypassPermissions}
      - ALLOWED_TOOLS=${ALLOWED_TOOLS:-}
      - SHOW_TOOL_CALLS=${SHOW_TOOL_CALLS:-true}
      - MAX_TURNS=${MAX_TURNS:-40}
    volumes:
      - ${WORKSPACE_DIR}:/workspace
      - ${CONFIG_DIR}:/config
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    networks: [claude-net]
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: claude-webui
    restart: unless-stopped
    depends_on: [bridge]
    ports:
      - "${WEBUI_PORT:-3000}:8080"
    environment:
      - OPENAI_API_BASE_URL=http://bridge:8000/v1
      - OPENAI_API_KEY=${BRIDGE_API_KEY}
      - ENABLE_OLLAMA_API=false
      - WEBUI_NAME=Claude NAS
      - WEBUI_SECRET_KEY=${BRIDGE_API_KEY}
    volumes:
      - ${WEBUI_DATA_DIR}:/app/backend/data
    security_opt: ["no-new-privileges:true"]
    networks: [claude-net]
networks:
  claude-net:
    driver: bridge
```

Environment variables: `PUID`, `PGID`, `CLAUDE_CODE_OAUTH_TOKEN`, `BRIDGE_API_KEY`, `WORKSPACE_DIR`, `CONFIG_DIR`, `WEBUI_DATA_DIR`, `WEBUI_PORT`.

### Ports and Synology reverse proxy

Each stack publishes one port on the NAS:

| Stack | NAS port (env) | → container | What it serves |
|---|---|---|---|
| Chat | `WEBUI_PORT` (default 3000) | open-webui `:8080` | the chat website |
| Terminal | `TTYD_PORT` (default 7681) | terminal `:7681` | the web terminal |

The chat stack's `bridge` has **no** published port on purpose — only Open WebUI reaches it, over the internal network. Leave it that way.

To serve either over HTTPS at a hostname, use Synology's reverse proxy — **Control Panel → Login Portal → Advanced → Reverse Proxy → Create**:

- **Source:** HTTPS, your hostname (e.g. `claude.example.com`), port 443.
- **Destination:** HTTP, `localhost`, port `3000` (chat) or `7681` (terminal).
- **Custom Header tab → Create → WebSocket.** Required — both Open WebUI and ttyd run over WebSockets and won't work through the proxy without it.

Then reach it at `https://claude.example.com` instead of the raw port. Keep 3000/7681 off the public internet directly; go through the reverse proxy, behind Synology's firewall or a VPN.

### Rolling out updates

New commits to `main` rebuild and push `:latest`. To deploy one, hit **Pull and redeploy** on the stack. For hands-off updates, enable the stack's webhook in Portainer and have the workflow ping it after a build, or run Watchtower against the containers.

## How it's locked down

Both options run the same way:

- Only `workspace` is mounted in, so the container can't see the rest of the NAS.
- It runs as your normal user, not root — files stay editable from DSM, and nothing inside has root.
- Linux capabilities are dropped and privilege escalation is turned off.
- The Docker socket is not mounted, so it can't touch other containers or the host.
- The chat backend isn't exposed on your network (only the web UI is, and it needs the shared key). The terminal sits behind its password.

Want the chat agent on a shorter leash? Set `CLAUDE_PERMISSION_MODE=dontAsk` and list only safe tools in `ALLOWED_TOOLS`, like `Read,Grep,Glob`. Then it can look but not touch.

## Settings

Everything lives in `.env`:

| Setting | Used by | What it does |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | both | Your token from `claude setup-token`. Required. |
| `PUID` / `PGID` | both | The user and group the container runs as. |
| `WORKSPACE_DIR` / `CONFIG_DIR` | both | Host folders mounted to `/workspace` and `/config`. |
| `BRIDGE_API_KEY` | chat | Shared secret between the UI and the backend. Required. |
| `WEBUI_DATA_DIR` / `WEBUI_PORT` | chat | Where the UI keeps its data / the port you open (default 3000). |
| `CLAUDE_MODEL` | chat | `sonnet`, `opus`, `haiku`, or a full model id. |
| `CLAUDE_PERMISSION_MODE` / `ALLOWED_TOOLS` | chat | Leave on default, or lock down with `dontAsk` + a tool list. |
| `SHOW_TOOL_CALLS` / `MAX_TURNS` | chat | Show the agent's tool activity / cap how many steps per message. |
| `TTYD_USER` / `TTYD_PASS` | terminal | The login for the web terminal. Required. |
| `TTYD_PORT` | terminal | The port you open (default 7681). |
| `TTYD_SHELL` | terminal | `bash` (default) or `claude`. |

## Updating

```
# Chat
sudo docker compose pull && sudo docker compose build --no-cache bridge && sudo docker compose up -d

# Terminal
sudo docker compose -f docker-compose.terminal.yml up -d --build
```

The terminal image pins Claude Code with `CLAUDE_CODE_VERSION` in `ttyd/Dockerfile` (ttyd with `TTYD_VERSION`), so a rebuild alone won't move it forward. Bump the version there, or override it for one build:

```
sudo docker compose -f docker-compose.terminal.yml build --build-arg CLAUDE_CODE_VERSION=<version> && sudo docker compose -f docker-compose.terminal.yml up -d
```

## If something's off

- Chat shows no models, or 401s: your `BRIDGE_API_KEY` doesn't match. Fix `.env` and redeploy.
- A non-admin sees an empty model list: the model is still private — make it Public (see Option A).
- The terminal asks for a login: that's the `TTYD_USER` / `TTYD_PASS` prompt, working as intended.
- Login errors in the logs: the token is wrong or expired. Run `claude setup-token` again, update `.env`, redeploy.
- "raised permissions while running as root": your `PUID`/`PGID` are zero or the folders aren't owned by them. Re-run the `chown`.
- "Exec format error": the image was built for the wrong CPU. Build it on the NAS itself (`uname -m` to see your arch) and rebuild with `--no-cache`.
- Logs: `sudo docker logs claude-bridge`, `claude-webui`, or `claude-terminal`.

## What's in here

```
docker-compose.yml            chat: build + run locally (Open WebUI + the backend)
docker-compose.terminal.yml   terminal: build + run locally (ttyd)
.env.example                  config for both
bridge/                       the chat backend (Node + the Claude Agent SDK)
ttyd/                         the terminal (ttyd + the Claude Code CLI)
.github/workflows/build.yml   builds both images and pushes them to GHCR on every push to main
portainer/                    ready-to-paste Portainer stacks that pull those images
```

## Thanks

Built on [Open WebUI](https://github.com/open-webui/open-webui), [ttyd](https://github.com/tsl0922/ttyd), and the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript). Started from a Synology subreddit thread about the post-update segfault and a comment suggesting Docker to keep it contained.

## Support

If this saves you some SSH-ing, you can chip in:

- [GitHub Sponsors](https://github.com/sponsors/pawisoon)
- [Buy Me a Coffee](https://buymeacoffee.com/pawisoon)
- [Suppi](https://suppi.pl/pawels)
