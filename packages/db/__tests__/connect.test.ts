import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { connectDB, disconnectDB } from '../src/connect'

const ORIGINAL_URI = process.env.MONGODB_ATLAS_URI

function clearGlobal() {
  delete (globalThis as Record<string, unknown>).__bbbMongoose
}

describe('connectDB', () => {
  beforeEach(() => {
    delete process.env.MONGODB_ATLAS_URI
    clearGlobal()
  })

  afterEach(() => {
    process.env.MONGODB_ATLAS_URI = ORIGINAL_URI
    clearGlobal()
  })

  it('throws when MONGODB_ATLAS_URI is not set', () => {
    expect(() => connectDB()).toThrow('MONGODB_ATLAS_URI is not set')
  })

  it('returns the same promise on multiple calls (singleton)', () => {
    process.env.MONGODB_ATLAS_URI = 'mongodb://localhost:27017/test'
    const p1 = connectDB()
    const p2 = connectDB()
    expect(p1).toBe(p2)
    delete process.env.MONGODB_ATLAS_URI
  })
})

describe('disconnectDB', () => {
  beforeEach(() => {
    clearGlobal()
  })

  it('clears the global after disconnect', async () => {
    // Set up a mock promise that resolves with a mock mongoose instance
    const mockDisconnect = async () => {}
    const mockMongoose = { disconnect: mockDisconnect }
    ;(globalThis as Record<string, unknown>).__bbbMongoose = Promise.resolve(mockMongoose)

    await disconnectDB()
    expect((globalThis as Record<string, unknown>).__bbbMongoose).toBeUndefined()
  })

  it('does nothing when no connection exists', async () => {
    await expect(disconnectDB()).resolves.toBeUndefined()
  })
})
