import type { GenerationConfig, LossPoint, TrainingStatus } from './schemas'

/**
 * HTTP contracts for the web API routes. Frozen so the UI agent and the engine
 * agree on request/response shapes without sharing implementation.
 * See docs/features/C-UI.md.
 */

/** POST /api/agent/visual-loop/stream — body. Streams AgentEvents (SSE). */
export interface VisualLoopRequest {
  config?: Partial<GenerationConfig>
}

/** POST /api/training/stream — body. Streams training AgentEvents (SSE). */
export interface TrainingRequest {
  /** Prime Intellect run id of a (pre-warmed) job to stream metrics from. */
  runId: string
}

/** GET/POST /api/livekit/token — request. */
export interface LiveKitTokenRequest {
  room: string
  identity: string
}

/** /api/livekit/token — response. */
export interface LiveKitTokenResponse {
  token: string
  url: string
}

/** Convenience shape for the training console snapshot held in the store. */
export interface TrainingSnapshot {
  status: TrainingStatus
  instance: string | null
  cost_microcents: number
  loss: LossPoint[]
}
