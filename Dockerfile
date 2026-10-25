# syntax=docker/dockerfile:1.7
# Один Dockerfile, два итоговых образа:
#   --target server — API и worker (команда задаётся в compose.yaml);
#   --target web    — Caddy со статической сборкой Mini App.
ARG NODE_VERSION=24.22.1
ARG CADDY_VERSION=2

FROM node:${NODE_VERSION}-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN npm install -g pnpm@12.15.0 && npm cache clean --force
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @author-studio/shared build \
 && pnpm --filter @author-studio/server build \
 && pnpm --filter @author-studio/web build \
 && pnpm --filter @author-studio/server deploy --prod /out/server

FROM node:${NODE_VERSION}-alpine AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/server ./
# Каталог медиафайлов: именованный том наследует владельца при первом подключении.
RUN mkdir -p /var/lib/author-studio/media && chown -R node:node /var/lib/author-studio
USER node
EXPOSE 3000
CMD ["node", "dist/main.api.js"]

FROM caddy:${CADDY_VERSION}-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/out /srv/web
