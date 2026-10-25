# syntax=docker/dockerfile:1
# MetriBee. Credentials come from env (GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY), never a file.

FROM node:22-alpine AS pnpm
ENV PNPM_HOME=/pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
RUN corepack enable && corepack install

# Compile controllers/*.ts to .js so the runtime image needs no ts-node or typescript.
FROM pnpm AS build
COPY tsconfig.json ./
COPY controllers/*.ts controllers/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm dlx --package="typescript@$(node -p "require('./package.json').devDependencies.typescript")" \
      tsc -p . --noCheck --outDir . --declaration false --sourceMap false

# Build the Rybbit-derived React UI. The API/runtime still runs as one Express process.
FROM pnpm AS ui
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY frontend frontend
COPY scripts/rybbit-source.js scripts/
COPY controllers controllers
COPY lib lib
COPY public public
RUN pnpm build:ui

FROM pnpm AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter metribee install --frozen-lockfile --prod --package-import-method copy \
 && find node_modules -type f \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -name '*.map' \) -delete

FROM node:22-alpine
WORKDIR /app
# IN_DOCKER=1: the /setup page shows docker commands instead of pnpm ones
ENV NODE_ENV=production PORT=5483 HOST=0.0.0.0 IN_DOCKER=1
COPY --from=deps /app/node_modules ./node_modules
# Runtime files only: no docs, screenshots, tests or dev config.
COPY package.json app.js SETUP.md LICENSE NOTICE ./
COPY LICENSES LICENSES
COPY lib lib
COPY scripts/setup-check.js scripts/
COPY routes routes
COPY views views
COPY public public
COPY --from=ui /app/public/ui public/ui
COPY mcp-server/index.js mcp-server/
COPY mcp-server/lib mcp-server/lib
COPY controllers controllers
COPY --from=build /app/controllers/*.js controllers/
# Writable data: .cache (reports), .data (durable funnel definitions, flags, favicons).
RUN mkdir -p .cache .data mcp-server/.cache && chown -R node:node .cache .data mcp-server/.cache
USER node
VOLUME ["/app/.data"]
EXPOSE 5483
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5483/healthz || exit 1
CMD ["node", "app.js"]
