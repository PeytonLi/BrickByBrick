#!/usr/bin/env python3
"""Test inference with the fine-tuned LoRA adapter.
Loads the base Gemma 4 model + peytonali/gemma-bbb-lora adapter,
then runs a test prompt comparing base vs tuned output.
"""
import os, sys, json, torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel

HF_TOKEN = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("HF_TOKEN")
if not HF_TOKEN:
    print(json.dumps({"type": "error", "message": "HF_TOKEN required"}))
    sys.exit(1)

BASE_MODEL = "google/gemma-4-26B-A4B-it"
ADAPTER = "peytonali/gemma-bbb-lora"

print(json.dumps({"type": "status", "status": "loading_tokenizer"}), flush=True)
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, token=HF_TOKEN)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

print(json.dumps({"type": "status", "status": "loading_base_model"}), flush=True)
quant = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)
base_model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    token=HF_TOKEN,
    quantization_config=quant,
    device_map="auto",
    torch_dtype=torch.bfloat16,
)

print(json.dumps({"type": "status", "status": "loading_adapter"}), flush=True)
tuned_model = PeftModel.from_pretrained(base_model, ADAPTER, token=HF_TOKEN)

# Test prompts — UI code repair tasks
test_prompts = [
    # 1. Simple overflow fix
    "Task: Build a responsive CSS Grid layout that collapses columns on mobile\nTarget mechanism: responsive-grid\nAcceptance criteria: No horizontal overflow at any viewport; Correct columns per breakpoint; Consistent gap between items\nWeak implementation:\nfunction Grid({items}){return <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)'}}>{items.map(i=><div key={i}>{i}</div>)}</div>}\nObserved defect: overflow (high)\nDOM trace: overflow-x at 375px; no responsive breakpoints\n\nReturn only the corrected implementation code.",
    
    # 2. Modal focus trap
    "Task: Implement a modal dialog with proper focus trap and Escape key dismissal\nTarget mechanism: modal-focus-trap\nWeak implementation:\nfunction Modal({open,onClose,children}){if(!open)return null;return <div onClick={onClose}><div onClick={e=>e.stopPropagation()}>{children}</div></div>}\nObserved defect: layout_collision (high)\nDOM trace: Tab exits modal to background; no focus trap; no aria-modal\n\nReturn only the corrected implementation code.",
    
    # 3. Form validation
    "Task: Create a form with real-time validation showing inline error messages\nTarget mechanism: form-validation\nWeak implementation:\nfunction Form(){const [email,setEmail]=useState('');const submit=()=>fetch('/api',{method:'POST',body:JSON.stringify({email})});return <form onSubmit={e=>{e.preventDefault();submit()}}><input value={email} onChange={e=>setEmail(e.target.value)}/><button>Submit</button></form>}\nObserved defect: script_error (medium)\nDOM trace: No validation; accepts empty email; no errors\n\nReturn only the corrected implementation code.",
]

def generate(model, prompt, label):
    messages = [
        {"role": "system", "content": "You repair React and CSS UI implementations. Return only corrected implementation code."},
        {"role": "user", "content": prompt},
    ]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(text, return_tensors="pt").to(model.device)
    
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=512,
            temperature=0.2,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )
    response = tokenizer.decode(outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)
    print(json.dumps({"type": "inference", "label": label, "output": response.strip()}), flush=True)
    return response.strip()

print(json.dumps({"type": "status", "status": "running_tests"}), flush=True)

for i, prompt in enumerate(test_prompts):
    print(json.dumps({"type": "status", "status": f"test_{i+1}", "prompt_preview": prompt[:80] + "..."}), flush=True)
    
    # Generate with base model (adapter disabled)
    tuned_model.disable_adapter_layers()
    base_out = generate(tuned_model, prompt, f"base_test_{i+1}")
    
    # Generate with tuned model (adapter enabled)  
    tuned_model.enable_adapter_layers()
    tuned_out = generate(tuned_model, prompt, f"tuned_test_{i+1}")
    
    print(json.dumps({
        "type": "comparison",
        "test": i + 1,
        "base_output": base_out[:200],
        "tuned_output": tuned_out[:200],
    }), flush=True)

print(json.dumps({"type": "complete"}), flush=True)
