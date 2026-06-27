import { describe, it, expect } from 'vitest'
import {
  GenerationConfigSchema,
  type AgentEvent,
  type AgentEventType,
  type AuditStep,
  type Defect,
  type GenerationConfig,
  type RunVisualLoop,
  type VisualTask,
} from '@brickbybrick/core'
import { runVisualLoop, makeDiff, type VisualLoopDeps, type AuditResult } from './loop'

// Compile-time proof the entry matches the frozen contract.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _contract: RunVisualLoop = runVisualLoop

const task: VisualTask = {
  id: 'grid-1',
  prompt: 'Build a responsive product card grid.',
  target_mechanism: 'responsive-card-grid',
  criteria: [
    { id: 'a', description: 'no overflow at 375px', weight: 0.5 },
    { id: 'b', description: 'cards wrap', weight: 0.5 },
  ],
}

const defect = (category: Defect['category'] = 'overflow'): Defect => ({
  screenshot: 'PNG',
  dom_trace: 'trace',
  category,
  severity: 'high',
})

const auditStep: AuditStep = {
  screenshot: 'PNG',
  action: 'resize',
  intent: 'mobile',
  viewport: { width: 375, height: 812 },
}

function cfg(over: Partial<GenerationConfig> = {}): GenerationConfig {
  return GenerationConfigSchema.parse(over)
}

function collect() {
  const events: AgentEvent[] = []
  return { events, emit: (e: AgentEvent) => events.push(e) }
}

const types = (events: AgentEvent[], ...keep: AgentEventType[]) =>
  events.filter((e) => keep.includes(e.type)).map((e) => e.type)

/**
 * Base mock deps producing one committable pair: weak code fails the audit with
 * a defect (S_weak=0), strong code passes (S_strong=1) ⇒ 𝒰=1. Each call gets a
 * distinct orthogonal embedding so the diversity gate never trips by default.
 */
function makeDeps(over: Partial<VisualLoopDeps> = {}): VisualLoopDeps {
  let embedCall = 0
  let idCall = 0
  return {
    challenge: async () => task,
    weakSolver: async () => 'WEAK',
    strongSolver: async () => 'STRONG',
    audit: async (_task, code, emit): Promise<AuditResult> => {
      emit({ type: 'audit_step', step: auditStep })
      if (code === 'WEAK') {
        return { passed: false, passedCriteria: [], defect: defect(), steps: [auditStep] }
      }
      return { passed: true, passedCriteria: ['a', 'b'], steps: [auditStep] }
    },
    embed: async () => {
      const v = new Array(64).fill(0)
      v[embedCall++ % 64] = 1
      return v
    },
    synthesizeRecipe: async () => ({}),
    newId: () => `pair-${++idCall}`,
    ...over,
  }
}

describe('runVisualLoop — event ordering (ARCHITECTURE §5 happy path)', () => {
  it('emits the structural events in order and streams audit steps + narration', async () => {
    const { events, emit } = collect()
    await runVisualLoop(cfg({ max_pairs: 1 }), emit, makeDeps())

    expect(
      types(
        events,
        'challenge_generated',
        'weak_code_drafted',
        'defect_found',
        'strong_fix_generated',
        'audit_pass',
        'pair_committed',
      ),
    ).toEqual([
      'challenge_generated',
      'weak_code_drafted',
      'defect_found',
      'strong_fix_generated',
      'audit_pass',
      'pair_committed',
    ])

    expect(events.some((e) => e.type === 'audit_step')).toBe(true)
    expect(events.some((e) => e.type === 'narration')).toBe(true)

    // audit steps for the weak draft arrive before the defect is reported
    const firstAuditStep = events.findIndex((e) => e.type === 'audit_step')
    const defectIdx = events.findIndex((e) => e.type === 'defect_found')
    expect(firstAuditStep).toBeGreaterThanOrEqual(0)
    expect(firstAuditStep).toBeLessThan(defectIdx)
  })

  it('commits a pair carrying the real 𝒰 score', async () => {
    const { events, emit } = collect()
    await runVisualLoop(cfg({ max_pairs: 1 }), emit, makeDeps())
    const committed = events.find((e) => e.type === 'pair_committed')
    expect(committed).toBeDefined()
    if (committed?.type === 'pair_committed') {
      expect(committed.u_score).toBeCloseTo(1, 10)
      expect(committed.pair.weak_code).toBe('WEAK')
      expect(committed.pair.strong_code).toBe('STRONG')
      expect(committed.pair.defect.category).toBe('overflow')
    }
  })
})

describe('filter gate — weak pass ⇒ too_easy', () => {
  it('rejects as too_easy and never reports a defect or commits', async () => {
    const { events, emit } = collect()
    const deps = makeDeps({
      // weak code passes the audit: no learning signal
      audit: async (_t, _code, emit): Promise<AuditResult> => {
        emit({ type: 'audit_step', step: auditStep })
        return { passed: true, passedCriteria: ['a', 'b'], steps: [auditStep] }
      },
      maxIterations: 3,
    })
    await runVisualLoop(cfg({ max_pairs: 1 }), emit, deps)

    const rejected = events.filter(
      (e) => e.type === 'pair_rejected' && e.reason === 'too_easy',
    )
    expect(rejected.length).toBe(3)
    expect(events.some((e) => e.type === 'defect_found')).toBe(false)
    expect(events.some((e) => e.type === 'pair_committed')).toBe(false)
  })
})

