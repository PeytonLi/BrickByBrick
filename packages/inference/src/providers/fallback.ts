import type { SolverSet } from './interface'

export interface FallbackOptions {
  /** Called when fallback is activated (for narration/logging) */
  onFallback?: (method: string, primaryError: Error) => void
  /** HTTP status codes that trigger fallback */
  retryOn?: number[]
}

export function createFallbackSolverSet(
  primary: SolverSet,
  fallback: SolverSet,
  options: FallbackOptions = {},
): SolverSet {
  const onFallback = options.onFallback
  const retryOn = new Set(options.retryOn ?? [429, 500, 502, 503, 504])

  function shouldFallback(err: unknown): boolean {
    if (err instanceof Error) {
      const statusMatch = err.message.match(/\b(\d{3})\b/)
      if (statusMatch && retryOn.has(Number(statusMatch[1]))) return true
    }
    return false
  }

  async function tryWithFallback<T>(
    method: string,
    primaryFn: () => Promise<T>,
    fallbackFn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await primaryFn()
    } catch (err) {
      if (shouldFallback(err)) {
        onFallback?.(method, err instanceof Error ? err : new Error(String(err)))
        return fallbackFn()
      }
      throw err
    }
  }

  return {
    strongModel: primary.strongModel,
    weakModel: primary.weakModel,
    generate: (model, system, user) =>
      tryWithFallback(
        'generate',
        () => primary.generate(model, system, user),
        () => fallback.generate(model, system, user),
      ),
    embed: (text) =>
      tryWithFallback(
        'embed',
        () => primary.embed(text),
        () => fallback.embed(text),
      ),
  }
}
