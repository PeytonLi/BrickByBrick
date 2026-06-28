import { z } from "zod";

/**
 * @brickbybrick/core — FROZEN SHARED CONTRACTS
 *
 * This file is the single coupling point between the engine (packages/inference,
 * packages/agentbox), the trainer (packages/trainer), and the UI (apps/web).
 * Feature agents IMPORT from here and must not edit it. Additive changes go
 * through the integration agent. See docs/ARCHITECTURE.md §6.
 */

/* ------------------------------------------------------------------ */
/* Task bank + generation config                                       */
/* ------------------------------------------------------------------ */

export const CriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  /** normalized weight wᵢ used in S(M,T,C); see docs/MATH.md §1 */
  weight: z.number().min(0).max(1),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const VisualTaskSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  /** the UI mechanism under test, e.g. "responsive-grid", "modal-focus-trap" */
  target_mechanism: z.string(),
  criteria: z.array(CriterionSchema).min(1),
});
export type VisualTask = z.infer<typeof VisualTaskSchema>;

export const GenerationConfigSchema = z.object({
  /** commit threshold τ ∈ [0.4, 1.0]; pair kept iff 𝒰(T) ≥ τ */
  tau: z.number().min(0.4).max(1).default(0.4),
  /** reject a new failure if cosine-sim > this against recent failures */
  diversity_threshold: z.number().min(0).max(1).default(0.82),
  /** run the Recipe Synthesizer every N committed pairs */
  mutate_every_n: z.number().int().positive().default(5),
  /** per-mechanism sampling weights the Challenger draws from */
  challenger_weights: z.record(z.string(), z.number()).default({}),
  /** stop the loop after this many committed pairs (live demo target ~3-8) */
  max_pairs: z.number().int().positive().default(8),
  /** when set, the Recipe Synthesizer is forcing focus on this mechanism */
  focus_mechanism: z.string().nullable().default(null),
  /** raw user goal that produced this config (Feature A; provenance) */
  intent: z.string().optional(),
  /** LLM-expanded steering paragraph injected into the Challenger (Feature A) */
  domain_framing: z.string().optional(),
  /** front-end framework hint, e.g. "react" | "vue" | "vanilla" (Feature A) */
  framework: z.string().optional(),
});
export type GenerationConfig = z.infer<typeof GenerationConfigSchema>;

/* ------------------------------------------------------------------ */
/* Audit primitives                                                    */
/* ------------------------------------------------------------------ */

export const ViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Viewport = z.infer<typeof ViewportSchema>;

/** one exploratory action the Antigravity sandbox performed in-browser */
export const AuditStepSchema = z.object({
  /** base64-encoded PNG screenshot captured after the action */
  screenshot: z.string(),
  /** the action taken, e.g. "click", "resize", "type", "scroll" */
  action: z.string(),
  /** the agent's stated intent for this action */
  intent: z.string(),
  viewport: ViewportSchema,
});
export type AuditStep = z.infer<typeof AuditStepSchema>;

export const DefectCategorySchema = z.enum([
  "layout_collision",
  "overflow",
  "truncation",
  "offscreen_render",
  "frozen_state",
  "script_error",
  "other",
]);
export type DefectCategory = z.infer<typeof DefectCategorySchema>;

export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const DefectSchema = z.object({
  /** base64 PNG of the broken state */
  screenshot: z.string(),
  /** captured DOM / console stack trace */
  dom_trace: z.string(),
  category: DefectCategorySchema,
  severity: SeveritySchema,
});
export type Defect = z.infer<typeof DefectSchema>;

/* ------------------------------------------------------------------ */
/* Scoring + training pair                                             */
/* ------------------------------------------------------------------ */

/** S(M,T,C) is computed from these per-criterion results; see docs/MATH.md §1 */
export const CriterionScoreSchema = z.object({
  criterion_id: z.string(),
  passed: z.boolean(),
  weight: z.number().min(0).max(1),
});
export type CriterionScore = z.infer<typeof CriterionScoreSchema>;

