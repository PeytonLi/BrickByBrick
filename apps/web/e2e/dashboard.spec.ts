import { test, expect } from '@playwright/test'

/**
 * The integration happy path (D-INTEGRATION §3): load the dashboard, run the
 * visual loop until a pair is committed (Section B / adversarial matrix), then
 * stream training and assert the loss curve renders with real streamed data
 * (Section C / weight-compute console). Runs against BBB_DEMO_MODE stubs so it
 * is deterministic and fast.
 */
test('visual loop commits a pair, then training streams a loss curve', async ({ page }) => {
  await page.goto('/')

  const matrix = page.getByTestId('adversarial-matrix')
  const trainingConsole = page.getByTestId('weight-compute-console')
  await expect(matrix).toBeVisible()
  await expect(trainingConsole).toBeVisible()

  // --- Section B: run the loop, expect a committed pair --------------------
  await page.getByRole('button', { name: /Run loop/i }).click()

  // The stub commits exactly one pair with U gap 0.71.
  await expect(matrix.getByText('Latest accepted pair is locked.')).toBeVisible({
    timeout: 30_000,
  })
  await expect(matrix.getByText('0.71').first()).toBeVisible()

  // --- Section C: stream training, expect the loss curve + final loss ------
  await page.getByRole('button', { name: /Stream metrics/i }).click()

  // The stub's final streamed loss is 1.14 -> rendered as "1.140".
  await expect(trainingConsole.getByText('1.140')).toBeVisible({ timeout: 30_000 })
  // The recharts loss line is rendered.
  await expect(trainingConsole.locator('.recharts-line-curve').first()).toBeVisible()
})

/**
 * Run history API (E-INTEGRATION §7): GET /api/runs returns persisted runs.
 * With no Atlas configured (CI/demo) the route returns an empty array; with a
 * live MONGODB_ATLAS_URI it returns the most recent runs. Either way: 200 + array.
 */
test('GET /api/runs returns a JSON array of runs', async ({ request }) => {
  const res = await request.get('/api/runs')
  expect(res.status()).toBe(200)
  const data = await res.json()
  expect(Array.isArray(data)).toBe(true)
})
