import { Buffer } from 'node:buffer'

export interface PcmAudioFrame {
  data: Int16Array
  sampleRate: number
  channels: number
  samplesPerChannel: number
}

export interface InlineAudioPart {
  inlineData?: {
    data?: string
    mimeType?: string
  }
}

export interface GeminiLiveAudioMessage {
  serverContent?: {
    modelTurn?: {
      parts?: InlineAudioPart[]
    }
    turnComplete?: boolean
  }
}

export const DEFAULT_GEMINI_LIVE_SAMPLE_RATE = 24_000
export const DEFAULT_AUDIO_CHANNELS = 1
export const DEFAULT_FRAME_DURATION_MS = 10

function combineBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  if (first.byteLength === 0) return second
  if (second.byteLength === 0) return first

  const combined = new Uint8Array(first.byteLength + second.byteLength)
  combined.set(first, 0)
  combined.set(second, first.byteLength)
  return combined
}

function toInt16(bytes: Uint8Array): Int16Array {
  const aligned = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Int16Array(aligned)
}

export function decodeBase64Pcm16(data: string): Uint8Array {
  return Uint8Array.from(Buffer.from(data, 'base64'))
}

export function extractGeminiLiveAudio(message: GeminiLiveAudioMessage): string[] {
  const parts = message.serverContent?.modelTurn?.parts ?? []

  return parts
    .map((part) => part.inlineData)
    .filter((inlineData): inlineData is { data: string; mimeType?: string } => {
      if (!inlineData?.data) return false
      return !inlineData.mimeType || inlineData.mimeType.startsWith('audio/')
    })
    .map((inlineData) => inlineData.data)
}

export class Pcm16FrameSplitter {
  private remainder = new Uint8Array()
  private readonly bytesPerFrame: number

  constructor(
    private readonly sampleRate = DEFAULT_GEMINI_LIVE_SAMPLE_RATE,
    private readonly channels = DEFAULT_AUDIO_CHANNELS,
    frameDurationMs = DEFAULT_FRAME_DURATION_MS,
  ) {
    const samplesPerChannel = Math.round((sampleRate * frameDurationMs) / 1000)
    this.bytesPerFrame = samplesPerChannel * channels * Int16Array.BYTES_PER_ELEMENT
  }

  push(bytes: Uint8Array): PcmAudioFrame[] {
    const input = combineBytes(this.remainder, bytes)
    const wholeFrameBytes = Math.floor(input.byteLength / this.bytesPerFrame) * this.bytesPerFrame
    const frames: PcmAudioFrame[] = []

    for (let offset = 0; offset < wholeFrameBytes; offset += this.bytesPerFrame) {
      frames.push(this.toFrame(input.subarray(offset, offset + this.bytesPerFrame)))
    }

    this.remainder = Uint8Array.from(input.subarray(wholeFrameBytes))
    return frames
  }

  flush(): PcmAudioFrame[] {
    const evenByteLength =
      Math.floor(this.remainder.byteLength / Int16Array.BYTES_PER_ELEMENT) *
      Int16Array.BYTES_PER_ELEMENT

    if (evenByteLength === 0) {
      this.remainder = new Uint8Array()
      return []
    }

    const finalFrame = this.toFrame(this.remainder.subarray(0, evenByteLength))
    this.remainder = new Uint8Array()
    return [finalFrame]
  }

  private toFrame(bytes: Uint8Array): PcmAudioFrame {
    const data = toInt16(bytes)

    return {
      data,
      sampleRate: this.sampleRate,
      channels: this.channels,
      samplesPerChannel: data.length / this.channels,
    }
  }
}
