import { describe, it, expect } from "vitest";

import type { AgentEvent, TrainingPair, VisualTask } from "@brickbybrick/core";

import { initialAgentState, reduceAgentState } from "./store";

const screenshot =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lF0QJwAAAABJRU5ErkJggg==";

const task: VisualTask = {
  id: "task-responsive-grid",
  prompt: "Stress the responsive grid with long product names.",
  target_mechanism: "responsive-grid",
  criteria: [
    { id: "no-overflow", description: "No horizontal overflow", weight: 1 },
  ],
};

const pair: TrainingPair = {
  id: "pair-1",
  task,
  weak_code: "<Grid />",
  strong_code: '<Grid className="min-w-0" />',
  u_score: 0.72,
  defect: {
    screenshot,
    dom_trace: "div.card overflowed",
    category: "overflow",
    severity: "high",
  },
};

describe("reduceAgentState", () => {
  it("records every AgentEvent variant and keeps committed counters tied to pair_committed", () => {
    const events: AgentEvent[] = [
      { type: "challenge_generated", task },
      { type: "weak_code_drafted", code: pair.weak_code },
      {
        type: "audit_step",
        step: {
          screenshot,
          action: "resize",
          intent: "check mobile overflow",
          viewport: { width: 390, height: 844 },
        },
      },
      { type: "defect_found", defect: pair.defect },
      {
        type: "strong_fix_generated",
        code: pair.strong_code,
        diff: "+ min-w-0",
      },
      { type: "audit_pass" },
      { type: "pair_rejected", reason: "too_easy" },
      {
        type: "recipe_mutated",
        patch: { focus_mechanism: "modal-focus-trap" },
      },
      {
        type: "narration",
        text: "Rejecting the easy case and mutating the recipe.",
      },
      {
        type: "training_event",
        status: "training",
        instance: "h100-80gb-a",
        cost_microcents: 42,
      },
      { type: "pair_committed", pair, u_score: pair.u_score },
    ];

    const state = events.reduce(reduceAgentState, initialAgentState);

    expect(state.currentTask).toEqual(task);
    expect(state.weakCode).toBe(pair.weak_code);
    expect(state.latestDefect).toEqual(pair.defect);
    expect(state.strongCode).toBe(pair.strong_code);
    expect(state.latestDiff).toBe("+ min-w-0");
    expect(state.lastRejectedReason).toBeNull();
    expect(state.recipePatch).toEqual({ focus_mechanism: "modal-focus-trap" });
    expect(state.narration).toContain(
      "Rejecting the easy case and mutating the recipe.",
    );
    expect(state.training.instance).toBe("h100-80gb-a");
    expect(state.committedCount).toBe(1);
    expect(state.committedPairs).toEqual([pair]);
    expect(state.uScore).toBe(0.72);
    expect(state.lastEventType).toBe("pair_committed");
  });

  it("updates audit screenshots on audit_step", () => {
    const state = reduceAgentState(initialAgentState, {
      type: "audit_step",
      step: {
        screenshot,
        action: "click",
        intent: "open the overflow menu",
        viewport: { width: 1280, height: 720 },
      },
    });

    expect(state.latestAuditStep?.action).toBe("click");
    expect(state.latestScreenshotSrc).toBe(
      `data:image/png;base64,${screenshot}`,
    );
    expect(state.committedCount).toBe(0);
  });

  it("appends loss points on training_event", () => {
    const state = reduceAgentState(initialAgentState, {
      type: "training_event",
      status: "training",
      loss: { step: 12, epoch: 0.4, loss: 1.37 },
    });

    expect(state.training.status).toBe("training");
    expect(state.training.loss).toEqual([{ step: 12, epoch: 0.4, loss: 1.37 }]);
    expect(state.committedCount).toBe(0);
  });

  it("captures trainingRunId from the first training_event with an instance", () => {
    const state = reduceAgentState(initialAgentState, {
      type: "training_event",
      status: "provisioning",
      instance: "bbb-gemma-1719000000000",
    });

    expect(state.trainingRunId).toBe("bbb-gemma-1719000000000");
    expect(state.training.instance).toBe("bbb-gemma-1719000000000");
  });

  it("preserves trainingRunId across subsequent training events without instance", () => {
    const first = reduceAgentState(initialAgentState, {
      type: "training_event",
      status: "provisioning",
      instance: "bbb-gemma-1719000000000",
    });

    const second = reduceAgentState(first, {
      type: "training_event",
      status: "training",
      loss: { step: 1, epoch: 0.2, loss: 2.1 },
    });

    expect(second.trainingRunId).toBe("bbb-gemma-1719000000000");
    expect(second.training.loss).toEqual([{ step: 1, epoch: 0.2, loss: 2.1 }]);
  });
});

describe("reduceAgentState — intent_expanded (Feature A)", () => {
  it("records derivedConfig and sample titles", () => {
    const s = reduceAgentState(initialAgentState, {
      type: "intent_expanded",
      config: {
        intent: "react",
        framework: "react",
        challenger_weights: { "responsive-card-grid": 3 },
      },
      sample_titles: ["A", "B"],
    });
    expect(s.derivedConfig?.framework).toBe("react");
    expect(s.sampleTitles).toEqual(["A", "B"]);
  });
});

describe("reduceAgentState — eval + serving (Feature C)", () => {
  it("captures serveInfo and eval results", () => {
    let s = reduceAgentState(initialAgentState, {
      type: "model_serving",
      url: "http://x/v1",
      expires_at: "z",
      pod_id: "p",
      base_model: "g",
    });
    expect(s.serveInfo?.url).toBe("http://x/v1");
    s = reduceAgentState(s, { type: "eval_started", k: 2 });
    expect(s.evalRunning).toBe(true);
    s = reduceAgentState(s, {
      type: "eval_complete",
      report: {
        runId: "r",
        k: 2,
        base_model: "g",
        tuned_model: "tuned",
        wins: 2,
        ties: 0,
        losses: 0,
        mean_score_delta: 0.4,
        tasks: [],
      },
    });
    expect(s.evalRunning).toBe(false);
    expect(s.evalReport?.wins).toBe(2);
  });
});
