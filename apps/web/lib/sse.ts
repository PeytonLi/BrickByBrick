import {
  AgentEventSchema,
  parseSSEData,
  type AgentEvent,
} from "@brickbybrick/core";

type MessageLike = MessageEvent<string> | { data: string };

export function decodeAgentEventMessage(message: string): AgentEvent {
  const trimmed = message.trimStart();
  // Skip SSE comments (lines starting with ':') and empty frames
  if (!trimmed || trimmed.startsWith(":")) {
    throw new Error("SSE comment or empty frame — skipped");
  }
  const payload = trimmed.startsWith("data:")
    ? parseSSEData(trimmed)
    : JSON.parse(trimmed);

  return AgentEventSchema.parse(payload);
}

export function createAgentEventHandler(
  consumeEvent: (event: AgentEvent) => void,
  onError?: (error: unknown) => void,
) {
  return (message: MessageLike) => {
    try {
      consumeEvent(decodeAgentEventMessage(message.data));
    } catch (error) {
      onError?.(error);
    }
  };
}

export function splitSSEFrames(buffer: string): {
  frames: string[];
  rest: string;
} {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  return {
    frames: parts.filter(Boolean),
    rest,
  };
}
