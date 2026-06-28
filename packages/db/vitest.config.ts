import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    // MongoMemoryServer spins up a real mongod; the first run also downloads the
    // binary into the cache. Give the lifecycle hooks generous headroom.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
})
