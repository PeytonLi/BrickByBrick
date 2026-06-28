import { describe, it, expect, afterEach } from 'vitest'
import { resolveTrainingProvider } from '../../src/providers/index'

describe('resolveTrainingProvider', () => {
  const original = process.env.BBB_TRAINING_PROVIDER

  afterEach(() => {
    process.env.BBB_TRAINING_PROVIDER = original
  })

  it('returns prime when BBB_TRAINING_PROVIDER is unset', () => {
    delete process.env.BBB_TRAINING_PROVIDER
    expect(resolveTrainingProvider()).toBe('prime')
  })

  it('returns prime when BBB_TRAINING_PROVIDER=prime', () => {
    process.env.BBB_TRAINING_PROVIDER = 'prime'
    expect(resolveTrainingProvider()).toBe('prime')
  })

  it('returns do-gpu when BBB_TRAINING_PROVIDER=do-gpu', () => {
    process.env.BBB_TRAINING_PROVIDER = 'do-gpu'
    expect(resolveTrainingProvider()).toBe('do-gpu')
  })
})
