# Stage 1: dependencies
# Debian (glibc) base — NOT alpine. @livekit/rtc-node ships only glibc (-gnu)
# native NAPI binaries; there is no musl build, so it cannot load on alpine.
FROM node:20-bookworm-slim AS deps
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

# Copy workspace config + lockfile first (cache layer)
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY package.json turbo.json tsconfig.json ./

# Copy package.json files for all workspace members
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/inference/package.json packages/inference/
COPY packages/trainer/package.json packages/trainer/

# Fetch all deps (leverages pnpm store)
RUN pnpm fetch

# Copy source, then install from store
COPY . .
RUN pnpm install --offline --frozen-lockfile

# Stage 2: build
FROM deps AS builder
WORKDIR /app
ARG NEXT_PUBLIC_TRAINING_BUCKET_URI
ENV NEXT_PUBLIC_TRAINING_BUCKET_URI=$NEXT_PUBLIC_TRAINING_BUCKET_URI
RUN pnpm turbo run build --filter=web

# Stage 3: production runner
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# LiveKit's NAPI native binding is loaded via a dynamic, platform-specific
# require() that Next's standalone tracer cannot follow. Copy the resolved
# @livekit packages (loader + glibc binary) explicitly so live narration audio
# works in production. (Demo mode noops the bridge and doesn't need these.)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.pnpm/@livekit+rtc-ffi-bindings-linux-x64-gnu@0.12.60 ./node_modules/.pnpm/@livekit+rtc-ffi-bindings-linux-x64-gnu@0.12.60
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.pnpm/@livekit+rtc-ffi-bindings@0.12.60 ./node_modules/.pnpm/@livekit+rtc-ffi-bindings@0.12.60

USER nextjs
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
