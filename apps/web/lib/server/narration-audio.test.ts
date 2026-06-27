import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  Pcm16FrameSplitter,
  decodeBase64Pcm16,
  extractGeminiLiveAudio,
} from './narration-audio'

function pcmBytes(samples: Int16Array): Uint8Array {
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
}

describe('narration audio helpers', () => {
  it('extracts only audio inlineData chunks from Gemini Live messages', () => {
    const chunks = extractGeminiLiveAudio({
      serverContent: {
        modelTurn: {
          parts: [
            { inlineData: { data: 'audio-a', mimeType: 'audio/pcm;rate=24000' } },
            { inlineData: { data: 'image-a', mimeType: 'image/png' } },
            { inlineData: { data: 'audio-b' } },
          ],
        },
      },
    })

    expect(chunks).toEqual(['audio-a', 'audio-b'])
  })

  it('decodes base64 PCM bytes without altering sample data', () => {
    const samples = new Int16Array([1, -2, 32767, -32768])
    const decoded = decodeBase64Pcm16(Buffer.from(samples.buffer).toString('base64'))

    expect(Array.from(new Int16Array(decoded.buffer))).toEqual(Array.from(samples))
  })

  it('splits arbitrary PCM chunks into 10ms frames and flushes the short tail', () => {
    const splitter = new Pcm16FrameSplitter(1000, 1, 10)
    const samples = new Int16Array(Array.from({ length: 25 }, (_, index) => index))
    const bytes = pcmBytes(samples)

    expect(splitter.push(bytes.subarray(0, 15))).toEqual([])

    const frames = splitter.push(bytes.subarray(15))
    const tail = splitter.flush()

    expect(frames).toHaveLength(2)
    expect(frames[0].samplesPerChannel).toBe(10)
    expect(frames[1].samplesPerChannel).toBe(10)
    expect(Array.from(tail[0].data)).toEqual([20, 21, 22, 23, 24])
  })

  it('does not pad odd trailing bytes into noise', () => {
    const splitter = new Pcm16FrameSplitter(1000, 1, 10)
    const frames = splitter.push(new Uint8Array([1, 0, 255]))
    const tail = splitter.flush()

    expect(frames).toEqual([])
    expect(tail).toHaveLength(1)
    expect(Array.from(tail[0].data)).toEqual([1])
  })
})
