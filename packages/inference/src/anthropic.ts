import Anthropic from '@anthropic-ai/sdk'
import type { RecipePatch } from './nebius'

export const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
})

export const CLAUDE_MODEL = 'claude-sonnet-4-6'

export interface StrongSolverResult {
  cot: string
  answer: string
}

/**
 * Call Claude (Strong Solver) to produce a full chain-of-thought solution.
 *
 * Extracts the final answer by looking for "Therefore, the answer is:" marker.
 * Falls back to the last non-empty line if the marker is absent.
 */
export async function runStrongSolver(
  question: string,
  context: string,
  systemPrompt: string,
): Promise<StrongSolverResult> {
  const userMessage = context
    ? `Context:\n${context}\n\nQuestion: ${question}`
    : `Question: ${question}`

  const message = await anthropicClient.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const cot =
    message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n') ?? ''

  // Extract the final answer from the CoT
  const answer = extractFinalAnswer(cot)

  return { cot, answer }
}

/**
 * Parse the final answer from Claude's CoT output.
 * Looks for "Therefore, the answer is: <answer>" or "The answer is: <answer>".
 * Falls back to the last non-empty line.
 */
function extractFinalAnswer(cot: string): string {
  // Primary pattern: "Therefore, the answer is: <answer>"
  const thereforeMatch = cot.match(/Therefore,\s+the answer is[:\s]+(.+?)(?:\n|$)/i)
  if (thereforeMatch?.[1]) {
    return thereforeMatch[1].trim()
  }

  // Secondary pattern: "The answer is: <answer>"
  const answerIsMatch = cot.match(/The answer is[:\s]+(.+?)(?:\n|$)/i)
  if (answerIsMatch?.[1]) {
    return answerIsMatch[1].trim()
  }

  // Tertiary: "= <value>" at end of a line (common for math)
  const equalsMatch = cot.match(/=\s*([^\n]+)\s*$/m)
  if (equalsMatch?.[1]) {
    return equalsMatch[1].trim()
  }

  // Fallback: last non-empty line
  const lines = cot.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

export interface RecipeSynthesizerResult {
  patch: RecipePatch
  raw: string
}

/**
 * Call Claude (Recipe Synthesizer) to analyze a batch of training pairs
 * and return a JSON patch for the GenerationConfig.
 */
export async function runRecipeSynthesizer(
  pairsJson: string,
  systemPrompt: string,
): Promise<RecipeSynthesizerResult> {
  const message = await anthropicClient.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Here is the batch of training pairs for analysis:\n${pairsJson}`,
      },
    ],
  })

  const raw =
    message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n') ?? ''

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const patch = JSON.parse(cleaned) as RecipePatch
    return { patch, raw }
  } catch {
    console.warn('[anthropic] RecipeSynthesizer JSON parse failed:', raw.slice(0, 200))
    return {
      patch: {
        error_rates: {},
        volumetric_multipliers: {},
        structural_additions: [],
        reasoning: 'parse error',
      },
      raw,
    }
  }
}
