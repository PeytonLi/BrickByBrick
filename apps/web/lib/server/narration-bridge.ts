import { randomUUID } from "node:crypto";

import { AccessToken } from "livekit-server-sdk";

import {
  DEFAULT_AUDIO_CHANNELS,
  DEFAULT_GEMINI_LIVE_SAMPLE_RATE,
  Pcm16FrameSplitter,
  decodeBase64Pcm16,
  extractGeminiLiveAudio,
  type GeminiLiveAudioMessage,
  type PcmAudioFrame,
} from "./narration-audio";

const DEFAULT_ROOM = "brickbybrick-control";
const DEFAULT_TRACK_NAME = "gemini-live-narration";
const DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-latest";
const DEFAULT_TURN_TIMEOUT_MS = 60_000;

export interface NarrationAudioBridge {
  enqueue(text: string): void;
  close(): Promise<void>;
}

interface GeminiAudioClient {
  sendNarration(text: string): void;
  sendAudio(pcmData: Uint8Array): void;
  close(): void;
}

interface LiveKitAudioPublisher {
  publishFrame(frame: PcmAudioFrame): Promise<void>;
  close(): Promise<void>;
}

interface GeminiConnectorCallbacks {
  onAudio: (base64Pcm16: string) => void;
  onTurnComplete: () => void;
  onError: (error: unknown) => void;
}

interface LiveKitPublisherOptions {
  room: string;
  identity: string;
  trackName: string;
  sampleRate: number;
  channels: number;
  onUserAudio?: (pcmData: Uint8Array) => void;
}

export interface NarrationBridgeOptions {
  room?: string;
  identity?: string;
  model?: string;
  sampleRate?: number;
  channels?: number;
  trackName?: string;
  turnTimeoutMs?: number;
  onError?: (message: string) => void;
  /** Fires when the user speaks — provides transcribed text for steering the AI. */
  onUserSpeech?: (text: string) => void;
  connectGemini?: (
    callbacks: GeminiConnectorCallbacks,
  ) => Promise<GeminiAudioClient>;
  createPublisher?: (
    options: LiveKitPublisherOptions,
  ) => Promise<LiveKitAudioPublisher>;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function createNoopNarrationBridge(): NarrationAudioBridge {
  return {
    enqueue() {},
    async close() {},
  };
}

export function createGeminiLiveNarrationBridge(
  options: NarrationBridgeOptions = {},
): NarrationAudioBridge {
  return new GeminiLiveNarrationBridge(options);
}

class GeminiLiveNarrationBridge implements NarrationAudioBridge {
  private readonly splitter: Pcm16FrameSplitter;
  private readonly turnTimeoutMs: number;
  private readonly onError?: (message: string) => void;
  private readonly ready: Promise<void>;
  private queue = Promise.resolve();
  private publishQueue = Promise.resolve();
  private client: GeminiAudioClient | null = null;
  private publisher: LiveKitAudioPublisher | null = null;
  private closing = false;
  private closed = false;
  private reportedError = false;
  private activeTurn: {
    resolve: () => void;
    reject: (error: unknown) => void;
  } | null = null;

  constructor(private readonly options: NarrationBridgeOptions) {
    const sampleRate =
      options.sampleRate ??
      positiveInteger(
        process.env.GEMINI_LIVE_SAMPLE_RATE,
        DEFAULT_GEMINI_LIVE_SAMPLE_RATE,
      );
    const channels = options.channels ?? DEFAULT_AUDIO_CHANNELS;

    this.turnTimeoutMs = options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    this.onError = options.onError;
    this.splitter = new Pcm16FrameSplitter(sampleRate, channels);
    this.ready = this.connect(sampleRate, channels);
  }

  enqueue(text: string): void {
    if (this.closing || this.closed || text.trim().length === 0) return;

    this.queue = this.queue
      .then(() => this.speak(text))
      .catch((error) => this.reportError(error));
  }

  async close(): Promise<void> {
    this.closing = true;

    try {
      await this.queue;
    } catch {
      // The queue reports its own errors; close should still release resources.
    }

    this.closed = true;

    await Promise.allSettled([
      this.publisher?.close() ?? Promise.resolve(),
      Promise.resolve().then(() => this.client?.close()),
    ]);
  }

  private async connect(sampleRate: number, channels: number): Promise<void> {
    const room = this.options.room ?? DEFAULT_ROOM;
    const identity =
      this.options.identity ?? `narrator-${randomUUID().slice(0, 8)}`;
    const trackName = this.options.trackName ?? DEFAULT_TRACK_NAME;

    const [clientResult, publisherResult] = await Promise.allSettled([
      (
        this.options.connectGemini ?? defaultGeminiConnector(this.options.model)
      )({
        onAudio: (base64Pcm16) => this.handleAudio(base64Pcm16),
        onTurnComplete: () => this.completeTurn(),
        onError: (error) => this.failTurn(error),
      }),
      (this.options.createPublisher ?? defaultLiveKitPublisher)({
        room,
        identity,
        trackName,
        sampleRate,
        channels,
        // Forward user's microphone audio to Gemini Live so the AI can hear you
        onUserAudio: (pcmData) => {
          clientResult.status === "fulfilled" &&
            clientResult.value.sendAudio(pcmData);
        },
      }),
    ]);

    if (
      clientResult.status === "rejected" ||
      publisherResult.status === "rejected"
    ) {
      if (clientResult.status === "fulfilled") {
        clientResult.value.close();
      }
      if (publisherResult.status === "fulfilled") {
        await publisherResult.value.close();
      }

      if (clientResult.status === "rejected") {
        throw clientResult.reason;
      }

      if (publisherResult.status === "rejected") {
        throw publisherResult.reason;
      }

      throw new Error("Narration bridge failed to connect");
    }

    const client = clientResult.value;
    const publisher = publisherResult.value;

    if (this.closed) {
      await publisher.close();
      client.close();
      return;
    }

    this.client = client;
    this.publisher = publisher;
  }

