import { randomUUID } from "node:crypto";
import {
  VisualTaskSchema,
  type AgentEvent,
  type AuditStep,
  type Defect,
  type DefectCategory,
  type GenerationConfig,
  type TrainingPair,
  type VisualTask,
} from "@brickbybrick/core";
import { computeUtility, cosineSim, scoreCriteria } from "./metrics";
import {
  embed as geminiEmbed,
  generateContent,
  strongSolver,
  weakSolver,
  STRONG_MODEL,
} from "./gemini";
import type { SolverSet } from "./providers/interface";
import {
  createInteraction,
  extractAuditSteps,
  parseAuditStepsFromText,
  frameDeltaText,
  parseAuditReport,
  destroyInteraction,
  computeCostMicrocents,
} from "./antigravity";
import {
  ANTIGRAVITY_AUDIT_SYSTEM,
  CHALLENGER_SYSTEM,
  RECIPE_SYNTHESIZER_SYSTEM,
} from "./prompts";
import { runPrimeTraining } from "./training";

/** Result of one in-sandbox visual audit (see ARCHITECTURE §5 step 3/5). */
export interface AuditResult {
  /** true iff every acceptance criterion held and no defect was found */
  passed: boolean;
  /** ids of the criteria that passed (feeds S(M,T,C)) */
  passedCriteria: string[];
  /** present iff a defect was found (i.e. !passed) */
  defect?: Defect;
  /** the screenshot trail the audit captured */
  steps: AuditStep[];
}

/**
 * Injectable dependencies for the loop. Defaults wire the real Gemini + Antigravity
 * clients; unit tests pass mocks. The `audit` dep owns audit_step emission (it
 * streams as the sandbox works); the loop emits every other AgentEvent.
 */
export interface VisualLoopDeps {
  challenge: (config: GenerationConfig) => Promise<VisualTask>;
  weakSolver: (task: VisualTask) => Promise<string>;
  strongSolver: (
    task: VisualTask,
    defect: Defect,
    weakCode: string,
  ) => Promise<string>;
  audit: (
    task: VisualTask,
    code: string,
    emit: (e: AgentEvent) => void,
  ) => Promise<AuditResult>;
  embed: (text: string) => Promise<number[]>;
  synthesizeRecipe: (
    recent: TrainingPair[],
  ) => Promise<Partial<GenerationConfig>>;
  train?: (
    pairs: TrainingPair[],
    emit: (e: AgentEvent) => void,
  ) => Promise<void>;
  newId: () => string;
  /** Called after an audit with the interactionId to tear down the sandbox (Finding F). */
  destroySandbox?: (interactionId: string) => Promise<void>;
  /** Safety cap so a run of all-rejections still terminates. */
  maxIterations?: number;
}

/** A minimal line-level diff for the strong_fix_generated event's `diff` field. */
export function makeDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const bSet = new Set(b);
  const aSet = new Set(a);
  const lines: string[] = [];
  for (const line of a) if (!bSet.has(line)) lines.push(`- ${line}`);
  for (const line of b) if (!aSet.has(line)) lines.push(`+ ${line}`);
  return lines.join("\n");
}

function applyPatch(
  config: GenerationConfig,
  patch: Partial<GenerationConfig>,
): GenerationConfig {
  return {
    ...config,
    ...patch,
    challenger_weights: patch.challenger_weights
      ? { ...config.challenger_weights, ...patch.challenger_weights }
      : config.challenger_weights,
  };
}

function failureFingerprint(task: VisualTask, defect: Defect): string {
  return `${task.target_mechanism} | ${defect.category} | ${defect.dom_trace}`;
}

/**
 * The visual break-and-fix loop (ARCHITECTURE §5). Assignable to the frozen
 * RunVisualLoop contract (the extra `deps` param is optional, so a 2-arg call is
 * valid); `deps` defaults to the live clients. See the compile-time assertion in
 * loop.test.ts.
 */
