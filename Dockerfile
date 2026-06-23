# Leo — local Claude Code orchestrator.
# Debian (glibc) base so the @libsql/client prebuilt binary loads cleanly.
FROM node:20-bookworm-slim

# ---- OS deps: git/ssh for commit+push, gh for PRs, the Claude Code CLI ----
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git openssh-client ca-certificates curl gnupg \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# Official Claude Code CLI (provides `claude`, incl. `claude auth status`).
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Build the app.
COPY . .
RUN npm run build && rm -rf /app/data

# Claude Code (non-root) needs a writable HOME for its config/cache; running as
# root would also disable --dangerously-skip-permissions (bypassPermissions).
# Own all of /app so `next start` (cache) and the SQLite DB are writable as node.
RUN mkdir -p /app/data /home/node/.claude \
  && chown -R node:node /app /home/node

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV LEO_DATA_DIR=/app/data

USER node
EXPOSE 3000
CMD ["npm", "start"]
