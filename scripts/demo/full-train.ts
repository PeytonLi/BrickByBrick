/**
 * Full training run — loads the 1515-pair seed dataset, fine-tunes Gemma 4 26B
 * via QLoRA on an H100, pushes the adapter to Hugging Face Hub, and saves all
 * loss metrics for later evaluation/visualization.
 *
 * Usage:
 *   BBB_ALLOW_PAID_REHEARSAL=1 pnpm tsx scripts/demo/full-train.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runGemmaLoraTraining } from "@brickbybrick/trainer";
import type { TrainingPair, LossPoint } from "@brickbybrick/core";

const METRICS_PATH = path.join(
  import.meta.dirname,
  "..",
  "..",
  "scripts",
  "demo",
  "loss-metrics.jsonl",
);

async function main() {
  if (process.env.BBB_ALLOW_PAID_REHEARSAL !== "1") {
    console.error(
      "Set BBB_ALLOW_PAID_REHEARSAL=1 to launch paid Prime H100 compute.",
    );
    process.exit(1);
  }

  const fixturePath = path.join(
    import.meta.dirname,
    "..",
    "..",
    "packages",
    "trainer",
    "__fixtures__",
    "demo-dataset.jsonl",
  );

  const raw = fs.readFileSync(fixturePath, "utf-8");
  const pairs: TrainingPair[] = raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  console.log(
    `[full-train] Loaded ${pairs.length} training pairs from fixture`,
  );

  const runName = `bbb-full-${Date.now()}`;
  const hubRepo = (() => {
    const base = process.env.BBB_HF_HUB_REPO;
    if (!base) return undefined;
    // Use the base name from env (e.g. "peytonali/gemma-bbb-lora") and
    // append a timestamp so each run creates a distinct versioned repo.
    return `${base}-${Date.now()}`;
  })();

  const metrics: LossPoint[] = [];
  const metricsStream = fs.createWriteStream(METRICS_PATH, { flags: "w" });

  console.log(`[full-train] Starting training run: ${runName}`);
  console.log(
    `[full-train] Pairs: ${pairs.length}, Epochs: ${process.env.BBB_TRAINING_EPOCHS ?? 3}`,
  );
  if (hubRepo) console.log(`[full-train] Hub repo: ${hubRepo}`);

  const result = await runGemmaLoraTraining(
    {
      pairs,
      runName,
      epochs: process.env.BBB_TRAINING_EPOCHS
        ? Number(process.env.BBB_TRAINING_EPOCHS)
        : undefined,
      maxSteps: process.env.BBB_TRAINING_MAX_STEPS
        ? Number(process.env.BBB_TRAINING_MAX_STEPS)
        : undefined,
      keepPod: true, // Keep pod alive for polling
      hubRepo,
      gpuId: process.env.PRIME_GPU_ID,
      gpuType: process.env.PRIME_GPU_TYPE,
      detached: true,
    },
    {
      onStatus: (status, detail) => {
        const msg = JSON.stringify({ type: "status", status, detail });
        console.log(msg);
      },
      onMetric: (point) => {
        metrics.push(point);
        metricsStream.write(JSON.stringify(point) + "\n");
        const delta =
          metrics.length > 1
            ? (point.loss - metrics[metrics.length - 2].loss).toFixed(4)
            : "—";
        console.log(
          `  [step ${String(point.step).padStart(4)}] loss=${point.loss.toFixed(4)}  Δ=${delta}  epoch=${point.epoch.toFixed(2)}`,
        );
      },
      onLog: (line) => {
        if (line) console.error(`  [log] ${line}`);
      },
    },
  );

  metricsStream.end();

  console.log("\n========================================");
  console.log("[full-train] TRAINING COMPLETE");
  console.log(`  Pod:         ${result.podId}`);
  console.log(`  Adapter:     ${result.adapterPath}`);
  console.log(`  Hub repo:    ${result.hubRepo ?? "not pushed"}`);
  console.log(`  Total steps: ${metrics.length}`);
  if (metrics.length > 1) {
    const firstLoss = metrics[0].loss;
    const lastLoss = metrics[metrics.length - 1].loss;
    const reduction = (((firstLoss - lastLoss) / firstLoss) * 100).toFixed(1);
    console.log(
      `  Loss:        ${firstLoss.toFixed(4)} → ${lastLoss.toFixed(4)} (${reduction}% reduction)`,
    );
  }
  console.log(`  Metrics:     ${METRICS_PATH}`);
  console.log("========================================\n");
}

main().catch((error) => {
  console.error(
    "Training failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
