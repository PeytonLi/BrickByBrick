import { z } from 'zod'

export const TrainingPairSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  ground_truth_cot: z.string(),       // Claude's full Chain-of-Thought
  ground_truth_answer: z.string(),    // Final answer extracted from CoT
  weak_answer: z.string(),            // Nemotron's attempt
  verification_passed: z.boolean(),   // Verifier sandbox exit code 0
  filter_gate: z.boolean(),           // true = strong correct, weak wrong
  error_category: z.string(),         // e.g. "fraction_arithmetic"
  schema_version: z.number().default(1),
  created_at: z.string().datetime(),
})
export type TrainingPair = z.infer<typeof TrainingPairSchema>

export const GenerationConfigSchema = z.object({
  target_count: z.number().default(100),   // 20 for demo, 5000 for real
  domain_hint: z.string(),                 // e.g. "linear algebra"
  error_rates: z.record(z.string(), z.number()).default({}),
  schema_version: z.number().default(1),
  // Dynamic axes the Recipe Synthesizer can mutate:
  volumetric_multipliers: z.record(z.string(), z.number()).default({}),
  structural_additions: z.array(z.string()).default([]),
})
export type GenerationConfig = z.infer<typeof GenerationConfigSchema>

export const AgentEventSchema = z.discriminatedUnion('agent', [
  z.object({ agent: z.literal('challenger'), content: z.string(), pair_id: z.string() }),
  z.object({ agent: z.literal('strong_solver'), content: z.string(), pair_id: z.string() }),
  z.object({ agent: z.literal('verifier'), content: z.string(), pair_id: z.string(), exit_code: z.number() }),
  z.object({ agent: z.literal('weak_solver'), content: z.string(), pair_id: z.string() }),
  z.object({ agent: z.literal('recipe'), content: z.string(), config_patch: z.record(z.unknown()) }),
  z.object({ agent: z.literal('system'), content: z.string(), pairs_completed: z.number(), total: z.number() }),
])
export type AgentEvent = z.infer<typeof AgentEventSchema>

export const LossPointSchema = z.object({
  step: z.number(),
  train: z.number(),
  val: z.number(),
})
export type LossPoint = z.infer<typeof LossPointSchema>