export const TrainingPairSchema = z.object({
  id: z.string(),
  task: VisualTaskSchema,
  /** the weak model's (Gemma 4) draft that failed the audit */
  weak_code: z.string(),
  defect: DefectSchema,
  /** the strong model's (Gemini 3.1 Pro) fix that passed the audit */
  strong_code: z.string(),
  /** 𝒰(T) = S(strong) − S(weak), in [0,1] */
  u_score: z.number().min(0).max(1),
});
export type TrainingPair = z.infer<typeof TrainingPairSchema>;

/* ------------------------------------------------------------------ */
/* Eval report                                                         */
/* ------------------------------------------------------------------ */

export const EvalTaskResultSchema = z.object({
  task: VisualTaskSchema,
  base_score: z.number(),
  tuned_score: z.number(),
  base_passed_criteria: z.array(z.string()),
  tuned_passed_criteria: z.array(z.string()),
  winner: z.enum(["base", "tuned", "tie"]),
  inconclusive: z.boolean().optional(),
});
export type EvalTaskResult = z.infer<typeof EvalTaskResultSchema>;

export const EvalReportSchema = z.object({
  runId: z.string(),
  k: z.number().int().nonnegative(),
  base_model: z.string(),
  tuned_model: z.string(),
  wins: z.number().int().nonnegative(),
  ties: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  mean_score_delta: z.number(),
  tasks: z.array(EvalTaskResultSchema),
});
export type EvalReport = z.infer<typeof EvalReportSchema>;

/* ------------------------------------------------------------------ */
/* Training telemetry                                                  */
/* ------------------------------------------------------------------ */

export const LossPointSchema = z.object({
  step: z.number().int().nonnegative(),
  loss: z.number(),
  epoch: z.number().nonnegative(),
});
export type LossPoint = z.infer<typeof LossPointSchema>;

export const TrainingStatusSchema = z.enum([
  "provisioning",
  "streaming_dataset",
  "training",
  "saving",
  "complete",
  "failed",
]);
export type TrainingStatus = z.infer<typeof TrainingStatusSchema>;

/* ------------------------------------------------------------------ */
/* AgentEvent — the SSE payload between engine and UI                  */
/* ------------------------------------------------------------------ */

export const PairRejectReasonSchema = z.enum(["too_easy", "redundant"]);
export type PairRejectReason = z.infer<typeof PairRejectReasonSchema>;

export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("challenge_generated"), task: VisualTaskSchema }),
  z.object({ type: z.literal("weak_code_drafted"), code: z.string() }),
  z.object({ type: z.literal("audit_step"), step: AuditStepSchema }),
  z.object({ type: z.literal("defect_found"), defect: DefectSchema }),
  z.object({
    type: z.literal("strong_fix_generated"),
    code: z.string(),
    diff: z.string(),
  }),
  z.object({ type: z.literal("audit_pass") }),
  z.object({
    type: z.literal("pair_committed"),
    pair: TrainingPairSchema,
    u_score: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("pair_rejected"),
    reason: PairRejectReasonSchema,
  }),
  z.object({
    type: z.literal("recipe_mutated"),
    patch: GenerationConfigSchema.partial(),
  }),
  z.object({ type: z.literal("narration"), text: z.string() }),
  z.object({
    type: z.literal("training_event"),
    loss: LossPointSchema.optional(),
    status: TrainingStatusSchema.optional(),
    instance: z.string().optional(),
    cost_microcents: z.number().optional(),
  }),
  z.object({
    type: z.literal("intent_expanded"),
    config: GenerationConfigSchema.partial(),
    sample_titles: z.array(z.string()),
  }),
  z.object({
    type: z.literal("eval_started"),
    k: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("eval_task_result"),
    result: EvalTaskResultSchema,
  }),
  z.object({ type: z.literal("eval_complete"), report: EvalReportSchema }),
  z.object({
    type: z.literal("model_serving"),
    url: z.string(),
    expires_at: z.string(),
    pod_id: z.string(),
    base_model: z.string(),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentEventType = AgentEvent["type"];

/* ------------------------------------------------------------------ */
/* Engine entry signature (frozen)                                     */
/* ------------------------------------------------------------------ */

/**
 * The visual break-and-fix loop. Implemented in packages/inference/src/loop.ts,
 * driven by the web API route which forwards each emitted event over SSE.
 */
export type RunVisualLoop = (
  config: GenerationConfig,
  emit: (event: AgentEvent) => void,
) => Promise<void>;
