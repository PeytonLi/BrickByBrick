# Agent B · Deploy — DO App Platform

**Owns:** `Dockerfile` (root), `app.yaml` (root), `.dockerignore` (root), `apps/web/next.config.ts` (1 line)  
**Must not touch:** Any `src/` files, any `packages/*/src/`  
**Depends on:** Nothing (parallel with A, C, D)  
**Master plan:** `PLAN_DO_ATLAS.md`

## What you're building

Production-grade deployment config for the Next.js 15 pnpm monorepo:
1. Multi-stage Dockerfile that builds turbo + pnpm workspace
2. DO App Platform app spec (YAML) with all secrets
3. `.dockerignore` to keep the image lean
4. One-line change to `next.config.ts`: `output: 'standalone'`

## Files to create/modify

### 1. `Dockerfile` (repo root — CREATE)

```dockerfile
# Stage 1: dependencies
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

# Copy workspace config + lockfile first (cache layer)
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY package.json turbo.json tsconfig.json ./

# Copy package.json files for all workspace members
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
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
RUN pnpm turbo run build --filter=@brickbybrick/web

# Stage 3: production runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
```

**Important:** If Agent A creates `packages/db/`, update the Dockerfile deps stage to include:
```
COPY packages/db/package.json packages/db/
```

### 2. `.dockerignore` (repo root — CREATE)

```
node_modules
.next
.turbo
.git
.gitignore
__fixtures__
**/__fixtures__/**
.env
.env.*
*.md
!README.md
.kiro
.vscode
.idea
```

### 3. `app.yaml` (repo root — CREATE)

```yaml
name: brickbybrick
services:
  - name: web
    github:
      repo: <YOUR-GITHUB-ORG>/BrickByBrick
      branch: main
      deploy_on_push: true
    dockerfile_path: Dockerfile
    http_port: 8080
    instance_count: 1
    instance_size_slug: basic-s
    envs:
      - key: GEMINI_API_KEY
        scope: RUN_TIME
        type: SECRET
      - key: ANTIGRAVITY_AGENT
        scope: RUN_TIME
        value: antigravity-preview-05-2026
      - key: GEMINI_LIVE_MODEL
        scope: RUN_TIME
        value: gemini-live-2.5-flash-preview
      - key: GEMINI_LIVE_SAMPLE_RATE
        scope: RUN_TIME
        value: "24000"
      - key: LIVEKIT_URL
        scope: RUN_TIME
        type: SECRET
      - key: LIVEKIT_API_KEY
        scope: RUN_TIME
        type: SECRET
      - key: LIVEKIT_API_SECRET
        scope: RUN_TIME
        type: SECRET
      - key: PRIME_API_KEY
        scope: RUN_TIME
        type: SECRET
      - key: NEXT_PUBLIC_TRAINING_BUCKET_URI
        scope: RUN_TIME
        type: SECRET
      - key: STRONG_MODEL
        scope: RUN_TIME
        value: gemini-3.1-pro-preview
      - key: WEAK_MODEL
        scope: RUN_TIME
        value: gemma-4-26b-a4b-it
      - key: GEMINI_EMBED_MODEL
        scope: RUN_TIME
        value: gemini-embedding-001
      - key: DIGITALOCEAN_MODEL_ACCESS_KEY
        scope: RUN_TIME
        type: SECRET
      - key: DO_API_TOKEN
        scope: RUN_TIME
        type: SECRET
      - key: MONGODB_ATLAS_URI
        scope: RUN_TIME
        type: SECRET
      - key: MONGODB_DB_NAME
        scope: RUN_TIME
        value: brickbybrick
      - key: BBB_DEMO_MODE
        scope: RUN_TIME
        value: "0"
```

**Note:** Replace `<YOUR-GITHUB-ORG>` with the actual GitHub org/username. Leave it as a placeholder if unknown — Agent E will fill it in.

### 4. `apps/web/next.config.ts` — EDIT

**Current (lines 4-13):**
```ts
const nextConfig: NextConfig = {
  transpilePackages: [
    '@brickbybrick/core',
    '@brickbybrick/inference',
    '@brickbybrick/trainer',
  ],
  serverExternalPackages: ['@livekit/rtc-node'],
  outputFileTracingRoot: path.join(__dirname, '../../'),
}
```

**Add `output: 'standalone'`:**
```ts
const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@brickbybrick/core',
    '@brickbybrick/inference',
    '@brickbybrick/trainer',
  ],
  serverExternalPackages: ['@livekit/rtc-node'],
  outputFileTracingRoot: path.join(__dirname, '../../'),
}
```

## Key rules

1. **Docker port MUST be 8080** — DO App Platform requires it.
2. **`output: 'standalone'` is REQUIRED** — without it, the Next.js runner stage won't have a `server.js`.
3. **Do NOT hardcode secrets in `app.yaml`** — use `type: SECRET` and set them in the DO console.
4. **Test the Docker build** before declaring done.
5. **The Dockerfile must include `packages/db/package.json`** in the COPY layer if Agent A's package exists. Check if `packages/db/package.json` exists and include it if so — otherwise the build will fail when E integrates.

## Verification

```bash
# Build
docker build -t bbb-web .

# Run locally (needs .env.local with real values)
docker run -p 8080:8080 --env-file .env.local bbb-web

# Check it responds
curl http://localhost:8080

# Confirm local dev still works
pnpm turbo run build
```
