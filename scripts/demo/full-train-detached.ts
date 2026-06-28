/**
 * Full training run — DETACHED MODE.
 * Launches training in background on the pod and polls for metrics via SSH.
 * This avoids the SSH timeout issue from long-running training sessions.
 *
 * Usage:
 *   BBB_ALLOW_PAID_REHEARSAL=1 pnpm tsx scripts/demo/full-train-detached.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

// --- Config ---
const METRICS_PATH = path.join(import.meta.dirname, "loss-metrics.jsonl");

function loadEnv(): Record<string, string> {
  const envPath = path.join(import.meta.dirname, "..", "..", ".env.local");
  const env: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+)/);
      if (m) env[m[1]] = m[2].trim();
    }
  }
  return { ...env, ...process.env as Record<string, string> };
}

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf-8", shell: false });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

async function main() {
  if (process.env.BBB_ALLOW_PAID_REHEARSAL !== "1") {
    console.error("Set BBB_ALLOW_PAID_REHEARSAL=1 to launch paid compute.");
    process.exit(1);
  }

  const env = loadEnv();
  const hfToken = env.HF_TOKEN;
  if (!hfToken) throw new Error("HF_TOKEN required");

  const runName = `bbb-detached-${Date.now()}`;
  const modelId = env.BBB_GEMMA_MODEL ?? "google/gemma-4-26B-A4B-it";
  const epochs = Number(env.BBB_TRAINING_EPOCHS ?? 3);
  const hubRepo = env.BBB_HF_HUB_REPO?.trim() || undefined;

  // 1. Provision pod
  console.log("[1/5] Provisioning H100 pod...");
  const gpuId = env.PRIME_GPU_ID;
  const provisionArgs = ["--plain", "pods", "create", "--name", runName, "--yes"];
  if (gpuId) provisionArgs.push("--id", gpuId);
  const provOut = run("prime", provisionArgs);
  const podMatch = provOut.match(/Successfully created pod ([a-f0-9]+)/);
  if (!podMatch) throw new Error(`Could not parse pod id from: ${provOut}`);
  const podId = podMatch[1];
  console.log(`  Pod: ${podId}`);

  // 2. Wait for SSH
  console.log("[2/5] Waiting for SSH...");
  const keyPath = env.PRIME_SSH_KEY_PATH?.replace(/\/g, "/") ?? "";
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    try {
      const status = JSON.parse(run("prime", ["--plain", "pods", "get", podId, "--output", "json"]));
      if (status.status === "ACTIVE" && status.ssh) {
        const parts = status.ssh.split(" ");
        const host = parts[0];
        const port = parts[parts.length - 1];
        const remoteDir = `/home/ubuntu/${runName}`;

        // 3. Copy files
        console.log("[3/5] Copying dataset and trainer...");
        const sshBase = keyPath ? ["-i", keyPath] : [];
        const target = `${host} -p ${port}`;

        run("ssh", [...sshBase, target, `mkdir -p ${remoteDir}`]);

        // Build scp args
        const scpBase = keyPath ? ["-i", keyPath] : [];
        const fixturePath = path.join(import.meta.dirname, "..", "..", "packages", "trainer", "__fixtures__", "demo-dataset.jsonl");
        const scriptPath = path.join(import.meta.dirname, "..", "..", "packages", "trainer", "src", "remote-script.ts");
        const shellPath = path.join(import.meta.dirname, "pod-train.sh");

        run("scp", [...scpBase, fixturePath, `root@${host.split("@").pop()}:${remoteDir}/dataset.jsonl`]);
        // We need the actual .py trainer, not the TS wrapper. Use the GEMMA_LORA_TRAINER_PY export
        // For now, we'll extract it from the built module
        const { GEMMA_LORA_TRAINER_PY } = await import("@brickbybrick/trainer/src/remote-script");
        fs.writeFileSync(path.join(import.meta.dirname, "train_gemma_lora.py"), GEMMA_LORA_TRAINER_PY);
        run("scp", [...scpBase, path.join(import.meta.dirname, "train_gemma_lora.py"), `root@${host.split("@").pop()}:${remoteDir}/train_gemma_lora.py`]);
        run("scp", [...scpBase, shellPath, `root@${host.split("@").pop()}:${remoteDir}/pod-train.sh`]);

        // 4. Launch detached training
        console.log("[4/5] Launching training (detached)...");
        const hubArg = hubRepo ? `'${hubRepo}'` : `''`;
        run("ssh", [...sshBase, target, `bash ${remoteDir}/pod-train.sh ${remoteDir} '${hfToken}' '${modelId}' ${epochs} ${hubArg}`]);

        // 5. Poll for metrics
        console.log("[5/5] Polling for training progress...\n");
        const metricsStream = fs.createWriteStream(METRICS_PATH, { flags: "w" });
        let lastStep = -1;
        let trainingDone = false;

        while (!trainingDone) {
          await new Promise(r => setTimeout(r, 30_000));
          try {
            const logTail = run("ssh", [...sshBase, target, `tail -3 ${remoteDir}/training.log 2>/dev/null || echo ""`]);
            const lines = logTail.trim().split("\n").filter(Boolean);

            for (const line of lines) {
              try {
                const parsed = JSON.parse(line.trim());
                if (parsed.type === "metric" && parsed.step > lastStep) {
                  lastStep = parsed.step;
                  const point = { step: parsed.step, loss: parsed.loss, epoch: parsed.epoch ?? 0 };
                  metricsStream.write(JSON.stringify(point) + "\n");
                  const delta = lastStep > 1 ? "" : "";
                  console.log(`  [step ${String(point.step).padStart(4)}] loss=${point.loss.toFixed(4)}  epoch=${point.epoch.toFixed(2)}`);
                }
                if (parsed.type === "complete") {
                  trainingDone = true;
                  console.log("  Training complete!");
                }
                if (parsed.type === "error") {
                  console.error(`  ERROR: ${parsed.message}`);
                  trainingDone = true;
                }
              } catch {}
            }

            // Also check training status
            const statusCheck = run("ssh", [...sshBase, target, `cat ${remoteDir}/train.pid 2>/dev/null || echo "NO_PID"`]);
            if (statusCheck.includes("NO_PID")) {
              trainingDone = true;
            } else {
              const pid = statusCheck.match(/TRAIN_PID=(\d+)/)?.[1];
              if (pid) {
                const alive = run("ssh", [...sshBase, target, `kill -0 ${pid} 2>/dev/null && echo ALIVE || echo DEAD`]).trim();
                if (alive === "DEAD") {
                  trainingDone = true;
                  console.log("  Training process exited.");
                }
              }
            }
          } catch (e: any) {
            console.error(`  Poll error: ${e.message}`);
          }
        }

        metricsStream.end();
        console.log(`\nMetrics saved to: ${METRICS_PATH}`);
        console.log(`Pod ${podId} still active. adapter at: ${remoteDir}/adapter`);
        console.log("Run: prime pods terminate " + podId + " --yes  to clean up");
        return;
      }
    } catch {}
  }
  throw new Error("Timed out waiting for pod SSH");
}

main().catch((error) => {
  console.error("Training failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
