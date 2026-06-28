import { describe, expect, it, vi } from 'vitest'
import { createFallbackSolverSet, type SolverSet, type FallbackOptions } from '../../src/providers/fallback'

function mockSolver(values?: Partial<Pick<SolverSet, 'generate' | 'embed'>>): SolverSet {
  return {
    strongModel: 'mock-strong',
    weakModel: 'mock-weak',
    generate: vi.fn(async (_m, _s, _u) => 'primary-result'),
    embed: vi.fn(async (_text) => [0.1, 0.2, 0.3]),
    ...values,
  } as SolverSet
}

describe('createFallbackSolverSet', () => {
  it('uses primary when it succeeds', async () => {
    const primary = mockSolver()
    const fallback = mockSolver()
    const solver = createFallbackSolverSet(primary, fallback)

    const result = await solver.generate('model', 'system', 'user')
    expect(result).toBe('primary-result')
    expect(primary.generate).toHaveBeenCalledWith('model', 'system', 'user')
    expect(fallback.generate).not.toHaveBeenCalled()
  })

  it('falls back on 429 status', async () => {
    const primary = mockSolver({
      generate: vi.fn(async () => { throw new Error('429 Too Many Requests') }),
    })
    const fallback = mockSolver({
      generate: vi.fn(async () => 'fallback-result'),
    })
    const onFallback = vi.fn()
    const solver = createFallbackSolverSet(primary, fallback, { onFallback })

    const result = await solver.generate('model', 'system', 'user')
    expect(result).toBe('fallback-result')
    expect(primary.generate).toHaveBeenCalled()
    expect(fallback.generate).toHaveBeenCalled()
    expect(onFallback).toHaveBeenCalledWith('generate', expect.any(Error))
  })

  it('falls back on 500 status', async () => {
    const primary = mockSolver({
      generate: vi.fn(async () => { throw new Error('Internal Server Error 500') }),
    })
    const fallback = mockSolver({
      generate: vi.fn(async () => 'fallback-result'),
    })
    const solver = createFallbackSolverSet(primary, fallback)

    const result = await solver.generate('model', 'system', 'user')
    expect(result).toBe('fallback-result')
    expect(fallback.generate).toHaveBeenCalled()
  })

  it('falls back on 502 status', async () => {
    const primary = mockSolver({
      generate: vi.fn(async () => { throw new Error('502 Bad Gateway') }),
    })
    const fallback = mockSolver({
      generate: vi.fn(async () => 'fallback-result'),
    })
    const solver = createFallbackSolverSet(primary, fallback)

    const result = await solver.generate('model', 'system', 'user')
    expect(result).toBe('fallback-result')
  })

  it('falls back on 503 status', async () => {
    const primary = mockSolver({
      generate: vi.fn(async () => { throw new Error('503 Service Unavailable') }),
    })
    const fallback = mockSolver({
      generate: vi.fn(async () => 'fallback-result'),
    })
    const solver = createFallbackSolverSet(primary, fallback)

    const result = await solver.generate('model', 'system', 'user')
    expect(result).toBe('fallback-result')
  })

  it('falls back on 504 status', async () => {
    const primary = mockSolver({
      generate: vi.fn(async () => { throw new Error('504 Gateway Timeout') }),
    })
    const fallback = mockSolver({
      generate: vi.fn(async () => 'fallback-result'),
    })
    const solver = createFallbackSolverSet(primary, fallback)

    const result = await solver.generate('model', 'system', 'user')
    expect(result).toBe('fallback-result')
  })

  it('does NOT fall back on non-retriable errors (e.g. 401)', async () => {
    const primary = mockSolver({
      generate: vi.fn(async () => { throw new Error('401 Unauthorized') }),
    })
    const fallback = mockSolver({
      generate: vi.fn(async () => 'fallback-result'),
    })
    const solver = createFallbackSolverSet(primary, fallback)

    await expect(solver.generate('model', 'system', 'user')).rejects.toThrow('401 Unauthorized')
    expect(fallback.generate).not.toHaveBeenCalled()
  })

  it('propagates error when both primary and fallback fail', async () => {
    const primary = mockSolver({
      generate: vi.fn(async () => { throw new Error('429 Too Many Requests') }),
    })
    const fallback = mockSolver({
      generate: vi.fn(async () => { throw new Error('500 fallback also dead') }),
    })
    const solver = createFallbackSolverSet(primary, fallback)

    await expect(solver.generate('model', 'system', 'user')).rejects.toThrow('500 fallback also dead')
    expect(primary.generate).toHaveBeenCalled()
    expect(fallback.generate).toHaveBeenCalled()
  })

  it('fallback works for embed too', async () => {
    const primary = mockSolver({
      embed: vi.fn(async () => { throw new Error('503 Service Unavailable') }),
    })
    const fallback = mockSolver({
      embed: vi.fn(async () => [0.4, 0.5, 0.6]),
    })
    const solver = createFallbackSolverSet(primary, fallback)

    const result = await solver.embed('test text')
    expect(result).toEqual([0.4, 0.5, 0.6])
    expect(primary.embed).toHaveBeenCalledWith('test text')
    expect(fallback.embed).toHaveBeenCalledWith('test text')
  })

  it('onFallback callback is called on switch', async () => {
    const primary = mockSolver({
      generate: vi.fn(async () => { throw new Error('429 Too Many Requests') }),
    })
    const fallback = mockSolver({
      generate: vi.fn(async () => 'fallback-result'),
    })
    const onFallback = vi.fn()
    const solver = createFallbackSolverSet(primary, fallback, { onFallback })

    await solver.generate('model', 'system', 'user')
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(onFallback).toHaveBeenCalledWith('generate', expect.objectContaining({ message: '429 Too Many Requests' }))
  })

  it('onFallback is not called when primary succeeds', async () => {
    const primary = mockSolver()
    const fallback = mockSolver()
    const onFallback = vi.fn()
    const solver = createFallbackSolverSet(primary, fallback, { onFallback })

    await solver.generate('model', 'system', 'user')
    expect(onFallback).not.toHaveBeenCalled()
  })

  it('uses custom retryOn codes', async () => {
    const primary = mockSolver({
      generate: vi.fn(async () => { throw new Error('418 I am a teapot') }),
    })
    const fallback = mockSolver({
      generate: vi.fn(async () => 'fallback-result'),
    })
    const solver = createFallbackSolverSet(primary, fallback, { retryOn: [418] })

    const result = await solver.generate('model', 'system', 'user')
    expect(result).toBe('fallback-result')
  })

  it('uses primary model names for strongModel/weakModel', () => {
    const primary = mockSolver()
    const fallback = mockSolver()
    const solver = createFallbackSolverSet(primary, fallback)

    expect(solver.strongModel).toBe('mock-strong')
    expect(solver.weakModel).toBe('mock-weak')
  })
})
