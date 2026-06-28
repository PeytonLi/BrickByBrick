"use client";

import { useState, useEffect } from "react";
import { Search, Package, ExternalLink, Loader2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { useAgentStore, type AgentStoreSnapshot } from "@/lib/store";
import { streamAgentEvents } from "@/lib/stream-client";
import { cn } from "@/lib/utils";

type HFRepo = { id: string; label: string; lastModified?: string };

export default function ModelsPage() {
  const snapshot = useAgentStore(
    useShallow((s: AgentStoreSnapshot) => ({
      trainingRunId: s.trainingRunId,
      serveInfo: s.serveInfo,
      evalRunning: s.evalRunning,
      evalReport: s.evalReport,
    })),
  );
  const consumeEvent = useAgentStore((s) => s.consumeEvent);

  const [allRepos, setAllRepos] = useState<HFRepo[]>([]);
  const [hfSearch, setHfSearch] = useState("");
  const [hfResults, setHfResults] = useState<HFRepo[]>([]);
  const [hfSearching, setHfSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [baseOutput, setBaseOutput] = useState<string | null>(null);
  const [tunedOutput, setTunedOutput] = useState<string | null>(null);

  // Auto-fetch from HF on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/hf/models");
        const data = (await res.json()) as { models: HFRepo[]; error?: string };
        if (!cancelled) {
          if (data.error && data.models.length === 0) setError(data.error);
          setAllRepos(data.models ?? []);
          setHfResults(data.models ?? []);
        }
      } catch {
        if (!cancelled) setError("Could not reach HF API");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const searchHF = () => {
    setHfSearching(true);
    const q = hfSearch.trim().toLowerCase();
    setHfResults(
      q ? allRepos.filter((r) => r.id.toLowerCase().includes(q)) : allRepos,
    );
    setHfSearching(false);
  };

  const runEval = async () => {
    if (!snapshot.trainingRunId) return;
    await streamAgentEvents({
      url: "/api/eval/stream",
      init: {
        method: "POST",
        body: JSON.stringify({ runId: snapshot.trainingRunId, k: 3 }),
      },
      onEvent: consumeEvent,
    });
  };

  const tryModel = async (model: "base" | "tuned") => {
    if (!prompt.trim() || !snapshot.trainingRunId) return;
    const res = await fetch("/api/model/infer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: snapshot.trainingRunId, prompt, model }),
    });
    const { code } = (await res.json()) as { code: string };
    if (model === "base") setBaseOutput(code);
    else setTunedOutput(code);
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="animate-reveal">
        <h1 className="font-serif text-3xl text-white sm:text-4xl">
          Your models
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Browse trained LoRA adapters on Hugging Face.
        </p>
      </section>

      <section
        className="mt-6 animate-reveal"
        style={{ animationDelay: "0.05s" }}
      >
        <div className="flex gap-2">
          <input
            className="h-10 flex-1 rounded-lg border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-emerald-300 placeholder:text-zinc-600 font-mono"
            placeholder="Filter models…"
            value={hfSearch}
            onChange={(e) => setHfSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") searchHF();
            }}
          />
          <Button onClick={searchHF} disabled={hfSearching}>
            {hfSearching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}{" "}
            Filter
          </Button>
        </div>
        {error && (
          <p className="mt-2 text-xs text-amber-300">
            {error} — showing cached results
          </p>
        )}
      </section>

      <section
        className="mt-4 animate-reveal"
        style={{ animationDelay: "0.1s" }}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.01] p-12 text-center">
            <Loader2 className="size-6 animate-spin text-emerald-300" />
            <p className="text-sm text-zinc-500">
              Loading models from Hugging Face…
            </p>
          </div>
        ) : hfResults.length > 0 ? (
          <div className="space-y-1 rounded-xl border border-white/[0.06] bg-white/[0.01] p-2">
            {hfResults.map((r) => (
              <button
                key={r.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm transition-colors hover:bg-white/5",
                  selectedModel === r.id
                    ? "bg-emerald-500/10 border border-emerald-500/20"
                    : "text-zinc-300",
                )}
                onClick={() => setSelectedModel(r.id)}
              >
                <Package className="size-5 shrink-0 text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-white">
                    {r.label}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    LoRA adapter
                  </span>
                </div>
                <a
                  href={"https://huggingface.co/" + r.id}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-zinc-600 hover:text-zinc-400"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="size-4" />
                </a>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.01] p-12 text-center">
            <Package className="size-8 text-zinc-700" />
            <p className="max-w-sm text-sm leading-6 text-zinc-500">
              No models found. Push a LoRA adapter via the rehearsal script and
              it will appear here.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
