import { randomUUID } from 'crypto'
import type { GenerationConfig, TrainingPair, AgentEvent } from '@brickbybrick/core'
import {
  callChallenger,
  callVerifier,
  callWeakSolver,
} from './nebius'
import { runStrongSolver, runRecipeSynthesizer } from './anthropic'
import {
  CHALLENGER_SYSTEM,
  STRONG_SOLVER_SYSTEM,
  VERIFIER_SYSTEM,
  WEAK_SOLVER_SYSTEM,
  RECIPE_SYNTHESIZER_SYSTEM,
} from './prompts'

/** Agentbox sandbox executor — provided by caller (packages/agentbox). */
type RunCode = (code: string) => Promise<{ exitCode: number; output: string }>

/**
 * Runs the full 4-agent adversarial loop to produce training pairs.
 *
 * @param config - GenerationConfig controlling target count, domain, etc.
 * @param vectorChunks - Source document chunks from agentbox ingest (RAG context)
 * @param emit - SSE event emitter; called at every significant step
 * @param runCode - Agentbox sandbox executor for verifier Python snippets
 * @returns Array of TrainingPair objects that passed the filter gate
 */
export async function runAgentLoop(
  config: GenerationConfig,
  vectorChunks: string[],
  emit: (event: AgentEvent) => void,
  runCode: RunCode,
): Promise<TrainingPair[]> {
  const pairs: TrainingPair[] = []
  let iterationCount = 0

  // Mutable config — Recipe Synthesizer may patch this during the run
  let currentConfig: GenerationConfig = { ...config }

  emit({
    agent: 'system',
    content: `Starting agent loop. Target: ${currentConfig.target_count} pairs. Domain: "${currentConfig.domain_hint}"`,
    pairs_completed: 0,
    total: currentConfig.target_count,
  })

  while (pairs.length < currentConfig.target_count) {
    iterationCount++
    const pairId = randomUUID()

    // -------------------------------------------------------------------------
    // Step 1: Challenger — generate a question from the vector chunks
    // -------------------------------------------------------------------------
    let challengerResult: Awaited<ReturnType<typeof callChallenger>>
    try {
      challengerResult = await callChallenger(
        buildChallengerPrompt(currentConfig),
        vectorChunks,
        currentConfig.domain_hint,
      )

      emit({
        agent: 'challenger',
        content: challengerResult.raw,
        pair_id: pairId,
      })
    } catch (err) {
      console.error(`[loop] Challenger failed on iteration ${iterationCount}:`, err)
      // Skip this iteration and continue
      continue
    }

    const { question, raw_answer, error_category } = challengerResult

    if (!question.trim()) {
      console.warn(`[loop] Challenger returned empty question on iteration ${iterationCount}, skipping`)
      continue
    }

    // -------------------------------------------------------------------------
    // Step 2: Strong Solver (Claude) — generate full CoT + verified answer
    // -------------------------------------------------------------------------
    let strongResult: Awaited<ReturnType<typeof runStrongSolver>>
    try {
      // Provide a few relevant vector chunks as RAG context
      const ragContext = vectorChunks.slice(0, 3).join('\n\n')
      strongResult = await runStrongSolver(question, ragContext, STRONG_SOLVER_SYSTEM)

      emit({
        agent: 'strong_solver',
        content: strongResult.cot,
        pair_id: pairId,
      })
    } catch (err) {
      console.error(`[loop] StrongSolver failed on iteration ${iterationCount}:`, err)
      continue
    }

    const { cot, answer } = strongResult

    // Sanity check: if Claude's answer differs wildly from challenger's raw_answer, log it
    if (
      raw_answer.trim() !== '' &&
      !answersRoughlyMatch(answer, raw_answer)
    ) {
      console.warn(
        `[loop] Answer mismatch (pair ${pairId}): Claude="${answer}" Challenger="${raw_answer}"`,
      )
      // Proceed anyway — Claude is trusted as the ground truth
    }

    // -------------------------------------------------------------------------
    // Step 3: Verifier (Qwen) — write + run Python unit test
    // -------------------------------------------------------------------------
    let verificationPassed = false
    let verifierRaw = ''
    try {
      const verifierResult = await callVerifier(VERIFIER_SYSTEM, question, answer)
      verifierRaw = verifierResult.raw

      const sandboxResult = await runCode(verifierResult.pythonCode)
      verificationPassed = sandboxResult.exitCode === 0

      emit({
        agent: 'verifier',
        content: verifierResult.raw + '\n\n[sandbox output]: ' + sandboxResult.output,
        pair_id: pairId,
        exit_code: sandboxResult.exitCode,
      })

      if (!verificationPassed) {
        // Verifier says the answer is wrong — skip this pair
        console.warn(`[loop] Verifier rejected pair ${pairId} (exit code ${sandboxResult.exitCode})`)
        continue
      }
    } catch (err) {
      console.error(`[loop] Verifier failed on iteration ${iterationCount}:`, err)
      // If the verifier itself errors (not the sandbox), treat as unverifiable → pass through
      verificationPassed = true
      verifierRaw = `[verifier error: ${String(err)}]`
      emit({
        agent: 'verifier',
        content: verifierRaw,
        pair_id: pairId,
        exit_code: 0,
      })
    }

    // -------------------------------------------------------------------------
    // Step 4: Weak Solver (Nemotron) — attempt without CoT
    // -------------------------------------------------------------------------
    let weakResult: Awaited<ReturnType<typeof callWeakSolver>>
    try {
      weakResult = await callWeakSolver(WEAK_SOLVER_SYSTEM, question)

      emit({
        agent: 'weak_solver',
        content: weakResult.raw,
        pair_id: pairId,
      })
    } catch (err) {
      console.error(`[loop] WeakSolver failed on iteration ${iterationCount}:`, err)
      continue
    }

    const weakAnswer = weakResult.weak_answer

    // -------------------------------------------------------------------------
    // Step 5: Filter Gate — keep only pairs where strong succeeds, weak fails
    // -------------------------------------------------------------------------
    const filterGate = verificationPassed && !answersRoughlyMatch(weakAnswer, answer)

    const trainingPair: TrainingPair = {
      id: pairId,
      question,
      ground_truth_cot: cot,
      ground_truth_answer: answer,
      weak_answer: weakAnswer,
      verification_passed: verificationPassed,
      filter_gate: filterGate,
      error_category: error_category,
      schema_version: 1,
      created_at: new Date().toISOString(),
    }

    if (filterGate) {
      pairs.push(trainingPair)

      emit({
        agent: 'system',
        content: `Pair accepted (${pairs.length}/${currentConfig.target_count}). Category: ${error_category}`,
        pairs_completed: pairs.length,
        total: currentConfig.target_count,
      })
    } else {
      emit({
        agent: 'system',
        content: `Pair filtered out (verification_passed=${verificationPassed}, weak_matches_strong=${!filterGate}). Continuing.`,
        pairs_completed: pairs.length,
        total: currentConfig.target_count,
      })
    }

    // -------------------------------------------------------------------------
    // Step 6: Recipe Synthesizer — every 10 pairs, analyze and patch config
    // -------------------------------------------------------------------------
    if (pairs.length > 0 && pairs.length % 10 === 0) {
      const recentPairs = pairs.slice(-10)
      try {
        const pairsJson = JSON.stringify(recentPairs, null, 2)
        const { patch, raw } = await runRecipeSynthesizer(pairsJson, RECIPE_SYNTHESIZER_SYSTEM)

        // Apply the patch
        currentConfig = applyConfigPatch(currentConfig, patch)

        emit({
          agent: 'recipe',
          content: raw,
          config_patch: patch as unknown as Record<string, unknown>,
        })
      } catch (err) {
        console.error(`[loop] RecipeSynthesizer failed after ${pairs.length} pairs:`, err)
        // Non-fatal — continue with current config
      }
    }
  }

  emit({
    agent: 'system',
    content: `Agent loop complete. Generated ${pairs.length} training pairs in ${iterationCount} iterations.`,
    pairs_completed: pairs.length,
    total: currentConfig.target_count,
  })

  return pairs
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a challenger system prompt that incorporates the current config's
 * structural additions from the Recipe Synthesizer.
 */
function buildChallengerPrompt(config: GenerationConfig): string {
  let prompt = CHALLENGER_SYSTEM
  if (config.structural_additions.length > 0) {
    prompt +=
      '\n\nAdditional guidance from recipe synthesizer:\n' +
      config.structural_additions.map((s) => `- ${s}`).join('\n')
  }
  // If certain error categories are prioritized, hint at them
  const prioritized = Object.entries(config.volumetric_multipliers)
    .filter(([, v]) => v > 1.5)
    .map(([k]) => k)
  if (prioritized.length > 0) {
    prompt += `\n\nPrioritize these error categories: ${prioritized.join(', ')}`
  }
  return prompt
}

/**
 * Apply a Recipe Synthesizer patch to the current GenerationConfig.
 * Only patches fields that are present in the patch object.
 */
function applyConfigPatch(
  config: GenerationConfig,
  patch: {
    error_rates?: Record<string, number>
    volumetric_multipliers?: Record<string, number>
    structural_additions?: string[]
  },
): GenerationConfig {
  return {
    ...config,
    error_rates: patch.error_rates
      ? { ...config.error_rates, ...patch.error_rates }
      : config.error_rates,
    volumetric_multipliers: patch.volumetric_multipliers
      ? { ...config.volumetric_multipliers, ...patch.volumetric_multipliers }
      : config.volumetric_multipliers,
    structural_additions: patch.structural_additions
      ? [...new Set([...config.structural_additions, ...patch.structural_additions])]
      : config.structural_additions,
  }
}

/**
 * Rough answer comparison: normalize whitespace, case, and trailing punctuation
 * before comparing. Returns true if answers are likely the same.
 */
function answersRoughlyMatch(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.,;:!?]$/g, '')
      .replace(/\s+/g, ' ')
      .trim()

  const na = normalize(a)
  const nb = normalize(b)

  if (na === nb) return true

  // Try numeric comparison
  const fa = parseFloat(na)
  const fb = parseFloat(nb)
  if (!isNaN(fa) && !isNaN(fb)) {
    return Math.abs(fa - fb) < 1e-9
  }

  return false
}
