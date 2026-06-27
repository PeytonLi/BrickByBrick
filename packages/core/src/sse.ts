import type { AgentEvent } from './schemas'

/**
 * Server-Sent-Events helpers shared by the web API routes and any SSE client.
 * The engine emits AgentEvents; routes serialize them with formatSSE.
 */

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
} as const

/** Serialize one AgentEvent as an SSE `data:` frame. */
export function formatSSE(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/** Parse a single SSE `data:` line back into a raw object (unvalidated). */
export function parseSSEData(line: string): unknown {
  const trimmed = line.replace(/^data:\s?/, '')
  return JSON.parse(trimmed)
}
