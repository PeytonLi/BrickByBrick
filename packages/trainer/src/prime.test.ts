import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { Readable } from "stream";
import {
  provisionPod,
  getPodStatus,
  parseSshTarget,
  streamMetrics,
  terminatePod,
  internalPrimeTestUtils,
} from "./prime";
import { GEMMA_LORA_TRAINER_PY } from "./remote-script";

vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}));

const mockSpawnSync = vi.mocked(spawnSync);
const mockSpawn = vi.mocked(spawn);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PRIME_GPU_ID;
  mockSpawnSync.mockReturnValue({
    status: 0,
    stdout: "",
    stderr: "",
  } as ReturnType<typeof spawnSync>);
});

describe("provisionPod", () => {
  it("creates a noninteractive H100 pod and parses the pod id", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout:
        "Pod Configuration Summary:\nSuccessfully created pod 5b6eb4f0cbf3436ab7e1e10bc157893d\n",
      stderr: "",
    } as ReturnType<typeof spawnSync>);

    const result = provisionPod({ name: "bbb-lora", gpu_id: "6bd7c8" });

    expect(result).toEqual({ podId: "5b6eb4f0cbf3436ab7e1e10bc157893d" });
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "prime",
      expect.arrayContaining([
        "--plain",
        "pods",
        "create",
        "--id",
        "6bd7c8",
        "--name",
        "bbb-lora",
        "--yes",
      ]),
      expect.any(Object),
    );
  });

  it("selects the cheapest available 1x H100 id when no specific GPU id is provided", () => {
    mockSpawnSync
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          gpu_resources: [
            {
              id: "expensive",
              gpu_count: 1,
              price_value: 4.29,
              stock_status: "Available",
            },
            {
              id: "cheap",
              gpu_count: 1,
              price_value: 2.35,
              stock_status: "Available",
            },
            {
              id: "multi",
              gpu_count: 2,
              price_value: 4.7,
              stock_status: "Available",
            },
          ],
        }),
        stderr: "",
      } as ReturnType<typeof spawnSync>)
      .mockReturnValueOnce({
        status: 0,
        stdout: "Successfully created pod pod-h100\n",
        stderr: "",
      } as ReturnType<typeof spawnSync>);

    provisionPod({ name: "bbb-lora", gpu_type: "H100_80GB" });

    expect(mockSpawnSync).toHaveBeenCalledWith(
      "prime",
      expect.arrayContaining([
        "availability",
        "list",
        "--gpu-type",
        "H100_80GB",
        "--output",
        "json",
      ]),
      expect.any(Object),
    );
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "prime",
      expect.arrayContaining(["pods", "create", "--id", "cheap"]),
      expect.any(Object),
    );
  });
});

describe("pod status and SSH parsing", () => {
  it("parses pod status JSON", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        id: "pod-1",
        status: "ACTIVE",
        ssh: "root@example.com -p 2222",
      }),
      stderr: "",
    } as ReturnType<typeof spawnSync>);

    expect(getPodStatus("pod-1")).toEqual({
      id: "pod-1",
      status: "ACTIVE",
      ssh: "root@example.com -p 2222",
    });
  });

  it("converts Prime SSH text into host, port, and key path", () => {
    expect(parseSshTarget("root@example.com -p 2222", "/tmp/key")).toEqual({
      host: "root@example.com",
      port: "2222",
      keyPath: "/tmp/key",
    });
  });
});

describe("streamMetrics", () => {
  function fakeChild(stdout: string, code = 0): ChildProcess {
    const stdoutStream = new Readable({
      read() {
        this.push(stdout);
        this.push(null);
      },
    });
    const stderrStream = new Readable({
      read() {
        this.push(null);
      },
    });
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    const child = {
      stdout: stdoutStream,
      stderr: stderrStream,
      on(event: string, fn: (...args: unknown[]) => void) {
        (listeners[event] ??= []).push(fn);
        return child;
      },
    } as unknown as ChildProcess;

    setImmediate(() => {
      (listeners.close ?? []).forEach((fn) => fn(code));
    });
    return child;
  }

  it("parses Prime Hosted Training metrics JSON", async () => {
    mockSpawn.mockReturnValue(
      fakeChild(
        JSON.stringify({
          metrics: [
            { step: 1, loss: 2.4, epoch: 0 },
            { step: 2, train_loss: 2.1 },
          ],
        }),
      ),
    );

    const points: Array<{ step: number; loss: number; epoch: number }> = [];
    await streamMetrics("run-1", (point) => points.push(point));

    expect(points).toEqual([
      { step: 1, loss: 2.4, epoch: 0 },
      { step: 2, loss: 2.1, epoch: 0 },
    ]);
  });
});

