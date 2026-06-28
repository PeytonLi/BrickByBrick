"use client";

import { useState } from "react";
import { Search, Package, ExternalLink, Cpu, Sparkles, Zap, GitCompareArrows, Loader2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { useAgentStore, type AgentStoreSnapshot } from "@/lib/store";
import { streamAgentEvents } from "@/lib/stream-client";
import { cn } from "@/lib/utils";

const MOCK_HF_REPOS = [
  { id: "peytonali/gemma-bbb-lora", label: "peytonali/gemma-bbb-lora" },
  { id: "peytonali/bbb-rehearsal-1782650385176", label: "peytonali/bbb-rehearsal-1782650385176" },
];

export default function ModelsPage() {
  const snapshot = useAgentStore(useShallow((s: AgentStoreSnapshot) => ({ trainingRunId: s.trainingRunId, serveInfo: s.serveInfo, evalRunning: s.evalRunning, evalReport: s.evalReport })));
  const consumeEvent = useAgentStore((s) => s.consumeEvent);
  const [hfSearch, setHfSearch] = useState("");
  const [hfResults, setHfResults] = useState<typeof MOCK_HF_REPOS>([]);
  const [hfSearching, setHfSearching] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [baseOutput, setBaseOutput] = useState<string | null>(null);
  const [tunedOutput, setTunedOutput] = useState<string | null>(null);

  const searchHF = async () => { setHfSearching(true); await new Promise((r) => setTimeout(r, 300)); const q = hfSearch.trim().toLowerCase(); setHfResults(q ? MOCK_HF_REPOS.filter((r) => r.id.toLowerCase().includes(q)) : MOCK_HF_REPOS); setHfSearching(false); };
  const runEval = async () => { if (!snapshot.trainingRunId) return; await streamAgentEvents({ url: "/api/eval/stream", init: { method: "POST", body: JSON.stringify({ runId: snapshot.trainingRunId, k: 3 }) }, onEvent: consumeEvent }); };
  const tryModel = async (model: "base" | "tuned") => { if (!prompt.trim() || !snapshot.trainingRunId) return; const res = await fetch("/api/model/infer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: snapshot.trainingRunId, prompt, model }) }); const { code } = (await res.json()) as { code: string }; if (model === "base") setBaseOutput(code); else setTunedOutput(code); };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="animate-reveal">
        <h1 className="font-serif text-3xl text-white sm:text-4xl">Your models</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Browse trained LoRA adapters on Hugging Face. Select a model to evaluate or try it.</p>
      </section>
      <section className="mt-6 animate-reveal" style={{ animationDelay: "0.05s" }}>
        <div className="flex gap-2"><input className="h-10 flex-1 rounded-lg border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-emerald-300 placeholder:text-zinc-600 font-mono" placeholder="peytonali/gemma-bbb-lora" value={hfSearch} onChange={(e) => setHfSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") searchHF(); }} /><Button onClick={searchHF} disabled={hfSearching}>{hfSearching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search</Button></div>
      </section>
      <section className="mt-4 animate-reveal" style={{ animationDelay: "0.1s" }}>
        {hfResults.length > 0 ? (<div className="space-y-1 rounded-xl border border-white/[0.06] bg-white/[0.01] p-2">{hfResults.map((r) => (<button key={r.id} type="button" className={cn("flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm transition-colors hover:bg-white/5", selectedModel === r.id ? "bg-emerald-500/10 border border-emerald-500/20" : "text-zinc-300")} onClick={() => setSelectedModel(r.id)}><Package className="size-5 shrink-0 text-zinc-500" /><div className="min-w-0 flex-1"><span className="block truncate font-mono text-white">{r.label}</span><span className="block text-xs text-zinc-500">LoRA adapter</span></div><a href={"https://huggingface.co/" + r.id} target="_blank" rel="noopener noreferrer" className="shrink-0 text-zinc-600 hover:text-zinc-400" onClick={(e) => e.stopPropagation()}><ExternalLink className="size-4" /></a></button>))}</div>) : (<div className="flex flex-col items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.01] p-12 text-center"><Package className="size-8 text-zinc-700" /><p className="max-w-sm text-sm leading-6 text-zinc-500">Search for your trained models. Rehearsal runs auto-publish to <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-xs text-zinc-400">peytonali/bbb-rehearsal-*</code>.</p></div>)}
      </section>
      {snapshot.serveInfo && (<section className="mt-8 animate-reveal rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-6" style={{ animationDelay: "0.15s" }}><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Cpu className="size-5 text-emerald-300" /><h2 className="font-serif text-xl text-white">Model serving</h2></div><span className="text-xs text-zinc-500">Expires {new Date(snapshot.serveInfo.expiresAt).toLocaleTimeString()}</span></div><div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" onClick={runEval} disabled={snapshot.evalRunning}>{snapshot.evalRunning ? <><Loader2 className="size-4 animate-spin" /> Evaluating</> : <><GitCompareArrows className="size-4" /> Run before/after eval</>}</Button>{snapshot.evalReport && (<span className="text-xs text-zinc-300">Tuned vs base: <span className="text-emerald-400">{snapshot.evalReport.wins}W</span> / {snapshot.evalReport.ties}T / <span className="text-rose-400">{snapshot.evalReport.losses}L</span> &middot; score <span className="font-mono">{snapshot.evalReport.mean_score_delta.toFixed(3)}</span></span>)}</div><div className="mt-5"><label className="mb-1.5 block text-xs text-zinc-500">Describe a UI to generate</label><input className="h-10 w-full rounded-lg border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-emerald-300 placeholder:text-zinc-600" placeholder="e.g. a responsive pricing grid" value={prompt} onChange={(e) => setPrompt(e.target.value)} /><div className="mt-3 flex gap-2"><Button variant="secondary" size="sm" onClick={() => tryModel("base")} disabled={!prompt.trim()}>Run base model</Button><Button size="sm" onClick={() => tryModel("tuned")} disabled={!prompt.trim()}><Zap className="size-4" /> Run tuned model</Button></div><div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="rounded-lg border border-white/10 bg-black/40 p-4"><div className="mb-2 text-xs font-medium text-zinc-500">Base model output</div><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-300">{baseOutput ?? "Run base model to see output"}</pre></div><div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4"><div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-300"><Sparkles className="size-3" /> Tuned model output</div><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-300">{tunedOutput ?? "Run tuned model to see output"}</pre></div></div></div></section>)}
    </main>
  );
}