export const runVisualLoop = async (
  config: GenerationConfig,
  emit: (event: AgentEvent) => void,
  injected?: VisualLoopDeps,
): Promise<void> => {
  const deps = injected ?? defaultDeps();
  let current: GenerationConfig = { ...config };
  const committed: TrainingPair[] = [];
  const committedEmbeddings: number[][] = [];
  let consecutiveFails = 0;
  let lastFailCategory: DefectCategory | null = null;

  const maxIterations =
    deps.maxIterations ?? Math.max(50, current.max_pairs * 20);
  let iterations = 0;

  emit({
    type: "narration",
    text: `Starting visual loop — target ${current.max_pairs} pairs.`,
  });

  while (committed.length < current.max_pairs && iterations < maxIterations) {
    iterations++;

    // 1. Challenger → VisualTask
    emit({
      type: "narration",
      text: "Challenger is designing an adversarial UI task…",
    });
    const task = await deps.challenge(current);
    emit({ type: "challenge_generated", task });

    // 2. Weak / target model draft
    emit({
      type: "narration",
      text: "Weak model is drafting an implementation…",
    });
    const weakCode = await deps.weakSolver(task);
    emit({ type: "weak_code_drafted", code: weakCode });

    // 3. Audit the weak draft — it MUST fail to carry a learning signal
    emit({ type: "narration", text: "Auditing the draft in the sandbox…" });
    const weakAudit = await deps.audit(task, weakCode, emit);
    if (weakAudit.passed || !weakAudit.defect) {
      emit({ type: "pair_rejected", reason: "too_easy" });
      emit({
        type: "narration",
        text: "Weak model passed — too easy, discarding.",
      });
      continue;
    }
    const defect = weakAudit.defect;
    emit({ type: "defect_found", defect });
    const sWeak = scoreCriteria(task.criteria, weakAudit.passedCriteria);

    // 3b. Recipe Synthesizer — 3 consecutive same-category failures force a focus
    if (defect.category === lastFailCategory) consecutiveFails++;
    else {
      consecutiveFails = 1;
      lastFailCategory = defect.category;
    }
    if (consecutiveFails >= 3) {
      if (current.focus_mechanism !== task.target_mechanism) {
        const patch: Partial<GenerationConfig> = {
          focus_mechanism: task.target_mechanism,
        };
        current = applyPatch(current, patch);
        emit({ type: "recipe_mutated", patch });
        emit({
          type: "narration",
          text: `Three ${defect.category} failures in a row — focusing on ${task.target_mechanism}.`,
        });
      }
      consecutiveFails = 0;
    }

    // 4. Strong model fix
    emit({ type: "narration", text: "Strong model is repairing the defect…" });
    const strongCode = await deps.strongSolver(task, defect, weakCode);
    emit({
      type: "strong_fix_generated",
      code: strongCode,
      diff: makeDiff(weakCode, strongCode),
    });

    // 5. Re-audit the fix — it MUST pass
    emit({ type: "narration", text: "Re-auditing the fix…" });
    const strongAudit = await deps.audit(task, strongCode, emit);
    if (!strongAudit.passed) {
      emit({
        type: "narration",
        text: "Strong fix did not pass re-audit — discarding.",
      });
      continue;
    }
    emit({ type: "audit_pass" });
    const sStrong = scoreCriteria(task.criteria, strongAudit.passedCriteria);

    // 6. Utility gate: commit iff 𝒰 ≥ τ
    const u = computeUtility(sStrong, sWeak);
    if (u < current.tau) {
      emit({
        type: "narration",
        text: `Utility ${u.toFixed(2)} below τ=${current.tau} — discarding.`,
      });
      continue;
    }

    // 7. Diversity gate: reject if cosine-sim > threshold against prior failures
    const embedding = await deps.embed(failureFingerprint(task, defect));
    const redundant = committedEmbeddings.some(
      (e) => cosineSim(embedding, e) > current.diversity_threshold,
    );
    if (redundant) {
      emit({ type: "pair_rejected", reason: "redundant" });
      emit({
        type: "narration",
        text: "Failure too similar to a recent one — rejecting as redundant.",
      });
      continue;
    }

    // Commit
    const pair: TrainingPair = {
      id: deps.newId(),
      task,
      weak_code: weakCode,
      defect,
      strong_code: strongCode,
      u_score: u,
    };
    committed.push(pair);
    committedEmbeddings.push(embedding);
    emit({ type: "pair_committed", pair, u_score: u });

    // 8. Routine recipe mutation every N committed pairs
    if (committed.length % current.mutate_every_n === 0) {
      const recent = committed.slice(-current.mutate_every_n);
      const patch = await deps.synthesizeRecipe(recent);
      current = applyPatch(current, patch);
      emit({ type: "recipe_mutated", patch });
    }
  }

  if (committed.length >= current.max_pairs) {
    emit({
      type: "narration",
      text: `Committed ${committed.length} pair(s); launching Prime LoRA training.`,
    });
    await deps.train?.(committed, emit);
  } else if (committed.length === 0) {
    emit({
      type: "narration",
      text: "No pairs were committed; skipping Prime LoRA training.",
    });
  } else {
    emit({
      type: "narration",
      text: `Committed ${committed.length}/${current.max_pairs} pair(s); skipping Prime LoRA training until the batch is complete.`,
    });
  }

  emit({
    type: "narration",
    text: `Loop complete — committed ${committed.length} pair(s) in ${iterations} iteration(s).`,
  });
};