describe("terminatePod", () => {
  it("terminates pods without prompting", () => {
    terminatePod("pod-1");

    expect(mockSpawnSync).toHaveBeenCalledWith(
      "prime",
      expect.arrayContaining(["pods", "terminate", "pod-1", "--yes"]),
      expect.any(Object),
    );
  });
});

describe("Gemma dataset conversion", () => {
  it("turns training pairs into chat JSONL", () => {
    const jsonl = internalPrimeTestUtils.trainingPairToChatJsonl([
      {
        id: "pair-1",
        task: {
          id: "task-1",
          prompt: "Fix mobile overflow.",
          target_mechanism: "responsive-grid",
          criteria: [{ id: "c1", description: "No overflow", weight: 1 }],
        },
        weak_code: "<Grid />",
        defect: {
          screenshot: "PNG",
          dom_trace: "overflow",
          category: "overflow",
          severity: "high",
        },
        strong_code: '<Grid className="min-w-0" />',
        u_score: 1,
      },
    ]);

    const row = JSON.parse(jsonl);
    expect(row.messages).toHaveLength(3);
    expect(row.messages[1].content).toContain("Weak implementation");
    expect(row.messages[2].content).toBe('<Grid className="min-w-0" />');
  });
});

describe("Gemma remote bootstrap", () => {
  it("uses an isolated Python environment without mutating system packages", () => {
    const command = internalPrimeTestUtils.buildRemoteTrainingCommand({
      remoteDir: "/workspace/bbb-run",
      hfToken: "hf_test",
      modelId: "google/gemma-4-26B-A4B-it",
      epochs: 3,
      maxSteps: 5,
    });

    expect(command).not.toContain("apt-get");
    expect(command).not.toContain("python3 -m venv");
    expect(command).toContain("Miniforge3-Linux-x86_64.sh");
    expect(command).toContain("conda create -y -p ");
    expect(command).toContain(".py/bin/python -m pip install --upgrade torch");
    expect(command).toContain('"pillow>=11.0.0"');
    expect(command).toContain("export PIP_ROOT_USER_ACTION=ignore");
    expect(command).toContain("--max-steps 5");
  });

  it("passes --epochs when maxSteps is omitted", () => {
    const command = internalPrimeTestUtils.buildRemoteTrainingCommand({
      remoteDir: "/workspace/bbb-run",
      hfToken: "hf_test",
      modelId: "google/gemma-4-26B-A4B-it",
      epochs: 3,
    });

    expect(command).toContain("--epochs 3");
    expect(command).not.toContain("--max-steps");
  });
});

describe("Gemma remote trainer script", () => {
  it("uses the current TRL SFTConfig max length option", () => {
    expect(GEMMA_LORA_TRAINER_PY).toContain("max_length=args.max_seq_length");
    expect(GEMMA_LORA_TRAINER_PY).not.toContain(
      "max_seq_length=args.max_seq_length",
    );
    expect(GEMMA_LORA_TRAINER_PY).toContain("processing_class=tokenizer");
    expect(GEMMA_LORA_TRAINER_PY).toContain(
      'target_modules=["q_proj.linear", "k_proj.linear", "v_proj.linear", "o_proj.linear"]',
    );
  });

  it("formats chat messages via tokenizer.apply_chat_template", () => {
    expect(GEMMA_LORA_TRAINER_PY).toContain("apply_chat_template");
    expect(GEMMA_LORA_TRAINER_PY).toContain("formatting_func");
    expect(GEMMA_LORA_TRAINER_PY).toContain("format_func");
  });

  it("validates chat_template exists before training", () => {
    expect(GEMMA_LORA_TRAINER_PY).toContain("chat_template");
    expect(GEMMA_LORA_TRAINER_PY).toContain("Tokenizer lacks a chat_template");
  });

  it("supports --epochs as an alternative to --max-steps", () => {
    expect(GEMMA_LORA_TRAINER_PY).toContain("--epochs");
    expect(GEMMA_LORA_TRAINER_PY).toContain("epoch_steps");
  });

  it("uses cosine LR scheduler with warmup", () => {
    expect(GEMMA_LORA_TRAINER_PY).toContain('lr_scheduler_type="cosine"');
    expect(GEMMA_LORA_TRAINER_PY).toContain("warmup_ratio");
  });

  it("saves checkpoints during training with a limit", () => {
    expect(GEMMA_LORA_TRAINER_PY).toContain('save_strategy="steps"');
    expect(GEMMA_LORA_TRAINER_PY).toContain("save_total_limit=2");
  });

  it("reports dataset row count after loading", () => {
    expect(GEMMA_LORA_TRAINER_PY).toContain('"rows": len(dataset)');
    expect(GEMMA_LORA_TRAINER_PY).toContain('"status": "dataset_loaded"');
  });

  it("reports training config (epochs, batch, steps) before starting", () => {
    expect(GEMMA_LORA_TRAINER_PY).toContain('"status": "training_config"');
    expect(GEMMA_LORA_TRAINER_PY).toContain('"steps_per_epoch"');
    expect(GEMMA_LORA_TRAINER_PY).toContain('"total_steps"');
  });
});

