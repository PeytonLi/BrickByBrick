import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['{app,components,lib}/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'e2e'],
    passWithNoTests: true,
  },
})