/* ------------------------------------------------------------------ */
/* Production wiring (live Gemini + Antigravity). Not exercised by unit */
/* tests, which inject mocks. Audit-verdict parsing is best-effort     */
/* against the documented Antigravity output and is re-validated by the */
/* setup spike's real fixture.                                         */
/* ------------------------------------------------------------------ */

export function buildChallengerPrompt(config: GenerationConfig): string {
  const parts = [CHALLENGER_SYSTEM];
  if (config.domain_framing)
    parts.push(`Target domain: ${config.domain_framing}`);
  if (config.framework)
    parts.push(`Implement every task for the ${config.framework} framework.`);
  if (config.focus_mechanism) {
    parts.push(
      `Focus exclusively on the UI mechanism: ${config.focus_mechanism}.`,
    );
  }
  const weighted = Object.entries(config.challenger_weights)
    .filter(([, w]) => w > 1)
    .map(([m]) => m);
  if (weighted.length)
    parts.push(`Prefer these mechanisms: ${weighted.join(", ")}.`);
  return parts.join("\n\n");
}

export function buildAuditPrompt(task: VisualTask, code: string): string {
  return `${ANTIGRAVITY_AUDIT_SYSTEM}\n\nTask:\n${task.prompt}\n\nAcceptance criteria:\n${task.criteria
    .map((c) => `- ${c.id}: ${c.description}`)
    .join("\n")}\n\nCode to audit:\n${code}`;
}

