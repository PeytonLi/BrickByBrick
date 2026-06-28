import { runGemmaLoraTraining } from "@brickbybrick/trainer";
import type { TrainingPair } from "@brickbybrick/core";

const pair: TrainingPair = {
  id: "rehearsal-pair-1",
  task: {
    id: "rehearsal-task-1",
    prompt: "Repair a responsive card grid that overflows at mobile width.",
    target_mechanism: "responsive-grid",
    criteria: [
      {
        id: "no-overflow",
        description: "No horizontal overflow at 375px",
        weight: 1,
      },
    ],
  },
  weak_code:
    '<div className="grid grid-cols-3 gap-4"><article className="w-96">Long content</article></div>',
  defect: {
    screenshot: "",
    dom_trace: "article.w-96 exceeds viewport width",
    category: "overflow",
    severity: "high",
  },
  strong_code:
    '<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"><article className="min-w-0">Long content</article></div>',
  u_score: 1,
};

async function main() {
  if (process.env.BBB_ALLOW_PAID_REHEARSAL !== "1") {
    console.error(
      "Set BBB_ALLOW_PAID_REHEARSAL=1 to launch paid Prime H100 compute.",
    );
    process.exit(1);
  }

  const runName = `bbb-rehearsal-${Date.now()}`;
  const hubRepo = (() => {
    const base = process.env.BBB_HF_HUB_REPO;
    if (!base) return undefined;
    const slash = base.indexOf("/");
    const namespace = slash !== -1 ? base.slice(0, slash) : "peytonali";
    return `${namespace}/bbb-rehearsal-${Date.now()}`;
  })();

  const result = await runGemmaLoraTraining(
    {
      pairs: [pair],
      runName,
      maxSteps: Number(process.env.BBB_TRAINING_MAX_STEPS ?? 5),
      keepPod: process.env.BBB_KEEP_POD === "1",
      hubRepo,
    },
    {
      onStatus: (status, detail) =>
        console.log(JSON.stringify({ type: "status", status, detail })),
      onMetric: (loss) =>
        console.log(JSON.stringify({ type: "metric", ...loss })),
      onLog: (line) => {
        if (line) console.error(line);
      },
    },
  );

  console.log(JSON.stringify({ type: "complete", ...result }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
