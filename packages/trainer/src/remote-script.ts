export const GEMMA_LORA_TRAINER_PY = String.raw`#!/usr/bin/env python3
import argparse
import json
import os
import sys

import torch
from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TrainerCallback
from trl import SFTConfig, SFTTrainer


class JsonLossCallback(TrainerCallback):
    def on_log(self, args, state, control, logs=None, **kwargs):
        logs = logs or {}
        loss = logs.get("loss")
        if loss is None:
            return
        print(
            json.dumps(
                {
                    "type": "metric",
                    "step": int(state.global_step),
                    "loss": float(loss),
                    "epoch": float(logs.get("epoch") or state.epoch or 0),
                }
            ),
            flush=True,
        )


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="google/gemma-4-26B-A4B-it")
    parser.add_argument("--max-steps", type=int, default=20)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=8)
    parser.add_argument("--max-seq-length", type=int, default=4096)
    return parser.parse_args()


def main():
    args = parse_args()
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN is required")

    print(json.dumps({"type": "status", "status": "loading_dataset"}), flush=True)
    dataset = load_dataset("json", data_files=args.dataset, split="train")

    print(json.dumps({"type": "status", "status": "loading_model", "model": args.model}), flush=True)
    tokenizer = AutoTokenizer.from_pretrained(args.model, token=token, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        token=token,
        quantization_config=quantization,
        device_map="auto",
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
    )
    model.config.use_cache = False

    peft_config = LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj.linear", "k_proj.linear", "v_proj.linear", "o_proj.linear"],
    )

    training_args = SFTConfig(
        output_dir=args.output,
        max_steps=args.max_steps,
        learning_rate=args.learning_rate,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        max_length=args.max_seq_length,
        logging_steps=1,
        save_steps=max(args.max_steps, 1),
        bf16=True,
        gradient_checkpointing=True,
        report_to=[],
        packing=False,
    )

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        processing_class=tokenizer,
        train_dataset=dataset,
        peft_config=peft_config,
        callbacks=[JsonLossCallback()],
    )

    print(json.dumps({"type": "status", "status": "training"}), flush=True)
    trainer.train()
    trainer.save_model(args.output)
    tokenizer.save_pretrained(args.output)
    print(json.dumps({"type": "status", "status": "complete", "adapter": args.output}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"type": "error", "message": str(exc)}), flush=True)
        raise
`
