import { NextResponse } from "next/server";
import {
  formatSSE,
  SSE_HEADERS,
  type AgentEvent,
} from "@brickbybrick/core";
import { connectDB, RunModel } from "@brickbybrick/db";
import { demoRunEval } from "../demo-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let runId = "";
  let k = 3;
  try {
    const body = (await request.json()) as { runId?: string; k?: number };
    runId = (body.runId ?? "").trim();
    if (typeof body.k === "number" && body.k > 0) k = Math.floor(body.k);
  } catch {
    /* fall through */
  }
  if (!runId)
    return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent) =>
        controller.enqueue(encoder.encode(formatSSE(event)));
      try {
        if (process.env.BBB_DEMO_MODE === "1") {
          await demoRunEval(runId, k, emit);
        } else {
          await connectDB();
          const run = await RunModel.byId(runId).lean();
          if (!run?.serve?.serveUrl) {
            emit({
              type: "narration",
              text: "No live served model for this run; train first.",
            });
          } else {
            const inf =
              (await import("@brickbybrick/inference")) as typeof import("@brickbybrick/inference");
            await inf.runEval(
              {
                runId,
                config: run.config,
                k,
                baseModel: run.serve.baseModel,
                tunedModel: "tuned",
              },
              emit,
              inf.createEvalDeps(run.serve.serveUrl, run.serve.baseModel),
            );
          }
        }
      } catch (error) {
        emit({
          type: "narration",
          text:
            error instanceof Error
              ? `Eval failed: ${error.message}`
              : "Eval failed.",
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
