import { describe, it, expect } from 'vitest'
import {
  CHALLENGER_SYSTEM,
  WEAK_SOLVER_SYSTEM,
  STRONG_SOLVER_SYSTEM,
  ANTIGRAVITY_AUDIT_SYSTEM,
  RECIPE_SYNTHESIZER_SYSTEM,
} from './prompts'

describe('prompts are all present and non-trivial', () => {
  it.each([
    ['CHALLENGER_SYSTEM', CHALLENGER_SYSTEM],
    ['WEAK_SOLVER_SYSTEM', WEAK_SOLVER_SYSTEM],
    ['STRONG_SOLVER_SYSTEM', STRONG_SOLVER_SYSTEM],
    ['ANTIGRAVITY_AUDIT_SYSTEM', ANTIGRAVITY_AUDIT_SYSTEM],
    ['RECIPE_SYNTHESIZER_SYSTEM', RECIPE_SYNTHESIZER_SYSTEM],
  ])('%s is a substantial string', (_name, value) => {
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(80)
  })
})

describe('CHALLENGER_SYSTEM', () => {
  it('asks for a JSON visual task with criteria and a target mechanism', () => {
    expect(CHALLENGER_SYSTEM).toMatch(/json/i)
    expect(CHALLENGER_SYSTEM).toMatch(/criteria/i)
    expect(CHALLENGER_SYSTEM).toMatch(/mechanism/i)
  })
})

describe('WEAK_SOLVER_SYSTEM', () => {
  it('asks for front-end UI code without extra hardening', () => {
    expect(WEAK_SOLVER_SYSTEM).toMatch(/react|html|css|component/i)
  })
})

describe('STRONG_SOLVER_SYSTEM', () => {
  it('frames the task as fixing the reported visual defect', () => {
    expect(STRONG_SOLVER_SYSTEM).toMatch(/fix|repair|correct/i)
    expect(STRONG_SOLVER_SYSTEM).toMatch(/defect|bug|issue/i)
  })
})

describe('ANTIGRAVITY_AUDIT_SYSTEM — the in-sandbox visual auditor', () => {
  it('instructs serving on :3000', () => {
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/3000/)
  })
  it('instructs opening a browser and resizing to mobile widths', () => {
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/browser/i)
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/mobile|resize|375|viewport/i)
  })
  it('instructs injecting fringe / boundary input data', () => {
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/fringe|boundary|edge/i)
  })
  it('instructs at least five exploratory clicks', () => {
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/\b5\b|five/i)
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/click/i)
  })
  it('instructs capturing screenshots and a DOM trace of defects', () => {
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/screenshot/i)
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/dom/i)
  })
  it('names the defect classes to watch for', () => {
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/collision|overflow|frozen/i)
  })
  it('requires a pass/fail verdict', () => {
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/pass/i)
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/fail/i)
  })

  // The real API carries no screenshots inline; we get them via our sentinel
  // protocol (live base64 thumbnails) + saved full-res PNG files. The prompt is
  // the contract that antigravity.ts's extractAuditSteps / parseAuditReport parse.
  it('teaches the live thumbnail sentinel with a base64 thumbnail', () => {
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toContain('<<<AUDIT_STEP>>>')
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toContain('<<<END>>>')
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/base64/i)
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/thumbnail/i)
  })
  it('requires the structured VERDICT block with category + severity', () => {
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toContain('<<<VERDICT>>>')
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/passed_criteria/)
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/failed_criteria/)
  })
  it('tells the agent to save full-resolution PNG screenshots as files', () => {
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/\.png/i)
    expect(ANTIGRAVITY_AUDIT_SYSTEM).toMatch(/save|write/i)
  })
})

describe('RECIPE_SYNTHESIZER_SYSTEM', () => {
  it('asks for a JSON config patch that can refocus generation', () => {
    expect(RECIPE_SYNTHESIZER_SYSTEM).toMatch(/json/i)
    expect(RECIPE_SYNTHESIZER_SYSTEM).toMatch(/mechanism|focus|weight/i)
  })
})