describe("resolveHubRepo", () => {
  beforeEach(() => {
    delete process.env.BBB_HF_HUB_REPO;
  });

  it("uses the explicit hubRepo option when provided", () => {
    expect(
      internalPrimeTestUtils.resolveHubRepo({ hubRepo: "peli/explicit" }),
    ).toBe("peli/explicit");
  });

  it("falls back to the BBB_HF_HUB_REPO env var", () => {
    process.env.BBB_HF_HUB_REPO = "peli/from-env";
    expect(internalPrimeTestUtils.resolveHubRepo({})).toBe("peli/from-env");
  });

  it("prefers the explicit option over the env var", () => {
    process.env.BBB_HF_HUB_REPO = "peli/from-env";
    expect(
      internalPrimeTestUtils.resolveHubRepo({ hubRepo: "peli/explicit" }),
    ).toBe("peli/explicit");
  });

  it("returns undefined when no repo is configured (push disabled)", () => {
    expect(internalPrimeTestUtils.resolveHubRepo({})).toBeUndefined();
  });

  it("ignores blank/whitespace repo values", () => {
    expect(
      internalPrimeTestUtils.resolveHubRepo({ hubRepo: "   " }),
    ).toBeUndefined();
  });
});

describe("Gemma remote bootstrap — Hugging Face Hub push", () => {
  it("appends a shell-quoted --push-to-hub flag when a repo is given", () => {
    const command = internalPrimeTestUtils.buildRemoteTrainingCommand({
      remoteDir: "/workspace/bbb-run",
      hfToken: "hf_test",
      modelId: "google/gemma-4-26B-A4B-it",
      epochs: 3,
      maxSteps: 5,
      hubRepo: "peli/gemma-bbb-lora",
    });

    expect(command).toContain("--push-to-hub 'peli/gemma-bbb-lora'");
  });

  it("omits --push-to-hub when no repo is configured", () => {
    const command = internalPrimeTestUtils.buildRemoteTrainingCommand({
      remoteDir: "/workspace/bbb-run",
      hfToken: "hf_test",
      modelId: "google/gemma-4-26B-A4B-it",
      epochs: 3,
      maxSteps: 5,
    });

    expect(command).not.toContain("--push-to-hub");
  });
});

describe("Gemma remote trainer script — Hugging Face Hub push", () => {
  it("accepts an optional --push-to-hub argument", () => {
    expect(GEMMA_LORA_TRAINER_PY).toContain("--push-to-hub");
  });

  it("validates the repo up front with create_repo (fail-fast before training)", () => {
    expect(GEMMA_LORA_TRAINER_PY).toContain("create_repo");
    // create_repo must run before trainer.train() so bad auth fails in seconds,
    // not after an expensive run.
    const createIdx = GEMMA_LORA_TRAINER_PY.indexOf("create_repo");
    const trainIdx = GEMMA_LORA_TRAINER_PY.indexOf("trainer.train()");
    expect(createIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeLessThan(trainIdx);
  });

  it("pushes the saved adapter to the hub and reports it", () => {
    expect(GEMMA_LORA_TRAINER_PY).toContain("push_to_hub");
    expect(GEMMA_LORA_TRAINER_PY).toContain('"status": "pushed"');
  });
});

describe("buildServeCommand (Feature C)", () => {
  it("installs vllm, launches base+lora, and schedules a TTL pkill", () => {
    const cmd = internalPrimeTestUtils.buildServeCommand({
      remoteDir: "/home/ubuntu/run1",
      adapterPath: "/home/ubuntu/run1/adapter",
      baseModel: "google/gemma-4-26B-A4B-it",
      port: 8000,
      ttlMs: 1_800_000,
    });
    expect(cmd).toMatch(/pip install .*vllm/);
    expect(cmd).toMatch(/vllm\.entrypoints\.openai\.api_server/);
    expect(cmd).toMatch(/--lora-modules tuned=/);
    expect(cmd).toMatch(/sleep 1800; pkill -f vllm/);
  });
});
