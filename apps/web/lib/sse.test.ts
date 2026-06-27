import { describe, expect, it, vi } from 'vitest'

import { createAgentEventHandler, decodeAgentEventMessage, splitSSEFrames } from './sse'

describe('SSE AgentEvent decoding', () => {
  it('decodes JSON EventSource payloads through the frozen schema', () => {
    const event = decodeAgentEventMessage(
      JSON.stringify({ type: 'narration', text: 'Visual audit is live.' }),
    )

    expect(event).toEqual({ type: 'narration', text: 'Visual audit is live.' })
  })

  it('decodes data-prefixed SSE frames', () => {
    const event = decodeAgentEventMessage('data: {"type":"audit_pass"}')

    expect(event).toEqual({ type: 'audit_pass' })
  })

  it('surfaces invalid payloads to the handler error callback', () => {
    const consume = vi.fn()
    const onError = vi.fn()
    const handler = createAgentEventHandler(consume, onError)

    handler({ data: '{"type":"unknown"}' })

    expect(consume).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
  })

  it('splits streaming SSE frames and keeps incomplete data buffered', () => {
    const { frames, rest } = splitSSEFrames(
      'data: {"type":"audit_pass"}\n\ndata: {"type":"narration","text":"partial"',
    )

    expect(frames).toEqual(['data: {"type":"audit_pass"}'])
    expect(rest).toBe('data: {"type":"narration","text":"partial"')
  })
})
