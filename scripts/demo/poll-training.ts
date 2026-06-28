/**
 * Poll an already-launched training pod for metrics.
 * Reads pod-info.json from launch-and-poll.ts.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

interface PodInfo {
  podId: string;
  target: string;
  remoteDir: string;
  keyArgs: string[];
  hostOnly: string;
  runName: string;
  createdAt: string;
}

function sh(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf-8" });
  if (r.status !== 0) return `ERROR: ${r.stderr || r.stdout}`;
  return r.stdout.trim();
}

async function main() {
  const infoPath = path.join(import.meta.dirname, "pod-info.json");
  if (!fs.existsSync(infoPath)) {
    console.error("No pod-info.json found. Run launch-and-poll.ts first.");
    process.exit(1);
  }

  const info: PodInfo = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
  console.log(`Polling pod ${info.podId} (launched ${info.createdAt})`);
  console.log(`SSH: ${info.target}`);
  console.log();

  const metricsPath = path.join(import.meta.dirname, "loss-metrics.jsonl");
  const metricsStream = fs.createWriteStream(metricsPath, { flags: "w" });
  let lastStep = -1;
  let consecutiveErrors = 0;
  const MAX_ERRORS = 5;

  while (true) {
    await new Promise(r => setTimeout(r, 30_000));

    // Check if training process is alive
    const pidCheck = sh("ssh", [...info.keyArgs, info.target, `cat ${info.remoteDir}/train.pid 2>/dev/null || echo ""`]);
    if (!pidCheck) {
      console.log("No train.pid file yet (still setting up environment)...");
      continue;
    }

    const pidMatch = pidCheck.match(/PID=(\d+)/);
    if (!pidMatch) {
      console.log(`train.pid content: ${pidCheck}`);
      continue;
    }

    const pid = pidMatch[1];
    const alive = sh("ssh", [...info.keyArgs, info.target, `kill -0 ${pid} 2>/dev/null && echo ALIVE || echo DEAD`]);

    // Get latest metrics
    try {
      const metricsRaw = sh("ssh", [...info.keyArgs, info.target,
        `grep '"type":"metric"' ${info.remoteDir}/training.log 2>/dev/null | tail -5 || echo ""`
      ]);

      if (metricsRaw && metricsRaw !== "ERROR:") {
        consecutiveErrors = 0;
        const lines = metricsRaw.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.trim());
            if (parsed.step > lastStep) {
              lastStep = parsed.step;
              const point = { step: parsed.step, loss: parsed.loss, epoch: parsed.epoch ?? 0 };
              metricsStream.write(JSON.stringify(point) + "\n");
              const time = new Date().toLocaleTimeString();
              console.log(`  [${time}] step ${String(point.step).padStart(4)} | loss=${point.loss.toFixed(4)} | epoch=${point.epoch.toFixed(2)}`);
            }
          } catch {}
        }
      }

      // Check for completion
      const completeCheck = sh("ssh", [...info.keyArgs, info.target,
        `grep '"type":"complete"' ${info.remoteDir}/training.log 2>/dev/null || echo ""`
      ]);
      if (completeCheck && completeCheck !== "ERROR:") {
        console.log("\n========================================");
        console.log("TRAINING COMPLETE!");
        console.log(`  Pod:     ${info.podId}`);
        console.log(`  Adapter: ${info.remoteDir}/adapter`);
        console.log(`  Metrics: ${metricsPath}`);
        console.log("========================================");

        // Get final status
        const finalLines = sh("ssh", [...info.keyArgs, info.target,
          `grep '"type":"status"' ${info.remoteDir}/training.log 2>/dev/null | tail -3 || echo ""`
        ]);
        console.log(`  Final status: ${finalLines}`);
        break;
      }

      // Check for errors
      const errorCheck = sh("ssh", [...info.keyArgs, info.target,
        `grep '"type":"error"' ${info.remoteDir}/training.log 2>/dev/null | tail -1 || echo ""`
      ]);
      if (errorCheck && errorCheck !== "ERROR:") {
        console.error(`\n  TRAINING ERROR: ${errorCheck}`);
      }

    } catch (e: any) {
      consecutiveErrors++;
      console.error(`  Poll error (${consecutiveErrors}/${MAX_ERRORS}): ${e.message}`);
    }

    if (alive === "DEAD") {
      console.log("\n  Training process exited. Checking final log...");
      const tail = sh("ssh", [...info.keyArgs, info.target,
        `tail -10 ${info.remoteDir}/training.log 2>/dev/null || echo ""`
      ]);
      console.log(`  Final log tail: ${tail}`);
      break;
    }

    if (consecutiveErrors >= MAX_ERRORS) {
      console.error(`\n  Too many consecutive errors (${MAX_ERRORS}). Stopping poll.`);
      console.log(`  Pod ${info.podId} is still running. Check manually.`);
      break;
    }
  }

  metricsStream.end();
  console.log(`\nTo terminate pod: prime pods terminate ${info.podId} --yes`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
