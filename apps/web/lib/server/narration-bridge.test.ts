import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import {
  createGeminiLiveNarrationBridge,
  type NarrationBridgeOptions,
} from "./narration-bridge";
import type { PcmAudioFrame } from "./narration-audio";

function sampleChunk(length: number): string {
  const samples = new Int16Array(
    Array.from({ length }, (_, index) => index + 1),
  );
  return Buffer.from(samples.buffer).toString("base64");
}

function fakeOptions(overrides: Partial<NarrationBridgeOptions> = {}) {
  const published: PcmAudioFrame[] = [];
  const sent: string[] = [];
  const closed = {
    gemini: false,
    livekit: false,
  };

  const options: NarrationBridgeOptions = {
    room: "room-test",
    identity: "narrator-test",
    sampleRate: 1000,
    channels: 1,
    turnTimeoutMs: 100,
    createPublisher: async () => ({
      async publishFrame(frame) {
        published.push(frame);
      },
      async close() {
        closed.livekit = true;
      },
    }),
    connectGemini: async (callbacks) => ({
      sendNarration(text) {
        sent.push(text);
        callbacks.onAudio(sampleChunk(10));
        callbacks.onTurnComplete();
      },
      sendAudio() {},
      close() {
        closed.gemini = true;
      },
    }),
    ...overrides,
  };

  return { closed, options, published, sent };
}

describe("createGeminiLiveNarrationBridge", () => {
  it("serializes narration text into Gemini and publishes returned PCM frames", async () => {
    const { closed, options, published, sent } = fakeOptions();
    const bridge = createGeminiLiveNarrationBridge(options);

    bridge.enqueue("Auditing the draft.");
    await bridge.close();

    expect(sent).toEqual(["Auditing the draft."]);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      sampleRate: 1000,
      channels: 1,
      samplesPerChannel: 10,
    });
    expect(Array.from(published[0].data)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(closed).toEqual({ gemini: true, livekit: true });
  });

  it("flushes a finite short PCM tail on turnComplete", async () => {
    const { options, published } = fakeOptions({
      connectGemini: async (callbacks) => ({
        sendNarration() {
          callbacks.onAudio(sampleChunk(15));
          callbacks.onTurnComplete();
        },
        sendAudio() {},
        close() {},
      }),
    });
    const bridge = createGeminiLiveNarrationBridge(options);

    bridge.enqueue("Short utterance.");
    await bridge.close();

    expect(published).toHaveLength(2);
    expect(published[0].samplesPerChannel).toBe(10);
    expect(published[1].samplesPerChannel).toBe(5);
  });

  it("reports bridge startup failures once without throwing from close", async () => {
    const onError = vi.fn();
    const { options } = fakeOptions({
      onError,
      connectGemini: async () => {
        throw new Error("Gemini unavailable");
      },
    });
    const bridge = createGeminiLiveNarrationBridge(options);

    bridge.enqueue("This will fail.");
    bridge.enqueue("This should not report twice.");
    await bridge.close();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      "Narration audio failed: Gemini unavailable",
    );
  });
});
