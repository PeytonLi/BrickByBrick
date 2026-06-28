import type { AgentEvent, LossPoint, TrainingPair } from "@brickbybrick/core";
import { runGemmaLoraTraining } from "@brickbybrick/trainer";

export interface GemmaTrainingDeps {
  runGemmaLoraTraining: (
    opts: { pairs: TrainingPair[]; runName?: string; keepPod?: boolean },
    callbacks: {
      onStatus?: (status: string, detail?: string) => void;
      onMetric?: (point: LossPoint) => void;
      onLog?: (line: string) => void;
    },
  ) => Promise<{
    podId: string;
    adapterPath: string;
    runName: string;
    hubRepo?: string;
  }>;
  serveAdapter?: (
    podId: string,
    target: { host: string; port: string; keyPath: string },
    opts: {
      remoteDir: string;
      adapterPath: string;
      baseModel?: string;
      port?: number;
      ttlMs?: number;
    },
  ) => Promise<{
    serveUrl: string;
    podId: string;
    baseModel: string;
    expiresAt: string;
  }>;
  sshTargetForPod?: (
    podId: string,
  ) => Promise<{ host: string; port: string; keyPath: string }>;
  remoteDirFor?: (runName: string) => string;
}

const realDeps: GemmaTrainingDeps = {
  runGemmaLoraTraining,
};

function trainingEvent(
  event: Omit<Extract<AgentEvent, { type: "training_event" }>, "type">,
): AgentEvent {
  return { type: "training_event", ...event };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runPrimeTraining(
  pairs: TrainingPair[],
  emit: (event: AgentEvent) => void,
  deps: GemmaTrainingDeps = realDeps,
): Promise<void> {
  if (pairs.length === 0) {
    emit({
      type: "narration",
      text: "No committed pairs available; skipping Prime training.",
    });
    return;
  }

  const runName = `bbb-gemma-${Date.now()}`;

  try {
    emit(trainingEvent({ status: "provisioning", instance: runName }));
    const result = await deps.runGemmaLoraTraining(
      { pairs, runName, keepPod: true },
      {
        onStatus: (status, detail) => {
          // 'pushed' is a Hub-save signal, not a TrainingStatus — surface it as
          // a narration with the adapter's Hub URL instead of a training_event.
          if (status === "pushed") {
            if (detail) {
              emit({
                type: "narration",
                text: `Adapter pushed to Hugging Face Hub: https://huggingface.co/${detail}`,
              });
            }
            return;
          }
          const eventStatus = status as Extract<
            AgentEvent,
            { type: "training_event" }
          >["status"];
          emit(trainingEvent({ status: eventStatus, instance: detail }));
        },
        onMetric: (loss) => emit(trainingEvent({ status: "training", loss })),
        onLog: (line) => {
          if (/error|failed|traceback/i.test(line)) {
            emit({ type: "narration", text: line.slice(0, 240) });
          }
        },
      },
    );

    emit({
      type: "narration",
      text: `Exact Gemma LoRA adapter ready on Prime pod ${result.podId}: ${result.adapterPath}`,
    });
    emit(trainingEvent({ status: "complete", instance: result.adapterPath }));

    if (deps.serveAdapter && deps.sshTargetForPod && deps.remoteDirFor) {
      try {
        const target = await deps.sshTargetForPod(result.podId);
        const handle = await deps.serveAdapter(result.podId, target, {
          remoteDir: deps.remoteDirFor(result.runName),
          adapterPath: result.adapterPath,
        });
        emit({
          type: "model_serving",
          url: handle.serveUrl,
          expires_at: handle.expiresAt,
          pod_id: handle.podId,
          base_model: handle.baseModel,
        });
      } catch (error) {
        emit({
          type: "narration",
          text: `Serving failed (adapter still on Hub): ${errorMessage(error)}`,
        });
      }
    }
  } catch (error) {
    emit(trainingEvent({ status: "failed", instance: runName }));
    emit({
      type: "narration",
      text: `Prime Gemma training failed: ${errorMessage(error)}`,
    });
  }
}