describe('utility gate — commit boundary at τ', () => {
  it('commits when 𝒰 == τ (inclusive boundary)', async () => {
    const { events, emit } = collect()
    const deps = makeDeps({
      audit: async (_t, code, emit): Promise<AuditResult> => {
        emit({ type: 'audit_step', step: auditStep })
        if (code === 'WEAK')
          return { passed: false, passedCriteria: ['a'], defect: defect(), steps: [auditStep] } // S_weak=0.5
        return { passed: true, passedCriteria: ['a', 'b'], steps: [auditStep] } // S_strong=1 ⇒ 𝒰=0.5
      },
    })
    await runVisualLoop(cfg({ max_pairs: 1, tau: 0.5 }), emit, deps)
    const committed = events.find((e) => e.type === 'pair_committed')
    expect(committed).toBeDefined()
    if (committed?.type === 'pair_committed') expect(committed.u_score).toBeCloseTo(0.5, 10)
  })

  it('discards (no commit, no reject) when 𝒰 < τ, after a passing re-audit', async () => {
    const { events, emit } = collect()
    const deps = makeDeps({
      audit: async (_t, code, emit): Promise<AuditResult> => {
        emit({ type: 'audit_step', step: auditStep })
        if (code === 'WEAK')
          return { passed: false, passedCriteria: ['a'], defect: defect(), steps: [auditStep] } // S_weak=0.5
        return { passed: true, passedCriteria: ['a', 'b'], steps: [auditStep] } // 𝒰=0.5
      },
      maxIterations: 2,
    })
    await runVisualLoop(cfg({ max_pairs: 1, tau: 0.6 }), emit, deps) // 0.5 < 0.6
    expect(events.some((e) => e.type === 'audit_pass')).toBe(true) // reached the τ gate
    expect(events.some((e) => e.type === 'pair_committed')).toBe(false)
    expect(events.some((e) => e.type === 'pair_rejected')).toBe(false)
  })
})

describe('diversity gate — cosine > 0.82 ⇒ redundant', () => {
  it('commits the first failure but rejects an identical one as redundant', async () => {
    const { events, emit } = collect()
    const deps = makeDeps({
      embed: async () => [1, 0, 0], // every failure embeds identically ⇒ cosine 1
      maxIterations: 3,
    })
    await runVisualLoop(cfg({ max_pairs: 2 }), emit, deps)

    expect(events.filter((e) => e.type === 'pair_committed').length).toBe(1)
    expect(
      events.filter((e) => e.type === 'pair_rejected' && e.reason === 'redundant').length,
    ).toBeGreaterThanOrEqual(1)
  })
})

describe('recipe mutation cadence', () => {
  it('fires a routine recipe_mutated every N committed pairs', async () => {
    const { events, emit } = collect()
    let cat = 0
    // vary the defect category each iteration so the 3-consecutive rule never trips
    const cats: Defect['category'][] = ['overflow', 'truncation', 'layout_collision', 'offscreen_render']
    const deps = makeDeps({
      audit: async (_t, code, emit): Promise<AuditResult> => {
        emit({ type: 'audit_step', step: auditStep })
        if (code === 'WEAK')
          return { passed: false, passedCriteria: [], defect: defect(cats[cat++ % cats.length]), steps: [auditStep] }
        return { passed: true, passedCriteria: ['a', 'b'], steps: [auditStep] }
      },
      synthesizeRecipe: async () => ({ challenger_weights: { 'responsive-card-grid': 2 } }),
    })
    await runVisualLoop(cfg({ max_pairs: 4, mutate_every_n: 2 }), emit, deps)

    const mutations = events.filter((e) => e.type === 'recipe_mutated')
    expect(mutations.length).toBe(2) // after the 2nd and 4th commit
    for (const m of mutations) {
      if (m.type === 'recipe_mutated') expect(m.patch.challenger_weights).toBeDefined()
    }
  })

  it('forces a focus mutation after 3 consecutive same-category failures', async () => {
    const { events, emit } = collect()
    const deps = makeDeps({
      // always the same defect category ⇒ 3 in a row should force a focus mutation
      audit: async (_t, code, emit): Promise<AuditResult> => {
        emit({ type: 'audit_step', step: auditStep })
        if (code === 'WEAK')
          return { passed: false, passedCriteria: [], defect: defect('overflow'), steps: [auditStep] }
        return { passed: true, passedCriteria: ['a', 'b'], steps: [auditStep] }
      },
    })
    await runVisualLoop(cfg({ max_pairs: 5, mutate_every_n: 99 }), emit, deps)

    const focusMutation = events.find(
      (e) => e.type === 'recipe_mutated' && e.patch.focus_mechanism === 'responsive-card-grid',
    )
    expect(focusMutation).toBeDefined()
  })
})

describe('strong fix that fails re-audit is discarded', () => {
  it('does not commit when the strong re-audit fails', async () => {
    const { events, emit } = collect()
    const deps = makeDeps({
      audit: async (_t, _code, emit): Promise<AuditResult> => {
        emit({ type: 'audit_step', step: auditStep })
        // both weak and strong fail the audit
        return { passed: false, passedCriteria: [], defect: defect(), steps: [auditStep] }
      },
      maxIterations: 2,
    })
    await runVisualLoop(cfg({ max_pairs: 1 }), emit, deps)
    expect(events.some((e) => e.type === 'audit_pass')).toBe(false)
    expect(events.some((e) => e.type === 'pair_committed')).toBe(false)
  })
})

describe('makeDiff', () => {
  it('marks removed and added lines', () => {
    const d = makeDiff('const a = 1\nconst b = 2', 'const a = 1\nconst b = 3')
    expect(d).toMatch(/-.*const b = 2/)
    expect(d).toMatch(/\+.*const b = 3/)
  })
})
