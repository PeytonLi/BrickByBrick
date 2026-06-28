// packages/inference/src/eval.ts
import { VisualTaskSchema, type AgentEvent, type EvalTaskResult, type GenerationConfig, type VisualTask } from '@brickbybrick/core'
import type { AuditReport } from './antigravity'
import { inferOnModel } from './serving'
import { generateContent, STRONG_MODEL } from './gemini'
import { createInteraction, parseAuditReport, destroyInteraction } from './antigravity'
import { buildChallengerPrompt, buildAuditPrompt, safeJsonExported } from './loop'

export interface EvalDeps {
  generateTask: (config: GenerationConfig) => Promise<VisualTask>
  inferCode: (model: 'base' | 'tuned', task: VisualTask) => Promise<string>
  auditCode: (task: VisualTask, code: string) => Promise<AuditReport>
}

export interface RunEvalArgs {
  runId: string
  config: GenerationConfig
  k: number
  baseModel: string
  tunedModel: string
}

/** S(M,T,C): sum of weights of the criteria this model's output passed. */
export function scoreFromReport(task: VisualTask, report: AuditReport): number {
  const passed = new Set(report.passedCriteria)
  return task.criteria.reduce((s, c) => s + (passed.has(c.id) ? c.weight : 0), 0)
}

export async function runEval(
  args: RunEvalArgs,
  emit: (event: AgentEvent) => void,
  deps: EvalDeps,
): Promise<void> {
  emit({ type: 'eval_started', k: args.k })
  const tasks: EvalTaskResult[] = []
  let wins = 0, ties = 0, losses = 0, deltaSum = 0, counted = 0

  for (let i = 0; i < args.k; i++) {
    const task = await deps.generateTask(args.config)
    let result: EvalTaskResult
    try {
      const [baseCode, tunedCode] = await Promise.all([
        deps.inferCode('base', task),
        deps.inferCode('tuned', task),
      ])
      const [baseReport, tunedReport] = await Promise.all([
        deps.auditCode(task, baseCode),
        deps.auditCode(task, tunedCode),
      ])
      const base_score = scoreFromReport(task, baseReport)
      const tuned_score = scoreFromReport(task, tunedReport)
      const winner: EvalTaskResult['winner'] =
        tuned_score > base_score ? 'tuned' : tuned_score < base_score ? 'base' : 'tie'
      if (winner === 'tuned') wins++
      else if (winner === 'base') losses++
      else ties++
      deltaSum += tuned_score - base_score
      counted++
      result = {
        task, base_score, tuned_score,
        base_passed_criteria: baseReport.passedCriteria,
        tuned_passed_criteria: tunedReport.passedCriteria,
        winner,
      }
    } catch {
      result = {
        task, base_score: 0, tuned_score: 0,
        base_passed_criteria: [], tuned_passed_criteria: [],
        winner: 'tie', inconclusive: true,
      }
    }
    tasks.push(result)
    emit({ type: 'eval_task_result', result })
  }

  emit({
    type: 'eval_complete',
    report: {
      runId: args.runId, k: args.k,
      base_model: args.baseModel, tuned_model: args.tunedModel,
      wins, ties, losses,
      mean_score_delta: counted ? deltaSum / counted : 0,
      tasks,
    },
  })
}

/** Live EvalDeps: Challenger for held-out tasks, vLLM for code, Antigravity for scoring. */
export function createEvalDeps(serveUrl: string, baseModel: string): EvalDeps {
  return {
    generateTask: async (config) => {
      const raw = await generateContent(
        STRONG_MODEL(),
        buildChallengerPrompt(config),
        'Generate one adversarial UI task now.',
      )
      return VisualTaskSchema.parse(safeJsonExported(raw))
    },
    inferCode: (model, task) =>
      inferOnModel(
        serveUrl,
        model === 'base' ? baseModel : 'tuned',
        `${task.prompt}\nMechanism: ${task.target_mechanism}`,
      ),
    auditCode: async (task, code) => {
      const prompt = buildAuditPrompt(task, code)
      let interactionId = ''
      try {
        const interaction = await createInteraction(prompt, {
          onEvent: (f) => {
            const id = (f as { interaction?: { id?: string } }).interaction?.id
            if (id) interactionId = id
          },
        })
        interactionId = interaction.id || interactionId
        return parseAuditReport(interaction)
      } finally {
        if (interactionId) destroyInteraction(interactionId).catch(() => {})
      }
    },
  }
}