function safeJson<T>(text: string): T | null {
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

export function safeJsonExported(text: string): unknown {
  return safeJson<unknown>(text);
}

/**
 * Build the loop's AuditResult from a finished interaction: the parsed verdict
 * plus the captured thumbnail steps. The defect screenshot is the last captured
 * step (the broken state the agent ended on).
 */
function toAuditResult(
  task: VisualTask,
  steps: AuditStep[],
  report: ReturnType<typeof parseAuditReport>,
): AuditResult {
  if (report.passed) {
    return {
      passed: true,
      passedCriteria: task.criteria.map((c) => c.id),
      steps,
    };
  }
  const defect: Defect = {
    screenshot: steps[steps.length - 1]?.screenshot ?? "",
    dom_trace: report.domTrace || report.notes,
    category: (report.category as DefectCategory) ?? "other",
    severity: report.severity ?? "high",
  };
  return {
    passed: false,
    passedCriteria: report.passedCriteria,
    defect,
    steps,
  };
}

/** Live dependency set: the real Gemini + Antigravity clients. */
export function defaultDeps(opts?: { solverSet?: SolverSet }): VisualLoopDeps {
  const solver = opts?.solverSet;
  const destroySandbox = (interactionId: string) =>
    destroyInteraction(interactionId);

  return {
    challenge: async (config) => {
      const raw = solver
        ? await solver.generate(
            solver.strongModel,
            buildChallengerPrompt(config),
            "Generate one adversarial UI task now.",
          )
        : await generateContent(
            STRONG_MODEL(),
            buildChallengerPrompt(config),
            "Generate one adversarial UI task now.",
          );
      const parsed = safeJson<unknown>(raw);
      return VisualTaskSchema.parse(parsed);
    },
    weakSolver,
    strongSolver: (task, defect, weakCode) =>
      strongSolver(task, defect, weakCode),
    audit: async (task, code, emit) => {
      const prompt = `${ANTIGRAVITY_AUDIT_SYSTEM}\n\nTask:\n${task.prompt}\n\nAcceptance criteria:\n${task.criteria
        .map((c) => `- ${c.id}: ${c.description}`)
        .join("\n")}\n\nCode to audit:\n${code}`;
      // Live thumbnail streaming: emit each <<<AUDIT_STEP>>> sentinel to the UI as
      // the agent's code-execution deltas arrive, not in a burst at the end.
      let liveBuf = "";
      let emitted = 0;
      const emitNew = (steps: AuditStep[]) => {
        for (; emitted < steps.length; emitted++)
          emit({ type: "audit_step", step: steps[emitted] });
      };
      // Capture the interaction id as early as the stream reveals it so a run
      // that throws mid-stream still gets torn down (teardown keys on it).
      let interactionId = "";
      const captureId = (frame: {
        interaction?: { id?: string };
        interaction_id?: string;
      }) => {
        const id = frame.interaction?.id ?? frame.interaction_id;
        if (id && !interactionId) interactionId = id;
      };
      try {
        const interaction = await createInteraction(prompt, {
          onEvent: (frame) => {
            captureId(
              frame as {
                interaction?: { id?: string };
                interaction_id?: string;
              },
            );
            const text = frameDeltaText(frame);
            if (!text) return;
            liveBuf += text;
            emitNew(parseAuditStepsFromText(liveBuf));
          },
        });
        interactionId = interaction.id || interactionId;
        // Emit live cost from the Antigravity usage block (Finding G)
        if (interaction.usage) {
          const cost = computeCostMicrocents(interaction.usage);
          emit({ type: "training_event", cost_microcents: cost });
        }
        // Consolidated steps are authoritative; emit any the live scan missed.
        const steps = extractAuditSteps(interaction);
        emitNew(steps);
        return toAuditResult(task, steps, parseAuditReport(interaction));
      } finally {
        if (interactionId) {
          destroySandbox(interactionId).catch(() => {
            /* best-effort teardown; don't fail the audit on cleanup errors */
          });
        }
      }
    },
    destroySandbox,
    embed: solver ? solver.embed : geminiEmbed,
    synthesizeRecipe: async (recent) => {
      const raw = await generateContent(
        STRONG_MODEL(),
        RECIPE_SYNTHESIZER_SYSTEM,
        JSON.stringify(recent, null, 2),
      );
      return safeJson<Partial<GenerationConfig>>(raw) ?? {};
    },
    newId: () => randomUUID(),
    train: (pairs, emit) => {
      try {
        return runPrimeTraining(pairs, emit);
      } catch (error) {
        emit({
          type: "narration",
          text: `Training skipped: ${error instanceof Error ? error.message : String(error)}. Run locally with: BBB_ALLOW_PAID_REHEARSAL=1 pnpm tsx scripts/demo/full-train.ts`,
        });
        return Promise.resolve();
      }
    },
  };
}
