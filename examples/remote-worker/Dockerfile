# Build from the repository root. Supply approved runtime versions explicitly.
FROM node:22-bookworm AS build
WORKDIR /opt/harnessfile
COPY packages/cli/package*.json ./
RUN npm ci
COPY packages/cli/tsconfig.json ./
COPY packages/cli/src ./src
COPY packages/cli/bin ./bin
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm
ARG CLAUDE_CODE_VERSION
ARG CODEX_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends git gh ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN test -n "$CLAUDE_CODE_VERSION" && test -n "$CODEX_VERSION" \
    && npm install -g "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" "@openai/codex@$CODEX_VERSION"
COPY --from=build /opt/harnessfile /opt/harnessfile
USER node
WORKDIR /home/node
# Infrastructure creates and executes the worker separately for every task.
CMD ["sleep", "infinity"]
