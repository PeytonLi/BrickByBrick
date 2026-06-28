export const GEMMA_LORA_TRAINER_PY = String.raw`#!/usr/bin/env python3
import argparse
import json
import math
import os
import sys

import torch
from datasets import load_dataset
from huggingface_hub import create_repo
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
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--max-steps", type=int, default=None)
    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=4)
    parser.add_argument("--max-seq-length", type=int, default=2048)
    parser.add_argument("--warmup-ratio", type=float, default=0.03)
    parser.add_argument("--push-to-hub", default=None)
    return parser.parse_args()


def format_chat(example, tokenizer):
    """Convert a {messages: [...]} row into Gemma's instruction-following text."""
    return tokenizer.apply_chat_template(example["messages"], tokenize=False, add_generation_prompt=False)


def main():
    args = parse_args()
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN is required")

    # Fail fast: validate the Hub repo/token BEFORE the expensive training run, so
    # a bad token or missing permission surfaces in seconds instead of after an
    # hour of training when the adapter would otherwise be lost on pod teardown.
    if args.push_to_hub:
        create_repo(args.push_to_hub, token=token, private=True, exist_ok=True, repo_type="model")
        print(json.dumps({"type": "status", "status": "hub_ready", "repo": args.push_to_hub}), flush=True)

    print(json.dumps({"type": "status", "status": "loading_dataset"}), flush=True)
    dataset = load_dataset("json", data_files=args.dataset, split="train")
    print(json.dumps({"type": "status", "status": "dataset_loaded", "rows": len(dataset)}), flush=True)

    print(json.dumps({"type": "status", "status": "loading_model", "model": args.model}), flush=True)
    tokenizer = AutoTokenizer.from_pretrained(args.model, token=token, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Warn if the tokenizer doesn't have a chat template (Gemma should, but be safe)
    if not hasattr(tokenizer, "chat_template") or tokenizer.chat_template is None:
        print(json.dumps({"type": "error", "message": "Tokenizer lacks a chat_template. Gemma models must have one for conversation formatting."}), flush=True)
        sys.exit(1)

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

    effective_batch = args.batch_size * args.gradient_accumulation_steps
    epoch_steps = max(1, math.ceil(len(dataset) / effective_batch))
    total_steps = args.max_steps if args.max_steps is not None else epoch_steps * args.epochs

    print(json.dumps({
        "type": "status",
        "status": "training_config",
        "dataset_rows": len(dataset),
        "epochs": args.epochs,
        "effective_batch_size": effective_batch,
        "steps_per_epoch": epoch_steps,
        "total_steps": total_steps,
    }), flush=True)

    training_args = SFTConfig(
        output_dir=args.output,
        max_steps=total_steps,
        learning_rate=args.learning_rate,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        max_length=args.max_seq_length,
        logging_steps=1,
        save_steps=int(total_steps * 0.5),
        save_strategy="steps",
        save_total_limit=2,
        bf16=True,
        gradient_checkpointing=True,
        warmup_ratio=args.warmup_ratio,
        lr_scheduler_type="cosine",
        report_to=[],
        packing=False,
        dataset_text_field=None,
    )

    def format_func(example):
        return format_chat(example, tokenizer)

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        processing_class=tokenizer,
        train_dataset=dataset,
        formatting_func=format_func,
        peft_config=peft_config,
        callbacks=[JsonLossCallback()],
    )

    print(json.dumps({"type": "status", "status": "training"}), flush=True)
    trainer.train()
    trainer.save_model(args.output)
    tokenizer.save_pretrained(args.output)

    if args.push_to_hub:
        print(json.dumps({"type": "status", "status": "pushing", "repo": args.push_to_hub}), flush=True)
        trainer.model.push_to_hub(args.push_to_hub, token=token, private=True)
        tokenizer.push_to_hub(args.push_to_hub, token=token, private=True)
        print(
            json.dumps(
                {
                    "type": "status",
                    "status": "pushed",
                    "repo": args.push_to_hub,
                    "url": "https://huggingface.co/" + args.push_to_hub,
                }
            ),
            flush=True,
        )

    print(json.dumps({"type": "status", "status": "complete", "adapter": args.output}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"type": "error", "message": str(exc)}), flush=True)
        raise
`;
