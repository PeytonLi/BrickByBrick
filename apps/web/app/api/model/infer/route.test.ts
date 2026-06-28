// apps/web/app/api/model/infer/route.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST } from './route'

describe('POST /api/model/infer', () => {
  beforeEach(() => { process.env.BBB_DEMO_MODE = '1' })
  afterEach(() => { delete process.env.BBB_DEMO_MODE })

  it('400s without prompt', async () => {
    const res = await POST(new Request('http://t', { method: 'POST', body: JSON.stringify({ runId: 'r' }) }))
    expect(res.status).toBe(400)
  })
  it('returns demo code', async () => {
    const res = await POST(new Request('http://t', { method: 'POST', body: JSON.stringify({ runId: 'r', prompt: 'build', model: 'tuned' }) }))
    expect(res.status).toBe(200)
    expect((await res.json()).code).toContain('tuned')
  })
})
