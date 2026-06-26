# Setup Agent Brief

## Goal

Scaffold the entire BrickByBrick Turborepo monorepo so that all parallel feature agents can begin immediately from a **green `pnpm turbo run build`**. Every file you create should be complete — no TODOs, no "fill in later".

## Environment

- Node: v24.14.0
- pnpm: 10.30.3
- Working dir: C:\Users\lipey\Code\BrickByBrick (empty git repo)

## Exact Files To Create

### Root

**package.json**
```json
{
  "name": "brickbybrick",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "type-check": "turbo run type-check"
  },
  "devDependencies": {
    "turbo": "^2.5.4",
    "typescript": "^5.7.3"
  },
  "packageManager": "pnpm@10.30.3"
}
```

**pnpm-workspace.yaml**
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**turbo.json**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "type-check": {
      "dependsOn": ["^type-check"]
    }
  }
}
```

**.env.example**
```
NEBIUS_API_KEY=
ANTHROPIC_API_KEY=
AGENTBOX_API_KEY=
PRIME_INTELLECT_API_KEY=
AGENTBOX_MOCK=true
```

**.gitignore**
```
node_modules/
.next/
dist/
.env
.turbo/
*.tsbuildinfo
```

**tsconfig.json** (root, referenced by all packages)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

---

### packages/core

**packages/core/package.json**
```json
{
  "name": "@brickbybrick/core",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc --noEmit",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "typescript": "^5.7.3"
  }
}
```

**packages/core/tsconfig.json**
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

**packages/core/src/index.ts** — stub only, feature agent A will fill:
```ts
export * from './schemas'
```

**packages/core/src/schemas.ts** — stub only, feature agent A will fill:
```ts
// Filled by feature agent A
export {}
```

---

### packages/inference

**packages/inference/package.json**
```json
{
  "name": "@brickbybrick/inference",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc --noEmit",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@brickbybrick/core": "workspace:*",
    "@anthropic-ai/sdk": "^0.54.0",
    "openai": "^4.103.0"
  },
  "devDependencies": {
    "typescript": "^5.7.3"
  }
}
```

**packages/inference/tsconfig.json**
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

**packages/inference/src/index.ts** — stub:
```ts
export * from './nebius'
export * from './anthropic'
export * from './loop'
```

**packages/inference/src/nebius.ts** — stub:
```ts
export {}
```

**packages/inference/src/anthropic.ts** — stub:
```ts
export {}
```

**packages/inference/src/loop.ts** — stub:
```ts
export {}
```

---

### packages/agentbox

**packages/agentbox/package.json**
```json
{
  "name": "@brickbybrick/agentbox",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc --noEmit",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@brickbybrick/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.3"
  }
}
```

**packages/agentbox/tsconfig.json**
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

**packages/agentbox/src/index.ts** — stub:
```ts
export {}
```

---

### packages/trainer

**packages/trainer/package.json**
```json
{
  "name": "@brickbybrick/trainer",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc --noEmit",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@brickbybrick/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.3"
  }
}
```

**packages/trainer/tsconfig.json**
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

**packages/trainer/src/index.ts** — stub:
```ts
export {}
```

---

### apps/web

**apps/web/package.json**
```json
{
  "name": "web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@brickbybrick/core": "workspace:*",
    "@brickbybrick/agentbox": "workspace:*",
    "@brickbybrick/inference": "workspace:*",
    "@brickbybrick/trainer": "workspace:*",
    "next": "^15.3.4",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "zustand": "^5.0.5",
    "react-diff-viewer-continued": "^3.4.0",
    "recharts": "^2.15.3",
    "react-dropzone": "^14.3.8",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0",
    "lucide-react": "^0.511.0"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "autoprefixer": "^10.4.21",
    "eslint": "^9",
    "eslint-config-next": "^15.3.4",
    "postcss": "^8.5.4",
    "tailwindcss": "^3.4.20",
    "typescript": "^5.7.3"
  }
}
```

**apps/web/next.config.ts**
```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: [
    '@brickbybrick/core',
    '@brickbybrick/agentbox',
    '@brickbybrick/inference',
    '@brickbybrick/trainer',
  ],
}

export default nextConfig
```

**apps/web/tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**apps/web/tailwind.config.ts**
```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0a',
        surface: '#111111',
        border: '#1f1f1f',
        muted: '#6b7280',
        accent: '#ffffff',
        primary: '#3b82f6',
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#ef4444',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
```

**apps/web/postcss.config.js**
```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

**apps/web/app/globals.css**
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #0a0a0a;
}

body {
  background: #0a0a0a;
  color: #ffffff;
}
```

**apps/web/app/layout.tsx**
```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BrickByBrick',
  description: 'Closed-Loop Multi-Agent Data Synthesizer',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-white min-h-screen">
        {children}
      </body>
    </html>
  )
}
```

**apps/web/app/page.tsx** — placeholder:
```tsx
export default function HomePage() {
  return <main><h1>BrickByBrick</h1></main>
}
```

**apps/web/app/ingest/page.tsx** — placeholder:
```tsx
export default function IngestPage() {
  return <main><h1>Ingest</h1></main>
}
```

**apps/web/app/synthesis/page.tsx** — placeholder:
```tsx
export default function SynthesisPage() {
  return <main><h1>Synthesis</h1></main>
}
```

**apps/web/app/training/page.tsx** — placeholder:
```tsx
export default function TrainingPage() {
  return <main><h1>Training</h1></main>
}
```

**apps/web/lib/cn.ts** — shadcn utility:
```ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

## Steps

1. Create all files above exactly as specified
2. Run `pnpm install` from the root
3. Run `pnpm turbo run build` — it must exit 0
4. If build fails, fix all TypeScript errors before stopping
5. Commit everything: `git add -A && git commit -m "chore: scaffold BrickByBrick monorepo"`

## Success Criterion

`pnpm turbo run build` exits 0 with all packages building. The Next.js app compiles. There are no TypeScript errors.
