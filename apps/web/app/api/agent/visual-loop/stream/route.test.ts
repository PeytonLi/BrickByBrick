import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEvent, GenerationConfig } from "@brickbybrick/core";

const bridge = vi.hoisted(() => ({
  close: vi.fn(() => Promise.resolve()),
  enqueue: vi.fn(),
  onError: undefined as ((message: string) => void) | undefined,
}));

vi.mock("@/lib/server/narration-bridge", () => ({
  createGeminiLiveNarrationBridge: vi.fn(
    (options: { onError?: (message: string) => void }) => {
      bridge.onError = options.onError;
      return {
        close: bridge.close,
        enqueue: bridge.enqueue,
      };
    },
  ),
  createNoopNarrationBridge: vi.fn(() => ({
    close: vi.fn(() => Promise.resolve()),
    enqueue: vi.fn(),
  })),
}));

// Keep the test hermetic: never touch a real MongoDB (the route calls connectDB
// at stream start). Without this, a populated MONGODB_ATLAS_URI in .env.local
// makes connectDB attempt a real connection and hang past the test timeout.
vi.mock("@brickbybrick/db", () => ({
  connectDB: vi.fn(() => Promise.resolve()),
  RunModel: {
    create: vi.fn(() => Promise.resolve()),
    updateOne: vi.fn(() => Promise.resolve()),
  },
  PairModel: { create: vi.fn(() => Promise.resolve()) },
  EventModel: { insertBatch: vi.fn(() => Promise.resolve()) },
}));

vi.mock("@brickbybrick/inference", () => ({
  runVisualLoop: async (
    _config: GenerationConfig,
    emit: (event: AgentEvent) => void,
  ) => {
    emit({ type: "narration", text: "Auditing the draft." });
    bridge.onError?.("Narration audio failed: test failure");
    emit({ type: "audit_pass" });
  },
}));

async function responseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

describe("/api/agent/visual-loop/stream", () => {
  beforeEach(() => {
    process.env.BBB_DEMO_MODE = "0";
    vi.stubGlobal("process", { ...process, platform: "linux" });
    bridge.close.mockClear();
    bridge.enqueue.mockClear();
    bridge.onError = undefined;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards narration events to the audio bridge while preserving SSE output", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/agent/visual-loop/stream", {
        method: "POST",
        body: JSON.stringify({ config: { max_pairs: 1 } }),
      }),
    );

    const body = await responseText(response);

    expect(response.status).toBe(200);
    expect(body).toContain('"type":"narration","text":"Auditing the draft."');
    expect(body).toContain(
      '"type":"narration","text":"Narration audio failed: test failure"',
    );
    expect(body).toContain('"type":"audit_pass"');
    expect(bridge.enqueue).toHaveBeenCalledTimes(1);
    expect(bridge.enqueue).toHaveBeenCalledWith("Auditing the draft.");
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });
});
