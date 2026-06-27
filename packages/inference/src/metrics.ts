import type { Criterion } from '@brickbybrick/core'

/**
 * Pure scoring + diversity math for the visual break-and-fix loop.
 * See docs/MATH.md §1 (discriminative reward gap) and §3 (diversity filter).
 */

/**
 * S(M, T, C) — the weighted fraction of graded criteria a model's output passes.
 *
 * MATH §1 writes this as (1/K)·Σ wᵢ·𝟙(passᵢ) for normalized weights; we compute
 * the equivalent weighted pass ratio Σ_{passed} wᵢ / Σ_all wᵢ so the result is
 * always in [0,1] (all pass → 1, none pass → 0) regardless of whether the
 * supplied weights happen to sum to 1.
 */
export function scoreCriteria(criteria: Criterion[], passed: Iterable<string>): number {
  const total = criteria.reduce((sum, c) => sum + c.weight, 0)
  if (total <= 0) return 0
  const passedSet = passed instanceof Set ? passed : new Set(passed)
  const earned = criteria.reduce(
    (sum, c) => (passedSet.has(c.id) ? sum + c.weight : sum),
    0,
  )
  return earned / total
}

/**
 * 𝒰(T) = S(M_strong) − S(M_weak), clamped to [0,1].
 * A pair is committed iff 𝒰 ≥ τ (see loop.ts / MATH §1).
 */
export function computeUtility(strongScore: number, weakScore: number): number {
  return Math.max(0, Math.min(1, strongScore - weakScore))
}

/**
 * Cosine similarity Sim(E_new, E_j) used by the diversity gate (MATH §3).
 * Returns 0 when either vector has no direction (all-zero) to avoid NaN.
 */
export function cosineSim(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
