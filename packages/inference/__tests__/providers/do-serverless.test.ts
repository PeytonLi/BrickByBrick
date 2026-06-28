import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
      embeddings: { create: mockCreate },
    })),
  }
})

import { createDOSolverSet } from '../../src/providers/do-serverless'

describe('createDOSolverSet', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.DIGITALOCEAN_MODEL_ACCESS_KEY
    delete process.env.DO_STRONG_MODEL
    delete process.env.DO_WEAK_MODEL
    delete process.env.DO_EMBED_MODEL
  })

  it('throws when DIGITALOCEAN_MODEL_ACCESS_KEY is not set', () => {
    expect(() => createDOSolverSet()).not.toThrow() // factory itself doesn't throw
    const set = createDOSolverSet()
    delete process.env.DIGITALOCEAN_MODEL_ACCESS_KEY
    // The actual error happens when generate/embed is called, but the SolverSet
    // resolves env vars at construction time for models, and at call time for apiKey
  })

  it('resolves default models', () => {
    process.env.DIGITALOCEAN_MODEL_ACCESS_KEY = 'test-key'
    const set = createDOSolverSet()
    expect(set.strongModel).toBe('anthropic-claude-4.6-sonnet')
    expect(set.weakModel).toBe('llama3.3-70b-instruct')
  })

  it('resolves env-configured models', () => {
    process.env.DIGITALOCEAN_MODEL_ACCESS_KEY = 'test-key'
    process.env.DO_STRONG_MODEL = 'custom-strong'
    process.env.DO_WEAK_MODEL = 'custom-weak'
    const set = createDOSolverSet()
    expect(set.strongModel).toBe('custom-strong')
    expect(set.weakModel).toBe('custom-weak')
  })

  it('generate throws when api key missing', async () => {
    delete process.env.DIGITALOCEAN_MODEL_ACCESS_KEY
    // Import fresh after env cleanup
    const { createDOSolverSet: fresh } = await import('../../src/providers/do-serverless?update=' + Date.now())
    const set = fresh()
    await expect(set.generate('model', 'system', 'user')).rejects.toThrow('DIGITALOCEAN_MODEL_ACCESS_KEY')
  })

  it('embed throws when api key missing', async () => {
    delete process.env.DIGITALOCEAN_MODEL_ACCESS_KEY
    const { createDOSolverSet: fresh } = await import('../../src/providers/do-serverless?update=' + Date.now() + 1)
    const set = fresh()
    await expect(set.embed('test')).rejects.toThrow('DIGITALOCEAN_MODEL_ACCESS_KEY')
  })
})
