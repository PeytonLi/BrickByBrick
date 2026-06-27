import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execSync, spawn, type ChildProcess } from 'child_process'
import { Readable } from 'stream'
import {
  provisionPod,
  launchTraining,
  streamMetrics,
  getCheckpoint,
  terminatePod,
} from './prime'

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}))

const mockExecSync = vi.mocked(execSync)
const mockSpawn = vi.mocked(spawn)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('provisionPod', () => {
  it('calls prime pods create with name and returns podId', () => {
    mockExecSync.mockReturnValue('pod-abc123 provisioned')
    const result = provisionPod({ name: 'bbb-lora' })
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('prime pods create'),
      expect.any(Object),
    )
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('--name bbb-lora'),
      expect.any(Object),
    )
    expect(result).toEqual({ podId: 'pod-abc123' })
  })

  it('trims whitespace from podId', () => {
    mockExecSync.mockReturnValue(Buffer.from('  pod-xyz789  \n'))
    const result = provisionPod({ name: 'test' })
    expect(result).toEqual({ podId: 'pod-xyz789' })
  })

  it('accepts gpu_type option', () => {
    mockExecSync.mockReturnValue('pod-gpu')
    provisionPod({ name: 'bbb-lora', gpu_type: 'H100_80GB' })
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('--gpu-type H100_80GB'),
      expect.any(Object),
    )
  })
})

describe('launchTraining', () => {
  it('calls prime train with config path and returns runId', () => {
    mockExecSync.mockReturnValue('run-20260627-001 launched')
    const result = launchTraining('/path/to/train.toml', '/path/to/dataset.jsonl')
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('prime train'),
      expect.any(Object),
    )
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('/path/to/train.toml'),
      expect.any(Object),
    )
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('/path/to/dataset.jsonl'),
      expect.any(Object),
    )
    expect(result).toEqual({ runId: 'run-20260627-001' })
  })
})

describe('streamMetrics', () => {
  function fakeChild(stdoutChunks: string[]): ChildProcess {
    const stdout = new Readable({
      read() {
        for (const chunk of stdoutChunks) this.push(chunk)
        this.push(null)
      },
    })
    const stderr = new Readable({ read() { this.push(null) } })
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    const child = {
      stdout,
      stderr,
      pid: 1234,
      on(event: string, fn: (...args: unknown[]) => void) {
        (listeners[event] ??= []).push(fn)
        return child
      },
    } as unknown as ChildProcess

    setImmediate(() => {
      (listeners['close'] ?? []).forEach((fn) => fn(0))
    })
    return child
  }

  it('parses loss points from stdout NDJSON and calls onPoint', async () => {
    const child = fakeChild([
      '{"step":0,"loss":3.4,"epoch":0}\n',
      '{"step":5,"loss":2.8,"epoch":0}\n',
      '{"step":10,"loss":2.1,"epoch":1}\n',
    ])
    mockSpawn.mockReturnValue(child)

    const points: { step: number; loss: number; epoch: number }[] = []
    await streamMetrics('run-001', (p) => points.push(p))

    expect(mockSpawn).toHaveBeenCalledWith(
      'prime',
      expect.arrayContaining(['train', 'metrics', 'run-001']),
      expect.any(Object),
    )
    expect(points).toHaveLength(3)
    expect(points[0]).toEqual({ step: 0, loss: 3.4, epoch: 0 })
    expect(points[1]).toEqual({ step: 5, loss: 2.8, epoch: 0 })
    expect(points[2]).toEqual({ step: 10, loss: 2.1, epoch: 1 })
  })

  it('skips empty lines', async () => {
    const child = fakeChild([
      '{"step":0,"loss":3.4,"epoch":0}\n\n',
      '\n{"step":5,"loss":2.8,"epoch":0}\n',
    ])
    mockSpawn.mockReturnValue(child)

    const points: { step: number; loss: number; epoch: number }[] = []
    await streamMetrics('run-001', (p) => points.push(p))
    expect(points).toHaveLength(2)
  })

  it('skips malformed JSON lines', async () => {
    const child = fakeChild([
      'garbage line\n',
      '{"step":0,"loss":3.4,"epoch":0}\n',
      'also bad\n',
    ])
    mockSpawn.mockReturnValue(child)

    const points: { step: number; loss: number; epoch: number }[] = []
    await streamMetrics('run-001', (p) => points.push(p))
    expect(points).toHaveLength(1)
    expect(points[0]).toEqual({ step: 0, loss: 3.4, epoch: 0 })
  })

  it('resolves when the child process exits', async () => {
    const child = fakeChild(['{"step":0,"loss":1.0,"epoch":0}\n'])
    mockSpawn.mockReturnValue(child)

    const promise = streamMetrics('run-001', () => {})
    await expect(promise).resolves.toBeUndefined()
  })
})

describe('getCheckpoint', () => {
  it('calls prime train checkpoints and returns path', () => {
    mockExecSync.mockReturnValue('/checkpoints/run-001/checkpoint-50')
    const path = getCheckpoint('run-001')
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('prime train checkpoints run-001'),
      expect.any(Object),
    )
    expect(path).toBe('/checkpoints/run-001/checkpoint-50')
  })
})

describe('terminatePod', () => {
  it('calls prime pods terminate with podId', () => {
    terminatePod('pod-abc123')
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('prime pods terminate pod-abc123'),
      expect.any(Object),
    )
  })

  it('does not throw on normal output', () => {
    mockExecSync.mockReturnValue('pod terminated')
    expect(() => terminatePod('pod-xyz')).not.toThrow()
  })
})
