# syntax=docker/dockerfile:1
#
# Single multi-stage image: builds the pnpm workspace and serves the API + built
# static frontend. NOTE: builds successfully once the `server`/`web` workspaces
# exist (their build output: server/dist, web/dist). Until then this is the target.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

# ---- Build: install all deps, build every workspace, prune to prod ----
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm -r build
# Produce a self-contained, production-only bundle for the server.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter ./server deploy --prod /app/deploy

# ---- Runtime: minimal, only built artifacts + prod node_modules ----
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build /app/deploy/node_modules ./node_modules
COPY --from=build /app/deploy/package.json ./package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
EXPOSE 8080
USER node
CMD ["node", "server/dist/index.js"]
