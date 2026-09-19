# Build this image ON the Synology NAS (or for the NAS's CPU arch).
# The Agent SDK pulls a native Claude Code binary matching the build arch as an
# OPTIONAL dependency — so the arch you build on must match the arch you run on,
# and optional deps must NOT be skipped.
FROM node:22-bookworm-slim

# System tools Claude Code expects (git for repos, ripgrep for search).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
      ripgrep \
      curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# Claude Code writes its config/state under $HOME/.claude — point it at the
# /config mount so it persists and is writable by the non-root run user.
ENV HOME=/config

WORKDIR /app
COPY package.json ./
# --omit=dev drops devDependencies but KEEPS optional deps (the native binary).
RUN npm install --omit=dev && npm cache clean --force

COPY server.js ./

EXPOSE 8000
CMD ["node", "server.js"]
