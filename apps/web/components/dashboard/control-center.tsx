"use client";

import { useRef, useState } from "react";
import { Loader2, Play, Radio, RefreshCw, Square } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/components/ui/button";
import { LiveMediaRoom } from "@/components/dashboard/live-media-room";
import { ModelReadyPanel } from "@/components/dashboard/model-ready-panel";
import { AdversarialMatrix } from "@/components/dashboard/adversarial-matrix";
import { WeightComputeConsole } from "@/components/dashboard/weight-compute-console";
import { useAgentStore } from "@/lib/store";
import { streamAgentEvents } from "@/lib/stream-client";

interface LiveKitTokenPayload {
  token: string;
  url: string;
}

type StreamState = "idle" | "streaming" | "error";

export function ControlCenter() {
  const snapshot = useAgentStore(
    useShallow((state) => ({
      status: state.status,
      targetPairs: state.targetPairs,
      currentTask: state.currentTask,
      weakCode: state.weakCode,
      strongCode: state.strongCode,
      latestDiff: state.latestDiff,
      latestAuditStep: state.latestAuditStep,
      latestScreenshotSrc: state.latestScreenshotSrc,
      latestDefect: state.latestDefect,
      committedPairs: state.committedPairs,
      committedCount: state.committedCount,
      uScore: state.uScore,
      lastRejectedReason: state.lastRejectedReason,
      recipePatch: state.recipePatch,
      narration: state.narration,
      training: state.training,
      trainingRunId: state.trainingRunId,
      timeline: state.timeline,
      lastEventType: state.lastEventType,
      pulse: state.pulse,
    })),
  );
  const targetPairs = useAgentStore((state) => state.targetPairs);
  const setTargetPairs = useAgentStore((state) => state.setTargetPairs);
  const consumeEvent = useAgentStore((state) => state.consumeEvent);
  const reset = useAgentStore((state) => state.reset);
  const [intent, setIntent] = useState("");
  const [deriving, setDeriving] = useState(false);
  const derivedConfig = useAgentStore((s) => s.derivedConfig);
  const sampleTitles = useAgentStore((s) => s.sampleTitles);

  const [visualState, setVisualState] = useState<StreamState>("idle");
  const [trainingState, setTrainingState] = useState<StreamState>("idle");
  const [manualRunId, setManualRunId] = useState("");
  const [liveKitToken, setLiveKitToken] = useState<LiveKitTokenPayload | null>(
    null,
  );
  const [liveKitError, setLiveKitError] = useState<string | null>(null);
  const visualAbortRef = useRef<AbortController | null>(null);
  const trainingAbortRef = useRef<AbortController | null>(null);

  // Use the trainingRunId surfaced from the loop; fall back to manual input.
  const trainingRunId = snapshot.trainingRunId || manualRunId;

  async function derivePlan() {
    if (!intent.trim()) return;
    setDeriving(true);
    try {
      const res = await fetch("/api/intent/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      const data = (await res.json()) as {
        config: Record<string, unknown>;
        sample_titles: string[];
      };
      consumeEvent({
        type: "intent_expanded",
        config: data.config,
        sample_titles: data.sample_titles,
      });
    } finally {
      setDeriving(false);
    }
  }

  async function runVisualLoop() {
    visualAbortRef.current?.abort();
    const controller = new AbortController();
    visualAbortRef.current = controller;
    setVisualState("streaming");

    try {
      await streamAgentEvents({
        url: "/api/agent/visual-loop/stream",
        signal: controller.signal,
        init: {
          method: "POST",
          body: JSON.stringify({
            config: { ...(derivedConfig ?? {}), max_pairs: targetPairs },
          }),
        },
        onEvent: consumeEvent,
      });
      setVisualState("idle");
    } catch (error) {
      if (!controller.signal.aborted) {
        setVisualState("error");
        consumeEvent({
          type: "narration",
          text:
            error instanceof Error
              ? error.message
              : "Visual loop stream failed.",
        });
      }
    }
  }

  async function streamTraining() {
    trainingAbortRef.current?.abort();
    const controller = new AbortController();
    trainingAbortRef.current = controller;
    setTrainingState("streaming");

    try {
      await streamAgentEvents({
        url: "/api/training/stream",
        signal: controller.signal,
        init: {
          method: "POST",
          body: JSON.stringify({ runId: trainingRunId }),
        },
        onEvent: consumeEvent,
      });
      setTrainingState("idle");
    } catch (error) {
      if (!controller.signal.aborted) {
        setTrainingState("error");
        consumeEvent({
          type: "narration",
          text:
            error instanceof Error ? error.message : "Training stream failed.",
        });
      }
    }
  }

  async function connectLiveKit() {
    setLiveKitError(null);

    try {
      const response = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: "brickbybrick-control",
          identity: `operator-${crypto.randomUUID().slice(0, 8)}`,
        }),
      });

      if (!response.ok) {
        throw new Error(`LiveKit token request failed with ${response.status}`);
      }

      setLiveKitToken((await response.json()) as LiveKitTokenPayload);
    } catch (error) {
      setLiveKitError(
        error instanceof Error
          ? error.message
          : "Unable to mint a LiveKit token.",
      );
    }
  }

  function stopStreams() {
    visualAbortRef.current?.abort();
    trainingAbortRef.current?.abort();
    setVisualState("idle");
    setTrainingState("idle");
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <section className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-400/60">
            Control center
          </p>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-400">
            Challenge, audit, fix, filter, and stream training telemetry — all
            live.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-zinc-300">
            Target
            <input
              className="h-6 w-14 rounded border border-white/10 bg-black px-2 text-sm text-white outline-none focus:border-emerald-300"
              min={1}
              max={99}
              type="number"
              value={targetPairs}
              onChange={(event) => setTargetPairs(Number(event.target.value))}
              aria-label="Target synthesized pairs"
            />
          </label>
          <label className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-zinc-300">
            Run
            <input
              className="h-6 w-28 rounded border border-white/10 bg-black px-2 text-sm text-white outline-none focus:border-emerald-300"
              type="text"
              value={trainingRunId}
              onChange={(event) => setManualRunId(event.target.value)}
              placeholder={
                snapshot.trainingRunId ? snapshot.trainingRunId : "demo-run"
              }
              aria-label="Prime training run id"
            />
          </label>
          <Button
            onClick={runVisualLoop}
            disabled={visualState === "streaming"}
          >
            {visualState === "streaming" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            Run loop
          </Button>
          <Button
            variant="secondary"
            onClick={streamTraining}
            disabled={
              trainingState === "streaming" || trainingRunId.trim().length === 0
            }
          >
            <Radio className="size-4" aria-hidden="true" />
            Stream metrics
          </Button>
          <Button variant="outline" onClick={stopStreams}>
            <Square className="size-4" aria-hidden="true" />
            Stop
          </Button>
          <Button variant="ghost" onClick={reset}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Reset
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 border-b border-white/10 pb-5">
        <label className="text-sm text-zinc-300">
          What should the model get good at?
        </label>
        <div className="flex gap-2">
          <input
            className="h-9 flex-1 rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-emerald-300"
            placeholder="e.g. a model good at responsive React layouts"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            aria-label="Model intent"
          />
          <Button onClick={derivePlan} disabled={deriving || !intent.trim()}>
            {deriving ? <Loader2 className="size-4 animate-spin" /> : null}{" "}
            Derive plan
          </Button>
        </div>
        {derivedConfig ? (
          <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs text-zinc-300">
            <div>
              Framework:{" "}
              <span className="text-white">
                {derivedConfig.framework ?? "—"}
              </span>
            </div>
            <div className="mt-1">
              Framing: {derivedConfig.domain_framing ?? "—"}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(derivedConfig.challenger_weights ?? {}).map(
                ([m, w]) => (
                  <span
                    key={m}
                    className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5"
                  >
                    {m} ·{String(w)}
                  </span>
                ),
              )}
            </div>
            {sampleTitles.length ? (
              <div className="mt-2 text-zinc-400">
                e.g. {sampleTitles.join(" · ")}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <LiveMediaRoom
        snapshot={snapshot}
        liveKitToken={liveKitToken}
        liveKitError={liveKitError}
        onConnectLiveKit={connectLiveKit}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)]">
        <AdversarialMatrix snapshot={snapshot} />
        <WeightComputeConsole snapshot={snapshot} />
      </div>

      <ModelReadyPanel />
    </main>
  );
}
