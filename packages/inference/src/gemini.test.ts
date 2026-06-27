import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VisualTask, Defect } from '@brickbybrick/core'
import { withRetry, generateContent, embed, weakSolver, strongSolver } from './gemini'

const noSleep = () => Promise.resolve()

const task: VisualTask = {
  id: 'responsive-grid',
  prompt: 'Build a responsive product card grid.',
  target_mechanism: 'responsive-card-grid',
  criteria: [{ id: 'no-overflow', description: 'no overflow at 375px', weight: 1 }],
}

const defect: Defect = {
  screenshot: 'BASE64PNG',
  dom_trace: '<div class="grid" style="width:1200px">…overflow…</div>',
  category: 'overflow',
  severity: 'high',
}

function okText(text: string) {
  return vi.fn(async (..._args: unknown[]) => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    text: async () => '',
  }))
}

describe('withRetry — exponential backoff', () => {
  it('returns immediately on first success without sleeping', async () => {
    let attempts = 0
    const sleep = vi.fn(noSleep)
    const result = await withRetry(
      async () => {
        attempts++
        return 'ok'
      },
      { sleep },
    )
    expect(result).toBe('ok')
    expect(attempts).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries then succeeds, counting attempts', async () => {
    let attempts = 0
    const result = await withRetry(
      async () => {
        attempts++
        if (attempts < 3) throw new Error('transient')
        return 'recovered'
      },
      { retries: 5, baseDelayMs: 10, sleep: noSleep },
    )
    expect(result).toBe('recovered')
    expect(attempts).toBe(3)
  })

  it('throws the last error after exhausting retries', async () => {
    let attempts = 0
    await expect(
      withRetry(
        async () => {
          attempts++
          throw new Error(`fail-${attempts}`)
        },
        { retries: 2, baseDelayMs: 10, sleep: noSleep },
      ),
    ).rejects.toThrow('fail-3')
    expect(attempts).toBe(3) // initial + 2 retries
  })

  it('backs off exponentially between attempts', async () => {
    const delays: number[] = []
    const sleep = (ms: number) => {
      delays.push(ms)
      return Promise.resolve()
    }
    await withRetry(
      async () => {
        throw new Error('always')
      },
      { retries: 3, baseDelayMs: 100, sleep },
    ).catch(() => {})
    expect(delays.length).toBe(3)
    // base·2^i ≤ delay < base·2^i + jitterCeiling(500). Jitter breaks strict
    // monotonicity, but the exponential floor and ceiling must hold per attempt.
    expect(delays[0]).toBeGreaterThanOrEqual(100)
    expect(delays[0]).toBeLessThan(600)
    expect(delays[1]).toBeGreaterThanOrEqual(200)
    expect(delays[1]).toBeLessThan(700)
    expect(delays[2]).toBeGreaterThanOrEqual(400)
    expect(delays[2]).toBeLessThan(900)
  })
})

describe('generateContent — Gemini generateContent REST', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts to the model endpoint with the api key and parses the text', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'hello world' }] } }],
      }),
      text: async () => '',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await generateContent('gemini-3.5-pro', 'sys', 'user', { sleep: noSleep })

    expect(out).toBe('hello world')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/v1beta/models/gemini-3.5-pro:generateContent')
    expect((init as any).headers['x-goog-api-key']).toBe('test-key')
    const body = JSON.parse((init as any).body)
    expect(body.systemInstruction.parts[0].text).toBe('sys')
    expect(body.contents[0].parts[0].text).toBe('user')
  })

  it('throws (then retries) on a non-ok response', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => 'overloaded',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateContent('gemini-3.5-pro', 's', 'u', { retries: 1, baseDelayMs: 1, sleep: noSleep }),
    ).rejects.toThrow(/503/)
    expect(fetchMock).toHaveBeenCalledTimes(2) // initial + 1 retry
  })
})

describe('embed — Gemini embedContent', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the embedding vector', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({
      ok: true,
      status: 200,
      json: async () => ({ embedding: { values: [0.1, 0.2, 0.3] } }),
      text: async () => '',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const v = await embed('a failure description', { sleep: noSleep })
    expect(v).toEqual([0.1, 0.2, 0.3])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain(':embedContent')
  })
})

describe('weakSolver — Gemma 4 (the target model)', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
  })
  afterEach(() => vi.unstubAllGlobals())

  it('uses the weak model, includes the task, and strips code fences', async () => {
    const fetchMock = okText('```jsx\nconst Grid = () => <div/>\n```')
    vi.stubGlobal('fetch', fetchMock)

    const code = await weakSolver(task, { sleep: noSleep })

    expect(code).toBe('const Grid = () => <div/>')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/models/gemma-4-26b-a4b-it:generateContent')
    const body = JSON.parse((init as any).body)
    expect(body.contents[0].parts[0].text).toContain('responsive product card grid')
  })
})

describe('strongSolver — Gemini 3.5 Pro (the fix)', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
  })
  afterEach(() => vi.unstubAllGlobals())

  it('uses the strong model and includes the task + defect in the prompt', async () => {
    const fetchMock = okText('const Grid = () => <div className="fixed"/>')
    vi.stubGlobal('fetch', fetchMock)

    const code = await strongSolver(task, defect, undefined, { sleep: noSleep })

    expect(code).toContain('fixed')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/models/gemini-3.1-pro-preview:generateContent')
    const body = JSON.parse((init as any).body)
    const userText = body.contents[0].parts[0].text
    expect(userText).toContain('overflow') // defect category
    expect(userText).toContain('responsive product card grid') // task
  })

  it('includes the weak implementation when one is supplied', async () => {
    const fetchMock = okText('fixed code')
    vi.stubGlobal('fetch', fetchMock)

    await strongSolver(task, defect, 'const Weak = () => <broken/>', { sleep: noSleep })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body.contents[0].parts[0].text).toContain('const Weak = () => <broken/>')
  })
})
