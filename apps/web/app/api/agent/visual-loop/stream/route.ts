import { NextResponse } from "next/server";

import {
  formatSSE,
  GenerationConfigSchema,
  SSE_HEADERS,
  type AgentEvent,
  type RunVisualLoop,
  type VisualLoopRequest,
} from "@brickbybrick/core";

import { connectDB, RunModel, PairModel, EventModel } from "@brickbybrick/db";

import {
  createGeminiLiveNarrationBridge,
  createNoopNarrationBridge,
  type NarrationAudioBridge,
} from "@/lib/server/narration-bridge";

import { demoRunVisualLoop } from "../demo-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readRequest(request: Request): Promise<VisualLoopRequest> {
  try {
    return (await request.json()) as VisualLoopRequest;
  } catch {
    return {};
  }
}

async function resolveRunVisualLoop(): Promise<RunVisualLoop> {
  // Deterministic, fast stub for e2e/CI — the real loop makes ~14-min live calls.
  if (process.env.BBB_DEMO_MODE === "1") {
    return demoRunVisualLoop;
  }

  const inferenceModule =
    (await import("@brickbybrick/inference")) as unknown as {
      runVisualLoop?: RunVisualLoop;
    };

  return typeof inferenceModule.runVisualLoop === "function"
    ? inferenceModule.runVisualLoop
    : demoRunVisualLoop;
}

export async function POST(request: Request) {
  const body = await readRequest(request);
  const parsed = GenerationConfigSchema.safeParse(body.config ?? {});

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid visual loop config", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const runVisualLoop = await resolveRunVisualLoop();
  const encoder = new TextEncoder();
  let bridge: NarrationAudioBridge | null = null;
  let aborted = false;

  request.signal.addEventListener("abort", () => {
    aborted = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let controllerOpen = true;
      const emitSSE = (event: AgentEvent) => {
        if (!aborted && controllerOpen) {
          controller.enqueue(encoder.encode(formatSSE(event)));
        }
      };

      // --- DB persistence (degraded-but-not-broken on failure) -------------
      let runId: string | null = null;
      let eventSeq = 0;
      let committedCount = 0;
      const EVENT_BATCH_SIZE = 5;
      let eventBatch: AgentEvent[] = [];

      const flushEventBatch = async () => {
        if (eventBatch.length === 0 || !runId) return;
        const batch = eventBatch;
        eventBatch = [];
        await EventModel.insertBatch(runId, batch, eventSeq - batch.length);
      };

      try {
        await connectDB();
        runId = crypto.randomUUID();
        await RunModel.create({
          runId,
          config: parsed.data,
          status: "running",
          startedAt: new Date(),
          pairsCommitted: 0,
          totalIterations: 0,
        });
      } catch {
        // No DB — stream still runs, just unpersisted.
        runId = null;
      }

      bridge =
        process.env.BBB_DEMO_MODE === "1"
          ? createNoopNarrationBridge()
          : createGeminiLiveNarrationBridge({
              onError: (text) => emitSSE({ type: "narration", text }),
            });

      const emit = (event: AgentEvent) => {
        emitSSE(event);
        if (event.type === "narration") {
          bridge?.enqueue(event.text);
        }
        if (runId) {
          eventBatch.push(event);
          eventSeq++;
          if (eventBatch.length >= EVENT_BATCH_SIZE) {
            flushEventBatch().catch(() => {});
          }
          if (event.type === "pair_committed") {
            committedCount++;
            PairModel.create({
              pairId: event.pair.id,
              runId,
              task: event.pair.task,
              weak_code: event.pair.weak_code,
              defect: event.pair.defect,
              strong_code: event.pair.strong_code,
              u_score: event.u_score,
            }).catch(() => {});
          }
          if (event.type === "model_serving") {
            RunModel.setServe(runId, {
              podId: event.pod_id,
              serveUrl: event.url,
              baseModel: event.base_model,
              expiresAt: event.expires_at,
            }).catch(() => {});
          }
        }
      };

      try {
        await runVisualLoop(parsed.data, emit);
      } catch (error) {
        emit({
          type: "narration",
          text:
            error instanceof Error
              ? `Visual loop failed: ${error.message}`
              : "Visual loop failed.",
        });
      } finally {
        if (runId) {
          await flushEventBatch().catch(() => {});
          await RunModel.updateOne(
            { runId },
            {
              status: aborted ? "failed" : "complete",
              completedAt: new Date(),
              pairsCommitted: committedCount,
            },
          ).catch(() => {});
        }
        await bridge?.close();
        controllerOpen = false;
        if (!aborted) {
          controller.close();
        }
      }
    },
    cancel() {
      aborted = true;
      void bridge?.close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
