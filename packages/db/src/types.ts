import type {
  GenerationConfig,
  AgentEvent,
  AgentEventType,
  VisualTask,
  Defect,
  Criterion,
} from "@brickbybrick/core";

export interface LoopRun {
  runId: string;
  config: GenerationConfig;
  status: "running" | "complete" | "failed";
  startedAt: Date;
  completedAt?: Date;
  pairsCommitted: number;
  totalIterations: number;
  serve?: {
    podId: string;
    serveUrl: string;
    baseModel: string;
    expiresAt: string;
  };
}

export interface PersistedPair {
  pairId: string;
  runId: string;
  task: VisualTask;
  weak_code: string;
  defect: Defect;
  strong_code: string;
  u_score: number;
  createdAt: Date;
}

export interface PersistedEvent {
  runId: string;
  sequence: number;
  type: AgentEventType;
  payload: AgentEvent;
  timestamp: Date;
}

export interface PersistedTask {
  id: string;
  prompt: string;
  target_mechanism: string;
  criteria: Criterion[];
  timesUsed: number;
  createdAt: Date;
}
