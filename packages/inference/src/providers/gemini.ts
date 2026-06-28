import type { SolverSet } from './interface'
import { STRONG_MODEL, WEAK_MODEL, generateContent, embed as geminiEmbed } from '../gemini'

export function createGeminiSolverSet(): SolverSet {
  return {
    strongModel: STRONG_MODEL(),
    weakModel: WEAK_MODEL(),
    generate: generateContent,
    embed: geminiEmbed,
  }
}
