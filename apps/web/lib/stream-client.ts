"use client";

import type { AgentEvent } from "@brickbybrick/core";

import { decodeAgentEventMessage, splitSSEFrames } from "./sse";

export interface StreamAgentEventsOptions {
  url: string;
  init?: RequestInit;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}

export async function streamAgentEvents({
  url,
  init,
  signal,
  onEvent,
}: StreamAgentEventsOptions): Promise<void> {
  const response = await fetch(url, {
    ...init,
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Stream request failed with ${response.status}`);
  }

  if (!response.body) {
    throw new Error("Stream response did not include a body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const { frames, rest } = splitSSEFrames(buffer);
    buffer = rest;

    for (const frame of frames) {
      try {
        onEvent(decodeAgentEventMessage(frame));
      } catch {
        // Skip heartbeat comments, malformed frames, etc.
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    onEvent(decodeAgentEventMessage(buffer));
  }
}