  private async speak(text: string): Promise<void> {
    await this.ready;
    if (this.closed || !this.client) return;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.activeTurn) {
          this.activeTurn = null;
          reject(
            new Error("Gemini Live narration timed out before turnComplete"),
          );
        }
      }, this.turnTimeoutMs);

      this.activeTurn = {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };

      this.client?.sendNarration(text);
    });
  }

  private handleAudio(base64Pcm16: string): void {
    try {
      const frames = this.splitter.push(decodeBase64Pcm16(base64Pcm16));
      for (const frame of frames) {
        this.publishFrame(frame);
      }
    } catch (error) {
      this.failTurn(error);
    }
  }

  private publishFrame(frame: PcmAudioFrame): void {
    this.publishQueue = this.publishQueue.then(async () => {
      if (!this.closed) {
        await this.publisher?.publishFrame(frame);
      }
    });
  }

  private completeTurn(): void {
    const turn = this.activeTurn;
    if (!turn) return;
    this.activeTurn = null;

    void this.publishQueue
      .then(async () => {
        for (const frame of this.splitter.flush()) {
          await this.publisher?.publishFrame(frame);
        }
      })
      .then(turn.resolve, turn.reject);
  }

  private failTurn(error: unknown): void {
    const turn = this.activeTurn;
    if (turn) {
      this.activeTurn = null;
      turn.reject(error);
    } else {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    if (this.reportedError) return;
    this.reportedError = true;
    this.onError?.(`Narration audio failed: ${errorMessage(error)}`);
  }
}

function defaultGeminiConnector(modelOverride?: string) {
  return async function connectGeminiLive({
    onAudio,
    onTurnComplete,
    onError,
  }: GeminiConnectorCallbacks): Promise<GeminiAudioClient> {
    const { GoogleGenAI, Modality } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: requiredEnv("GEMINI_API_KEY") });
    const session = await ai.live.connect({
      model:
        modelOverride ?? process.env.GEMINI_LIVE_MODEL ?? DEFAULT_LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction:
          "Speak each status update as concise demo narration. Keep responses under one sentence.",
      },
      callbacks: {
        onmessage: (message: GeminiLiveAudioMessage) => {
          for (const chunk of extractGeminiLiveAudio(message)) {
            onAudio(chunk);
          }
          if (message.serverContent?.turnComplete) {
            onTurnComplete();
          }
        },
        onerror: (event: { error?: unknown }) => onError(event.error ?? event),
        onclose: () => {},
      },
    });

    return {
      sendNarration(text: string) {
        session.sendClientContent({
          turns: [
            {
              role: "user",
              parts: [{ text }],
            },
          ],
          turnComplete: true,
        });
      },
      sendAudio(pcmData: Uint8Array) {
        session.sendRealtimeInput({
          audio: {
            data: Buffer.from(pcmData).toString("base64"),
            mimeType: "audio/pcm;rate=24000",
          },
        });
      },
      close() {
        session.close();
      },
    };
  };
}

async function defaultLiveKitPublisher({
  room,
  identity,
  trackName,
  sampleRate,
  channels,
  onUserAudio,
}: LiveKitPublisherOptions): Promise<LiveKitAudioPublisher> {
  const url = requiredEnv("LIVEKIT_URL");
  const apiKey = requiredEnv("LIVEKIT_API_KEY");
  const apiSecret = requiredEnv("LIVEKIT_API_SECRET");

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: identity,
    ttl: "30m",
  });
  token.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  const {
    AudioFrame,
    AudioSource,
    AudioStream,
    LocalAudioTrack,
    Room,
    RoomEvent,
    TrackPublishOptions,
    TrackSource,
    dispose,
  } = await import("@livekit/rtc-node");

  const liveKitRoom = new Room();
  const source = new AudioSource(sampleRate, channels);
  const track = LocalAudioTrack.createAudioTrack(trackName, source);
  const publishOptions = new TrackPublishOptions();
  publishOptions.source = TrackSource.SOURCE_MICROPHONE;

  // Subscribe to remote participants' audio so we can forward it to Gemini
  liveKitRoom.on(RoomEvent.TrackSubscribed, (_track, _pub, participant) => {
    // Skip our own narrator track; only listen to the operator/user
    if (participant.identity === identity) return;
    if (!onUserAudio) return;

    try {
      const stream = new AudioStream(_track, sampleRate, channels);
      const reader = stream.getReader();
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done || !value) break;
            // AudioFrame has .data (Int16Array), .sampleRate, .channels, .samplesPerChannel
            const raw = new Uint8Array(
              value.data.buffer,
              value.data.byteOffset,
              value.data.byteLength,
            );
            onUserAudio(raw);
          }
        } catch {
          /* track ended */
        }
      })();
    } catch {
      /* unsupported track type */
    }
  });

  await liveKitRoom.connect(url, await token.toJwt(), {
    autoSubscribe: true,
    dynacast: false,
  });

  if (!liveKitRoom.localParticipant) {
    throw new Error("LiveKit narrator joined without a local participant");
  }

  await liveKitRoom.localParticipant.publishTrack(track, publishOptions);

  return {
    publishFrame(frame: PcmAudioFrame) {
      return source.captureFrame(
        new AudioFrame(
          frame.data,
          frame.sampleRate,
          frame.channels,
          frame.samplesPerChannel,
        ),
      );
    },
    async close() {
      await Promise.allSettled([
        track.close(true),
        source.close(),
        liveKitRoom.disconnect(),
      ]);
      await dispose();
    },
  };
}
