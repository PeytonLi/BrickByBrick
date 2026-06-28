import type {
  AgentEvent,
  GenerationConfig,
  TrainingPair,
  VisualTask,
} from "@brickbybrick/core";

export const demoScreenshot =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lF0QJwAAAABJRU5ErkJggg==";

export const demoTask: VisualTask = {
  id: "demo-responsive-grid",
  prompt:
    "Generate a dense pricing grid with long labels and stress it at mobile width.",
  target_mechanism: "responsive-grid",
  criteria: [
    {
      id: "no-horizontal-overflow",
      description:
        "Cards keep text inside the viewport without horizontal scrolling.",
      weight: 0.6,
    },
    {
      id: "action-visible",
      description: "Primary actions remain visible after wrapping.",
      weight: 0.4,
    },
  ],
};

export const demoPair: TrainingPair = {
  id: "demo-pair-1",
  task: demoTask,
  weak_code: '<PricingGrid columns="auto" />',
  strong_code: '<PricingGrid className="grid-cols-1 md:grid-cols-3 min-w-0" />',
  defect: {
    screenshot: demoScreenshot,
    dom_trace: "pricing-card:nth-child(3) overflowed viewport by 96px",
    category: "overflow",
    severity: "high",
  },
  u_score: 0.71,
};

export async function demoRunVisualLoop(
  config: GenerationConfig,
  emit: (event: AgentEvent) => void,
): Promise<void> {
  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const runName = `demo-gemma-${Date.now()}`;
  const events: AgentEvent[] = [
    { type: "narration", text: "Starting a stubbed visual loop stream." },
    { type: "challenge_generated", task: demoTask },
    { type: "weak_code_drafted", code: demoPair.weak_code },
    {
      type: "audit_step",
      step: {
        screenshot: demoScreenshot,
        action: "resize",
        intent: "Probe the generated UI at a narrow viewport.",
        viewport: { width: 390, height: 844 },
      },
    },
    { type: "defect_found", defect: demoPair.defect },
    {
      type: "strong_fix_generated",
      code: demoPair.strong_code,
      diff: "+ grid-cols-1 md:grid-cols-3 min-w-0",
    },
    { type: "audit_pass" },
    { type: "pair_committed", pair: demoPair, u_score: demoPair.u_score },
  ];

  for (const event of events) {
    emit(event);
    await delay(180);
  }

  if (config.max_pairs > 1) {
    emit({
      type: "recipe_mutated",
      patch: { focus_mechanism: "modal-focus-trap" },
    });
    await delay(180);
  }

  // --- Training phase: emit demo training events so the full loop closes ---
  emit({
    type: "narration",
    text: `Committed ${Math.min(1, config.max_pairs)} pair(s); launching Prime LoRA training.`,
  });
  await delay(200);

  emit({
    type: "training_event",
    status: "provisioning",
    instance: runName,
    cost_microcents: 0,
  });
  await delay(200);

  emit({
    type: "training_event",
    status: "streaming_dataset",
    cost_microcents: 18,
  });
  await delay(200);

  const losses = [2.41, 2.12, 1.86, 1.49, 1.31, 1.14];
  for (const [index, loss] of losses.entries()) {
    emit({
      type: "training_event",
      status: "training",
      instance: runName,
      cost_microcents: 18 + index * 12,
      loss: { step: index + 1, epoch: (index + 1) / losses.length, loss },
    });
    await delay(200);
  }

  emit({
    type: "training_event",
    status: "saving",
    cost_microcents: 112,
  });
  await delay(200);

  emit({
    type: "training_event",
    status: "complete",
    instance: runName,
    cost_microcents: 126,
  });

  emit({
    type: "narration",
    text: "Loop complete — committed pair(s), trained, and ready.",
  });
}
