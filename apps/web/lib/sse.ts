import { AgentEventSchema, parseSSEData, type AgentEvent } from '@brickbybrick/core'

type MessageLike = MessageEvent<string> | { data: string }

export function decodeAgentEventMessage(message: string): AgentEvent {
  const payload = message.trimStart().startsWith('data:')
    ? parseSSEData(message)
    : JSON.parse(message)

  return AgentEventSchema.parse(payload)
}

export function createAgentEventHandler(
  consumeEvent: (event: AgentEvent) => void,
  onError?: (error: unknown) => void,
) {
  return (message: MessageLike) => {
    try {
      consumeEvent(decodeAgentEventMessage(message.data))
    } catch (error) {
      onError?.(error)
    }
  }
}

export function splitSSEFrames(buffer: string): {
  frames: string[]
  rest: string
} {
  const parts = buffer.split(/\r?\n\r?\n/)
  const rest = parts.pop() ?? ''
  return {
    frames: parts.filter(Boolean),
    rest,
  }
}
