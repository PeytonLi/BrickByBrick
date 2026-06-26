import OpenAI from 'openai'

export const nebiusClient = new OpenAI({
  baseURL: 'https://api.tokenfactory.nebius.com/v1/',
  apiKey: process.env.NEBIUS_API_KEY ?? '',
})

// NOTE: These model IDs need verification against the live Nebius catalog.
// Check available models via: GET https://api.tokenfactory.nebius.com/v1/models
export const NEBIUS_MODELS = {
  // Challenger: largest Qwen3 available — verify this ID is available on your account
  challenger: 'Qwen/Qwen3-235B-A22B',
  // Verifier: same model for consistency
  verifier: 'Qwen/Qwen3-235B-A22B',
  // Weak Solver: smaller model that we want to improve via fine-tuning (confirmed by user)
  weak_solver: 'nvidia/Nemotron-3-Nano-Omni',
  // Embedding model for RAG
  embedding: 'BAAI/bge-en-icl',
} as const

export type NebiusModel = (typeof NEBIUS_MODELS)[keyof typeof NEBIUS_MODELS]

/** Exponential backoff: 3 retries, 2 s base delay, jitter. */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelayMs = 2000,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt === retries) break
      const jitter = Math.random() * 500
      const delay = baseDelayMs * Math.pow(2, attempt) + jitter
      console.warn(`[nebius] attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms:`, err)
      await new Promise((res) => setTimeout(res, delay))
    }
  }
  throw lastError
}

export interface ChallengerResult {
  question: string
  raw_answer: string
  error_category: string
  difficulty: number
  raw: string
}

/**
 * Call the Challenger model (Qwen large) to generate a question from source chunks.
 */
export async function callChallenger(
  systemPrompt: string,
  vectorChunks: string[],
  domainHint: string,
): Promise<ChallengerResult> {
  const userMessage = `Domain: ${domainHint}

Source material (use this to ground your question):
${vectorChunks.slice(0, 5).join('\n\n---\n\n')}

Generate one challenging question following the format specified.`

  const raw = await withRetry(async () => {
    const response = await nebiusClient.chat.completions.create({
      model: NEBIUS_MODELS.challenger,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.8,
      max_tokens: 1024,
    })
    return response.choices[0]?.message?.content ?? ''
  })

  // Parse the JSON response
  try {
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned) as {
      question: string
      raw_answer: string
      error_category: string
      difficulty: number
    }
    return {
      question: parsed.question ?? '',
      raw_answer: parsed.raw_answer ?? '',
      error_category: parsed.error_category ?? 'other',
      difficulty: Number(parsed.difficulty ?? 3),
      raw,
    }
  } catch {
    // If JSON parsing fails, return what we have with sensible defaults
    console.warn('[nebius] Challenger JSON parse failed, using raw text')
    return {
      question: raw.slice(0, 500),
      raw_answer: '',
      error_category: 'other',
      difficulty: 3,
      raw,
    }
  }
}

export interface VerifierResult {
  pythonCode: string
  raw: string
}

/**
 * Call the Verifier model (Qwen large) to write a Python snippet that verifies an answer.
 */
export async function callVerifier(
  systemPrompt: string,
  question: string,
  answer: string,
): Promise<VerifierResult> {
  const userMessage = `Question: ${question}

Proposed answer: ${answer}

Write a Python 3 script that verifies this answer is correct.`

  const raw = await withRetry(async () => {
    const response = await nebiusClient.chat.completions.create({
      model: NEBIUS_MODELS.verifier,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    })
    return response.choices[0]?.message?.content ?? ''
  })

  // Strip markdown code fences if present
  const pythonCode = raw
    .replace(/^```python\n?/m, '')
    .replace(/^```\n?/m, '')
    .trim()

  return { pythonCode, raw }
}

export interface WeakSolverResult {
  weak_answer: string
  raw: string
}

/**
 * Call the Weak Solver (Nemotron small) to attempt a question without CoT.
 */
export async function callWeakSolver(
  systemPrompt: string,
  question: string,
): Promise<WeakSolverResult> {
  const raw = await withRetry(async () => {
    const response = await nebiusClient.chat.completions.create({
      model: NEBIUS_MODELS.weak_solver,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      temperature: 0.0,
      max_tokens: 256,
    })
    return response.choices[0]?.message?.content ?? ''
  })

  return { weak_answer: raw.trim(), raw }
}

export interface RecipePatch {
  error_rates: Record<string, number>
  volumetric_multipliers: Record<string, number>
  structural_additions: string[]
  reasoning: string
}

/**
 * Call the Recipe Synthesizer (delegated to Claude in loop.ts) — this Nebius variant
 * is not used in the primary loop but exported for fallback/testing.
 */
export async function callRecipeSynthesizerNebius(
  systemPrompt: string,
  pairsJson: string,
): Promise<{ patch: RecipePatch; raw: string }> {
  const raw = await withRetry(async () => {
    const response = await nebiusClient.chat.completions.create({
      model: NEBIUS_MODELS.challenger,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Batch of training pairs:\n${pairsJson}` },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    })
    return response.choices[0]?.message?.content ?? ''
  })

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const patch = JSON.parse(cleaned) as RecipePatch
    return { patch, raw }
  } catch {
    console.warn('[nebius] RecipeSynthesizer JSON parse failed')
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
