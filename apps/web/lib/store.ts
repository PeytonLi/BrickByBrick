import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type {
  AgentEvent,
  AgentEventType,
  AuditStep,
  Defect,
  EvalReport,
  EvalTaskResult,
  GenerationConfig,
  LossPoint,
  PairRejectReason,
  TrainingPair,
  TrainingSnapshot,
  TrainingStatus,
  VisualTask,
} from "@brickbybrick/core";

export type LoopStatus =
  | "idle"
  | "running"
  | "auditing"
  | "fixing"
  | "passed"
  | "committed"
  | "rejected"
  | "training";

export type PulseState = "committed" | "rejected" | null;

export interface TimelineEntry {
  id: string;
  type: AgentEventType;
  label: string;
  tone: "neutral" | "success" | "warning" | "error";
  at: number;
}

export interface AgentStoreSnapshot {
  status: LoopStatus;
  targetPairs: number;
  currentTask: VisualTask | null;
  weakCode: string | null;
  strongCode: string | null;
  latestDiff: string | null;
  latestAuditStep: AuditStep | null;
  latestScreenshotSrc: string | null;
  latestDefect: Defect | null;
  committedPairs: TrainingPair[];
  committedCount: number;
  uScore: number | null;
  lastRejectedReason: PairRejectReason | null;
  recipePatch: Partial<GenerationConfig> | null;
  narration: string[];
  training: TrainingSnapshot;
  trainingRunId: string | null;
  timeline: TimelineEntry[];
  lastEventType: AgentEventType | null;
  pulse: PulseState;
  derivedConfig: Partial<GenerationConfig> | null;
  sampleTitles: string[];
  serveInfo: { url: string; expiresAt: string; baseModel: string } | null;
  evalRunning: boolean;
  evalResults: EvalTaskResult[];
  evalReport: EvalReport | null;
}

interface AgentStoreActions {
  consumeEvent: (event: AgentEvent) => void;
  reset: () => void;
  setTargetPairs: (targetPairs: number) => void;
  clearPulse: () => void;
}

export type AgentStore = AgentStoreSnapshot & AgentStoreActions;

const MAX_TIMELINE = 24;
const MAX_NARRATION = 8;

export const initialTrainingState: TrainingSnapshot = {
  status: "provisioning",
  instance: null,
  cost_microcents: 0,
  loss: [],
};

export const initialAgentState: AgentStoreSnapshot = {
  status: "idle",
  targetPairs: 8,
  currentTask: null,
  weakCode: null,
  strongCode: null,
  latestDiff: null,
  latestAuditStep: null,
  latestScreenshotSrc: null,
  latestDefect: null,
  committedPairs: [],
  committedCount: 0,
  uScore: null,
  lastRejectedReason: null,
  recipePatch: null,
  narration: [],
  training: initialTrainingState,
  trainingRunId: null,
  timeline: [],
  lastEventType: null,
  pulse: null,
  derivedConfig: null,
  sampleTitles: [],
  serveInfo: null,
  evalRunning: false,
  evalResults: [],
  evalReport: null,
};

function screenshotSrc(base64: string): string {
  return base64.startsWith("data:")
    ? base64
    : `data:image/png;base64,${base64}`;
}

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "challenge_generated":
      return `Challenge: ${event.task.target_mechanism}`;
    case "weak_code_drafted":
      return "Weak solver draft received";
    case "audit_step":
      return `Audit ${event.step.action}: ${event.step.intent}`;
    case "defect_found":
      return `Defect: ${event.defect.category}`;
    case "strong_fix_generated":
      return "Strong solver fix generated";
    case "audit_pass":
      return "Visual audit passed";
    case "pair_committed":
      return `Pair committed, U=${event.u_score.toFixed(2)}`;
    case "pair_rejected":
      return `Pair rejected: ${event.reason.replace("_", " ")}`;
    case "recipe_mutated":
      return "Recipe mutated";
    case "narration":
      return event.text;
    case "training_event":
      return event.status
        ? `Training: ${event.status}`
        : "Training metric received";
    case "intent_expanded":
      return "Intent expanded";
    case "model_serving":
      return "Model serving ready";
    case "eval_started":
      return "Evaluation started";
    case "eval_task_result":
      return "Eval task completed";
    case "eval_complete":
      return "Evaluation complete";
  }
  // Exhaustive — all event types handled above.
  return (event as { type: string }).type;
}

function eventTone(event: AgentEvent): TimelineEntry["tone"] {
  switch (event.type) {
    case "pair_committed":
    case "audit_pass":
      return "success";
    case "pair_rejected":
      return "warning";
    case "defect_found":
      return event.defect.severity === "critical" ||
        event.defect.severity === "high"
        ? "error"
        : "warning";
    default:
      return "neutral";
  }
}

function appendTimeline(
  timeline: TimelineEntry[],
  event: AgentEvent,
  at = Date.now(),
): TimelineEntry[] {
  return [
    {
      id: `${at}-${event.type}-${timeline.length}`,
      type: event.type,
      label: eventLabel(event),
      tone: eventTone(event),
      at,
    },
    ...timeline,
  ].slice(0, MAX_TIMELINE);
}

