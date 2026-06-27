import { defineConfig, devices } from '@playwright/test'

const PORT = 3100
const BASE_URL = `http://localhost:${PORT}`

/**
 * E2E config. The dev server runs in BBB_DEMO_MODE so the visual-loop and
 * training routes use their deterministic stub runners (the real loop makes
 * ~14-min live API calls — see docs/RUNBOOK.md for the live rehearsal).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { BBB_DEMO_MODE: '1' },
  },
})
