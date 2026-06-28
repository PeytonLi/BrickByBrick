import type { VisualTask, Defect } from '@brickbybrick/core'

export interface ChatProvider {
  generate(model: string, systemPrompt: string, userPrompt: string): Promise<string>
}

export interface EmbedProvider {
  embed(text: string): Promise<number[]>
}

/** The set of solver capabilities the loop needs. */
export interface SolverSet {
  /** The strong model (Gemini 3.1 Pro / Claude 4.6 Sonnet) — used for challenger + strongSolver */
  strongModel: string
  /** The weak model (Gemma 4 / Llama 3.3) */
  weakModel: string
  /** One-shot generation */
  generate(model: string, systemPrompt: string, userPrompt: string): Promise<string>
  /** Text embedding for diversity gate */
  embed(text: string): Promise<number[]>
}
