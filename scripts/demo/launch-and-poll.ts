/**
 * Launch training on pod → return immediately → poll for results.
 * The pod handles everything; this script just copies files and kicks off nohup.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

function sh(
  cmd: string,
  args: string[],
  extraEnv?: Record<string, string>,
): string {
  const r = spawnSync(cmd, args, {
    encoding: "utf-8",
    env: { ...process.env, ...extraEnv },
  });
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
  // Inject .env.local values into process.env so child processes pick them up
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const hfToken = env.HF_TOKEN;
  if (!hfToken) throw new Error("HF_TOKEN required");
  const keyPath = (env.PRIME_SSH_KEY_PATH ?? "").replace(/\\/g, "/");
  const keyArgs = keyPath ? ["-i", keyPath] : [];
  const runName = `bbb-v2-${Date.now()}`;
  const modelId = env.BBB_GEMMA_MODEL ?? "google/gemma-4-26B-A4B-it";
  const epochs = env.BBB_TRAINING_EPOCHS ?? "3";
  const hubRepo = env.BBB_HF_HUB_REPO || "";
  const gpuId = env.PRIME_GPU_ID;

  // 1. Provision
  console.log("[1] Provisioning pod...");
  const provArgs = ["--plain", "pods", "create", "--name", runName, "--yes"];
  if (gpuId) {
    provArgs.push("--id", gpuId);
  } else {
    provArgs.push("--gpu-type", "H100_80GB", "--gpu-count", "1");
  }
  const provOut = sh("prime", provArgs);
  const podMatch = provOut.match(/Successfully created pod ([a-f0-9]+)/);
  if (!podMatch) throw new Error(`Cannot parse pod: ${provOut}`);
  const podId = podMatch[1];
  console.log(`  Pod ID: ${podId}`);

  // 2. Wait for SSH
  console.log("[2] Waiting for SSH (up to 10 min)...");
  let target = "";
  let remoteDir = "";
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5_000));
    try {
      const s = JSON.parse(
        sh("prime", ["--plain", "pods", "get", podId, "--output", "json"]),
      );
      if (s.status === "ACTIVE" && s.ssh) {
        const parts = s.ssh.trim().split(/\s+/);
        const host = parts[0]; // root@1.2.3.4
        const port = parts[parts.length - 1]; // last token is port number
        target = `${host} -p ${port}`;
        remoteDir = `/home/ubuntu/${runName}`;
        console.log(`  SSH ready: ${host}:${port}`);
        break;
      }
    } catch {}
  }
  if (!target) throw new Error("Timed out waiting for pod SSH");

  // 3. Copy files
  console.log("[3] Copying files...");
  sh("ssh", [...keyArgs, target, `mkdir -p ${remoteDir}`]);

  const fixture = path.join(
    import.meta.dirname,
    "..",
    "..",
    "packages",
    "trainer",
    "__fixtures__",
    "demo-dataset.jsonl",
  );
  const hostOnly = target.split(" ")[0].replace("root@", "");

  // Extract Python trainer from the TS module
  const { GEMMA_LORA_TRAINER_PY } =
    await import("../../packages/trainer/src/remote-script");
  const pyPath = path.join(import.meta.dirname, "train_gemma_lora.py");
  fs.writeFileSync(pyPath, GEMMA_LORA_TRAINER_PY);

  sh("scp", [
    ...keyArgs,
    fixture,
    `root@${hostOnly}:${remoteDir}/dataset.jsonl`,
  ]);
  sh("scp", [
    ...keyArgs,
    pyPath,
    `root@${hostOnly}:${remoteDir}/train_gemma_lora.py`,
  ]);
  console.log("  Files copied.");

  // 4. Launch training with nohup
  console.log("[4] Launching detached training...");
  const pushFlag = hubRepo ? ` --push-to-hub '${hubRepo}'` : "";
  const launchCmd = [
    `cd ${remoteDir}`,
    "rm -rf .miniconda .py",
    "( test -x .py/bin/python || (",
    "  wget -q -O /tmp/miniforge.sh https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh || curl -sSL -o /tmp/miniforge.sh https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh",
    `  bash /tmp/miniforge.sh -b -p ${remoteDir}/.miniconda`,
    `  ${remoteDir}/.miniconda/bin/conda create -y -p ${remoteDir}/.py python=3.10 pip`,
    "))",
    "export PIP_ROOT_USER_ACTION=ignore",
    `${remoteDir}/.py/bin/python -m pip install --upgrade pip`,
    `${remoteDir}/.py/bin/python -m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cu124`,
    `${remoteDir}/.py/bin/python -m pip install --upgrade "transformers>=4.49.0" "datasets>=3.0.0" "accelerate>=1.2.0" "peft>=0.14.0" "trl>=0.25.0" "bitsandbytes>=0.45.0" "pillow>=11.0.0" "huggingface_hub>=0.27.0"`,
    `export HF_TOKEN='${hfToken}'`,
    `nohup ${remoteDir}/.py/bin/python train_gemma_lora.py --dataset dataset.jsonl --output adapter --model '${modelId}' --epochs ${epochs}${pushFlag} > ${remoteDir}/training.log 2>&1 &`,
    `echo "PID=$!" > ${remoteDir}/train.pid`,
    `echo "LAUNCHED"`,
  ].join(" && ");

  const result = sh("ssh", [...keyArgs, target, launchCmd]);
  console.log(`  ${result}`);

  // Save pod info for polling
  const infoPath = path.join(import.meta.dirname, "pod-info.json");
  fs.writeFileSync(
    infoPath,
    JSON.stringify(
      {
        podId,
        target,
        remoteDir,
        keyArgs,
        hostOnly,
        runName,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`\n========================================`);
  console.log(`Training launched on pod ${podId}`);
  console.log(
    `Monitor: ssh ${keyArgs.join(" ")} ${target} 'tail -f ${remoteDir}/training.log'`,
  );
  console.log(
    `Get metrics: ssh ${keyArgs.join(" ")} ${target} "grep '\\"type\\":\\"metric\\"' ${remoteDir}/training.log | tail -5"`,
  );
  console.log(`Pod info saved: scripts/demo/pod-info.json`);
  console.log(`========================================`);
  console.log(`\nRun the poll script to track progress:`);
  console.log(`  pnpm tsx scripts/demo/poll-training.ts`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
