export interface TrainingConfigOpts {
  base_model?: string;
  lora_rank?: number;
  lora_alpha?: number;
  lora_target_modules?: string[];
  epochs?: number;
  batch_size?: number;
  lr?: number;
}

export function buildTrainingConfig(opts: TrainingConfigOpts = {}): string {
  const base_model = opts.base_model ?? "google/gemma-4-26B-A4B-it";
  const lora_rank = opts.lora_rank ?? 16;
  const lora_alpha = opts.lora_alpha ?? 32;
  const target_modules = opts.lora_target_modules ?? [
    "q_proj",
    "v_proj",
    "k_proj",
    "o_proj",
  ];
  const epochs = opts.epochs ?? 3;
  const batch_size = opts.batch_size ?? 2;
  const lr = opts.lr ?? 5e-5;

  const modulesToml = target_modules.map((m) => `"${m}"`).join(", ");

  return [
    "[model]",
    `base = "${base_model}"`,
    "",
    "[lora]",
    `rank = ${lora_rank}`,
    `alpha = ${lora_alpha}`,
    `target_modules = [${modulesToml}]`,
    "",
    "[training]",
    `epochs = ${epochs}`,
    `batch_size = ${batch_size}`,
    `lr = ${lr}`,
    "",
  ].join("\n");
}
