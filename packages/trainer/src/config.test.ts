import { describe, it, expect } from "vitest";
import { buildTrainingConfig } from "./config";

describe("buildTrainingConfig", () => {
  it("emits valid TOML with default params", () => {
    const toml = buildTrainingConfig();
    expect(toml).toContain("[model]");
    expect(toml).toContain('base = "google/gemma-4-26B-A4B-it"');
    expect(toml).toContain("[lora]");
    expect(toml).toContain("rank = 16");
    expect(toml).toContain("alpha = 32");
    expect(toml).toContain("[training]");
    expect(toml).toContain("epochs = 3");
    expect(toml).toContain("batch_size = 2");
    expect(toml).toContain("lr = 0.00005");
  });

  it("includes lora_target_modules as TOML array", () => {
    const toml = buildTrainingConfig();
    expect(toml).toContain(
      'target_modules = ["q_proj", "v_proj", "k_proj", "o_proj"]',
    );
  });

  it("overrides epochs", () => {
    const toml = buildTrainingConfig({ epochs: 10 });
    expect(toml).toContain("epochs = 10");
    expect(toml).not.toContain("epochs = 3");
  });

  it("overrides lora_rank", () => {
    const toml = buildTrainingConfig({ lora_rank: 32 });
    expect(toml).toContain("rank = 32");
    expect(toml).not.toContain("rank = 16");
  });

  it("overrides lora_alpha", () => {
    const toml = buildTrainingConfig({ lora_alpha: 64 });
    expect(toml).toContain("alpha = 64");
    expect(toml).not.toContain("alpha = 32");
  });

  it("overrides batch_size", () => {
    const toml = buildTrainingConfig({ batch_size: 8 });
    expect(toml).toContain("batch_size = 8");
    expect(toml).not.toContain("batch_size = 4");
  });

  it("overrides lr", () => {
    const toml = buildTrainingConfig({ lr: 1e-4 });
    expect(toml).toContain("lr = 0.0001");
    expect(toml).not.toContain("lr = 0.00005");
  });

  it("overrides base model", () => {
    const toml = buildTrainingConfig({ base_model: "meta-llama/Llama-3-8b" });
    expect(toml).toContain('base = "meta-llama/Llama-3-8b"');
  });

  it("produces deterministic output for same inputs", () => {
    const a = buildTrainingConfig({ epochs: 5, lora_rank: 8 });
    const b = buildTrainingConfig({ epochs: 5, lora_rank: 8 });
    expect(a).toBe(b);
  });
});