function updateTraining(
  training: TrainingSnapshot,
  event: Extract<AgentEvent, { type: "training_event" }>,
): TrainingSnapshot {
  return {
    status: event.status ?? training.status,
    instance: event.instance ?? training.instance,
    cost_microcents: event.cost_microcents ?? training.cost_microcents,
    loss: event.loss ? [...training.loss, event.loss] : training.loss,
  };
}

export function reduceAgentState(
  state: AgentStoreSnapshot,
  event: AgentEvent,
): AgentStoreSnapshot {
  const base: AgentStoreSnapshot = {
    ...state,
    lastEventType: event.type,
    timeline: appendTimeline(state.timeline, event),
  };

  switch (event.type) {
    case "challenge_generated":
      return {
        ...base,
        status: "running",
        currentTask: event.task,
        latestDefect: null,
        lastRejectedReason: null,
      };
    case "weak_code_drafted":
      return { ...base, status: "running", weakCode: event.code };
    case "audit_step":
      return {
        ...base,
        status: "auditing",
        latestAuditStep: event.step,
        latestScreenshotSrc: screenshotSrc(event.step.screenshot),
      };
    case "defect_found":
      return {
        ...base,
        status: "auditing",
        latestDefect: event.defect,
        latestScreenshotSrc: screenshotSrc(event.defect.screenshot),
      };
    case "strong_fix_generated":
      return {
        ...base,
        status: "fixing",
        strongCode: event.code,
        latestDiff: event.diff,
      };
    case "audit_pass":
      return { ...base, status: "passed" };
    case "pair_committed":
      return {
        ...base,
        status: "committed",
        committedPairs: [...state.committedPairs, event.pair],
        committedCount: state.committedCount + 1,
        uScore: event.u_score,
        lastRejectedReason: null,
        pulse: "committed",
      };
    case "pair_rejected":
      return {
        ...base,
        status: "rejected",
        lastRejectedReason: event.reason,
        pulse: "rejected",
      };
    case "recipe_mutated":
      return { ...base, recipePatch: event.patch };
    case "narration":
      return {
        ...base,
        narration: [event.text, ...state.narration].slice(0, MAX_NARRATION),
      };
    case "training_event":
      return {
        ...base,
        status: event.status ? "training" : base.status,
        training: updateTraining(state.training, event),
        trainingRunId: event.instance ?? state.trainingRunId,
      };
    case "intent_expanded":
      return {
        ...base,
        derivedConfig: event.config,
        sampleTitles: event.sample_titles,
      };
    case "model_serving":
      return {
        ...base,
        serveInfo: {
          url: event.url,
          expiresAt: event.expires_at,
          baseModel: event.base_model,
        },
      };
    case "eval_started":
      return { ...base, evalRunning: true, evalResults: [], evalReport: null };
    case "eval_task_result":
      return { ...base, evalResults: [...state.evalResults, event.result] };
    case "eval_complete":
      return { ...base, evalRunning: false, evalReport: event.report };
  }
}

function persistedSnapshot(state: AgentStore): AgentStoreSnapshot {
  return {
    status: state.status,
    targetPairs: state.targetPairs,
    currentTask: state.currentTask,
    weakCode: state.weakCode,
    strongCode: state.strongCode,
    latestDiff: state.latestDiff,
    latestAuditStep: state.latestAuditStep,
    latestScreenshotSrc: state.latestScreenshotSrc,
    latestDefect: state.latestDefect,
    committedPairs: state.committedPairs,
    committedCount: state.committedCount,
    uScore: state.uScore,
    lastRejectedReason: state.lastRejectedReason,
    recipePatch: state.recipePatch,
    narration: state.narration,
    training: state.training,
    trainingRunId: state.trainingRunId,
    timeline: state.timeline,
    lastEventType: state.lastEventType,
    pulse: state.pulse,
    derivedConfig: state.derivedConfig,
    sampleTitles: state.sampleTitles,
    serveInfo: state.serveInfo,
    evalRunning: state.evalRunning,
    evalResults: state.evalResults,
    evalReport: state.evalReport,
  };
}

export const useAgentStore = create<AgentStore>()(
  persist(
    (set) => ({
      ...initialAgentState,
      consumeEvent: (event) => set((state) => reduceAgentState(state, event)),
      reset: () => set(initialAgentState),
      setTargetPairs: (targetPairs) =>
        set({ targetPairs: Math.max(1, Math.floor(targetPairs)) }),
      clearPulse: () => set({ pulse: null }),
    }),
    {
      name: "brickbybrick-agent",
      storage: createJSONStorage(() => sessionStorage),
      partialize: persistedSnapshot,
    },
  ),
);

export function formatMicrocents(costMicrocents: number): string {
  const cents = costMicrocents / 1_000_000;
  if (cents < 0.01) {
    return `${costMicrocents.toLocaleString()} microcents`;
  }
  return `$${(cents / 100).toFixed(4)}`;
}

export function latestLoss(loss: LossPoint[]): number | null {
  return loss.length > 0 ? loss[loss.length - 1].loss : null;
}

export function trainingStatusLabel(status: TrainingStatus): string {
  return status.replaceAll("_", " ");
}
