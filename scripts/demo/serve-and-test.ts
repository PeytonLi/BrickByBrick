/**
 * Provision an H100, load the fine-tuned adapter, and run inference tests.
 * Proves the model works by showing base vs tuned output side by side.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

function sh(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function loadEnv(): Record<string, string> {
  const p = path.join(import.meta.dirname, "..", "..", ".env.local");
  const env: Record<string, string> = {};
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+)/);
      if (m) env[m[1]] = m[2].trim();
    }
  }
  return { ...env, ...(process.env as Record<string, string>) };
}

async function main() {
  if (process.env.BBB_ALLOW_PAID_REHEARSAL !== "1") {
    console.error("Set BBB_ALLOW_PAID_REHEARSAL=1");
    process.exit(1);
  }

  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const hfToken = env.HF_TOKEN;
  if (!hfToken) throw new Error("HF_TOKEN required");
  const keyPath = (env.PRIME_SSH_KEY_PATH ?? "").replaceAll("\\", "/");
  const keyArgs = keyPath ? ["-i", keyPath] : [];
  const runName = `bbb-test-${Date.now()}`;

  // 1. Provision
  console.log("[1] Provisioning pod...");
  const provArgs = ["--plain", "pods", "create", "--name", runName, "--yes"];
  if (env.PRIME_GPU_ID) provArgs.push("--id", env.PRIME_GPU_ID);
  else provArgs.push("--gpu-type", "H100_80GB", "--gpu-count", "1");
  const provOut = sh("prime", provArgs);
  const podMatch = provOut.match(/Successfully created pod ([a-f0-9]+)/);
  if (!podMatch) throw new Error(`Cannot parse pod: ${provOut}`);
  const podId = podMatch[1];
  console.log(`  Pod: ${podId}`);

  // 2. Wait for SSH
  console.log("[2] Waiting for SSH...");
  let target = "",
    remoteDir = "",
    hostOnly = "";
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5_000));
    try {
      // Use prime ssh command to get connect info
      const statusOut = sh("prime", ["--plain", "pods", "status", podId]);
      const ipMatch = statusOut.match(/IP\s+(\S+)/);
      const sshMatch = statusOut.match(/SSH\s+(\S+@\S+)/);
      if (ipMatch && sshMatch) {
        target = `${sshMatch[1]} -p 22`;
        hostOnly = ipMatch[1];
        remoteDir = `/home/ubuntu/${runName}`;
        console.log(`  SSH: ${sshMatch[1]}`);
        break;
      }
    } catch {}
  }
  if (!target) throw new Error("Timed out waiting for SSH");

  // 3. Copy files
  console.log("[3] Copying test script...");
  sh("ssh", [...keyArgs, target, `mkdir -p ${remoteDir}`]);
  const testPy = path.join(import.meta.dirname, "test-adapter.py");
  sh("scp", [
    ...keyArgs,
    testPy,
    `root@${hostOnly}:${remoteDir}/test-adapter.py`,
  ]);

  // 4. Install deps + run test
  console.log("[4] Installing deps and running inference test...");
  const cmd = [
    "set -euo pipefail",
    "export PIP_ROOT_USER_ACTION=ignore",
    `cd ${remoteDir}`,
    "rm -rf .miniconda .py",
    `if [ ! -x .py/bin/python ]; then`,
    `  wget -q -O /tmp/miniforge.sh https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh || curl -sSL -o /tmp/miniforge.sh https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh`,
    `  bash /tmp/miniforge.sh -b -p ${remoteDir}/.miniconda`,
    `  ${remoteDir}/.miniconda/bin/conda create -y -p ${remoteDir}/.py python=3.10 pip`,
    `fi`,
    `${remoteDir}/.py/bin/python -m pip install --upgrade pip`,
    `${remoteDir}/.py/bin/python -m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cu124`,
    `${remoteDir}/.py/bin/python -m pip install --upgrade "transformers>=4.49.0" "peft>=0.14.0" "bitsandbytes>=0.45.0" "accelerate>=1.2.0"`,
    `HF_TOKEN='${hfToken}' ${remoteDir}/.py/bin/python test-adapter.py`,
  ].join(" && ");

  console.log(
    "  Running (this will take ~10 min for model download + inference)...\n",
  );

  const child = spawnSync("ssh", [...keyArgs, target, cmd], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30 * 60_000,
  });

  // Parse output
  const lines = (child.stdout || "").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line.trim());
      if (parsed.type === "comparison") {
        console.log(`\n=== Test ${parsed.test} ===`);
        console.log(`BASE:\n${parsed.base_output}\n`);
        console.log(`TUNED:\n${parsed.tuned_output}\n`);
        console.log("─".repeat(60));
      } else if (parsed.type === "inference") {
        console.log(`  [${parsed.label}] ${parsed.output.slice(0, 120)}...`);
      } else if (parsed.type === "status") {
        console.log(`  [${parsed.status}] ${parsed.prompt_preview || ""}`);
      } else if (parsed.type === "complete") {
        console.log("\n✅ Inference test complete!");
      }
    } catch {
      if (line.trim()) console.log(`  ${line.trim().slice(0, 200)}`);
    }
  }

  if (child.stderr) console.error("STDERR:", child.stderr.slice(0, 500));

  // Cleanup
  console.log(`\n[5] Terminating pod ${podId}...`);
  sh("prime", ["--plain", "pods", "terminate", podId, "--yes"]);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
