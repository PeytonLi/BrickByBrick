// apps/web/app/api/intent/expand/route.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST } from './route'

describe('POST /api/intent/expand', () => {
  beforeEach(() => { process.env.BBB_DEMO_MODE = '1' })
  afterEach(() => { delete process.env.BBB_DEMO_MODE })

  it('400s on empty intent', async () => {
    const res = await POST(new Request('http://t/api/intent/expand', {
      method: 'POST', body: JSON.stringify({ intent: '' }),
    }))
    expect(res.status).toBe(400)
  })
  it('returns a deterministic plan in demo mode', async () => {
    const res = await POST(new Request('http://t/api/intent/expand', {
      method: 'POST', body: JSON.stringify({ intent: 'good at react' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.config.intent).toBe('good at react')
    expect(Array.isArray(body.sample_titles)).toBe(true)
    expect(Object.keys(body.config.challenger_weights ?? {}).length).toBeGreaterThan(0)
  })
})
