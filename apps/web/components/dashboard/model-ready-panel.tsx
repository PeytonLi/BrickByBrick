"use client";
import { useState } from "react";
import { useAgentStore } from "@/lib/store";
import { streamAgentEvents } from "@/lib/stream-client";
import { Button } from "@/components/ui/button";

export function ModelReadyPanel() {
  const serveInfo = useAgentStore((s) => s.serveInfo);
  const evalReport = useAgentStore((s) => s.evalReport);
  const evalRunning = useAgentStore((s) => s.evalRunning);
  const trainingRunId = useAgentStore((s) => s.trainingRunId);
  const consumeEvent = useAgentStore((s) => s.consumeEvent);
  const [prompt, setPrompt] = useState("");
  const [base, setBase] = useState<string | null>(null);
  const [tuned, setTuned] = useState<string | null>(null);

  if (!serveInfo) return null;

  async function runEval() {
    if (!trainingRunId) return;
    await streamAgentEvents({
      url: "/api/eval/stream",
      init: { method: "POST", body: JSON.stringify({ runId: trainingRunId, k: 3 }) },
      onEvent: consumeEvent,
    });
  }
  async function tryIt(model: "base" | "tuned") {
    const res = await fetch("/api/model/infer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: trainingRunId, prompt, model }),
    });
    const { code } = (await res.json()) as { code: string };
    model === "base" ? setBase(code) : setTuned(code);
  }

  return (
    <section className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.03] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">Model ready</h3>
        <span className="text-xs text-zinc-400">serve expires {new Date(serveInfo.expiresAt).toLocaleTimeString()}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={runEval} disabled={evalRunning}>
          {evalRunning ? "Evaluating…" : "Run before/after eval (≈6 audits)"}
        </Button>
      </div>
      {evalReport ? (
        <div className="mt-3 text-sm text-zinc-200">
          Tuned vs base: <span className="text-emerald-400">{evalReport.wins}W</span> / {evalReport.ties}T /{" "}
          <span className="text-rose-400">{evalReport.losses}L</span> · Δscore{" "}
          {evalReport.mean_score_delta.toFixed(3)}
        </div>
      ) : null}
      <div className="mt-4">
        <input
          className="h-9 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-emerald-300"
          placeholder="Try it: describe a UI to generate"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <Button variant="secondary" onClick={() => tryIt("base")} disabled={!prompt.trim()}>Base</Button>
          <Button onClick={() => tryIt("tuned")} disabled={!prompt.trim()}>Tuned</Button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <pre className="max-h-48 overflow-auto rounded bg-black/60 p-2 text-xs text-zinc-300">{base ?? "base output…"}</pre>
          <pre className="max-h-48 overflow-auto rounded bg-black/60 p-2 text-xs text-zinc-300">{tuned ?? "tuned output…"}</pre>
        </div>
      </div>
    </section>
  );
}
