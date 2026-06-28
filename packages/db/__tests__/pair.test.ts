import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { PairModel } from '../src/models/pair'

let mongoServer: MongoMemoryServer

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  const uri = mongoServer.getUri()
  await mongoose.connect(uri, { dbName: 'test' })
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

const sampleTask = {
  id: 'task-1',
  prompt: 'Create a responsive grid',
  target_mechanism: 'responsive-grid',
  criteria: [{ id: 'c1', description: 'Columns resize', weight: 0.5 }],
}

const sampleDefect = {
  screenshot: 'base64png',
  dom_trace: 'stack',
  category: 'layout_collision',
  severity: 'high',
}

describe('PairModel', () => {
  it('creates a pair and queries by runId', async () => {
    await PairModel.create({
      pairId: 'pair-001',
      runId: 'run-a',
      task: sampleTask,
      weak_code: 'console.log("weak")',
      defect: sampleDefect,
      strong_code: 'console.log("strong")',
      u_score: 0.85,
    })

    await PairModel.create({
      pairId: 'pair-002',
      runId: 'run-a',
      task: sampleTask,
      weak_code: 'w2',
      defect: sampleDefect,
      strong_code: 's2',
      u_score: 0.9,
    })

    await PairModel.create({
      pairId: 'pair-003',
      runId: 'run-b',
      task: sampleTask,
      weak_code: 'w3',
      defect: sampleDefect,
      strong_code: 's3',
      u_score: 0.5,
    })

    const runAPairs = await PairModel.byRun('run-a')
    expect(runAPairs).toHaveLength(2)
    expect(runAPairs.map((p) => p.pairId).sort()).toEqual(['pair-001', 'pair-002'])
  })

  it('queries by mechanism', async () => {
    // Isolate from pairs created by earlier tests (which share this mechanism).
    await PairModel.deleteMany({})

    await PairModel.create({
      pairId: 'pair-mech-1',
      runId: 'run-mech',
      task: {
        id: 'task-grid',
        prompt: 'grid',
        target_mechanism: 'responsive-grid',
        criteria: [],
      },
      weak_code: 'w',
      defect: sampleDefect,
      strong_code: 's',
      u_score: 0.7,
    })

    await PairModel.create({
      pairId: 'pair-mech-2',
      runId: 'run-mech',
      task: {
        id: 'task-modal',
        prompt: 'modal',
        target_mechanism: 'modal-focus-trap',
        criteria: [],
      },
      weak_code: 'w',
      defect: sampleDefect,
      strong_code: 's',
      u_score: 0.8,
    })

    const gridPairs = await PairModel.byMechanism('responsive-grid')
    expect(gridPairs).toHaveLength(1)
    expect(gridPairs[0].pairId).toBe('pair-mech-1')
  })

  it('PairModel.recent() returns most recent pairs', async () => {
    const pairs = await PairModel.recent(5)
    expect(pairs.length).toBeGreaterThanOrEqual(1)
    // Sorted by createdAt desc
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        pairs[i].createdAt.getTime(),
      )
    }
  })

  it('queries by u_score range', async () => {
    const highScore = await PairModel.find({ u_score: { $gte: 0.8 } })
    expect(highScore.length).toBeGreaterThanOrEqual(1)
    for (const p of highScore) {
      expect(p.u_score).toBeGreaterThanOrEqual(0.8)
    }
  })
})
