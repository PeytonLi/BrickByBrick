"use client";

import { useRef, useState, useCallback, useEffect, memo } from "react";
import Image from "next/image";
import { useMemo } from "react";
import {
  Loader2,
  Play,
  Square,
  RefreshCw,
  CircleDot,
  ShieldCheck,
  Mic2,
  MicOff,
  Radio,
  Cpu,
  CheckCircle2,
  XCircle,
  Activity,
  TerminalSquare,
  ArrowRight,
  Zap,
  Gauge,
  Sparkles,
  Bot,
  GitCompareArrows,
  AlertTriangle,
  Search,
  Package,
  ExternalLink,
} from "lucide-react";
import { Tabs } from "@base-ui/react/tabs";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useMultibandTrackVolume,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/components/ui/button";
import {
  useAgentStore,
  type AgentStoreSnapshot,
  formatMicrocents,
  latestLoss,
  trainingStatusLabel,
} from "@/lib/store";
import { streamAgentEvents } from "@/lib/stream-client";
import { cn } from "@/lib/utils";

interface LiveKitTokenPayload {
  token: string;
  url: string;
}

type StreamState = "idle" | "streaming" | "error";

// ---------------------------------------------------------------------------
// Mock HF model catalogue — replace with /api/hf/models once the endpoint
// is built.  Pre-seeded with repos that match the rehearsal naming convention.
// ---------------------------------------------------------------------------
const MOCK_HF_REPOS: { id: string; label: string }[] = [
  { id: "peytonali/gemma-bbb-lora", label: "peytonali/gemma-bbb-lora" },
  {
    id: "peytonali/bbb-rehearsal-1782650385176",
    label: "peytonali/bbb-rehearsal-1782650385176",
  },
  {
    id: "peytonali/bbb-rehearsal-1782649823102",
    label: "peytonali/bbb-rehearsal-1782649823102",
  },
];

// ---------------------------------------------------------------------------
// Audio visualizer — 24-band bar display for LiveKit narration
// ---------------------------------------------------------------------------
function AgentAudioVisualizer({
  connected = false,
  levels = [],
}: {
  connected?: boolean;
  levels?: number[];
}) {
  return (
    <div
      className={cn(
        "grid h-24 grid-cols-[repeat(24,minmax(0,1fr))] items-end gap-1 rounded-md border border-white/10 bg-zinc-950 p-3",
        connected && "border-emerald-300/40",
      )}
      aria-label="Agent audio visualizer"
    >
      {Array.from({ length: 24 }, (_, index) => {
        const level = levels[index] ?? 0;
        const isAudible = connected && level > 0.015;

        return (
          <span
            key={index}
            className={cn(
              "rounded-t bg-zinc-700 transition-[height,background-color,opacity]",
              isAudible && "bg-emerald-300",
            )}
            style={{
              height: connected
                ? `${Math.max(10, Math.min(100, 10 + level * 90))}%`
                : `${18 + ((index * 17) % 52)}%`,
              opacity: connected
                ? Math.max(0.35, Math.min(1, 0.35 + level * 1.8))
                : 0.55,
            }}
          />
        );
      })}
    </div>
  );
}

const MemoAgentAudioVisualizer = memo(AgentAudioVisualizer);

// ---------------------------------------------------------------------------
// Narration log — plain-language what's-happening feed
// ---------------------------------------------------------------------------
function NarrationLog({ narration }: { narration: string[] }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
        <Radio className="size-3" aria-hidden="true" />
        Narration
      </div>
      <div className="space-y-2">
        {(narration.length > 0
          ? narration
          : ["Waiting for the first event…"]
        ).map((line, index) => (
          <p
            key={`${line.slice(0, 32)}-${index}`}
            className="text-xs leading-5 text-zinc-300"
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gap meter — horizontal bar showing U score (0–1), gradient amber → green
// ---------------------------------------------------------------------------
function GapMeter({ value }: { value: number }) {
  const bounded = Math.min(1, Math.max(0, value));
  return (
    <div className="surface rounded-lg p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <Gauge className="size-4 text-emerald-300" aria-hidden="true" />
          Gap score
        </div>
        <span className="font-mono text-sm text-zinc-300">
          U = {bounded.toFixed(2)}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded bg-zinc-800">
        <div
          className="h-full rounded bg-[linear-gradient(90deg,#f59e0b,#22c55e)] transition-[width] duration-700"
          style={{ width: `${bounded * 100}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Training status timeline — provisioning → streaming → training → saving → complete
// ---------------------------------------------------------------------------
function TrainingTimeline({
  status,
}: {
  status: import("@/lib/store").AgentStoreSnapshot["training"]["status"];
}) {
  const stages = [
    "provisioning",
    "streaming_dataset",
    "training",
    "saving",
    "complete",
  ] as const;
  const activeIndex =
    status === "failed"
      ? -1
      : stages.indexOf(status as (typeof stages)[number]);

  return (
    <ol className="space-y-2">
      {stages.map((s, index) => {
        const complete = activeIndex >= 0 && index < activeIndex;
        const active = s === status;
        const label = trainingStatusLabel(
          s as import("@brickbybrick/core").TrainingStatus,
        );
        return (
          <li
            key={s}
            className={cn(
              "flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm transition-colors",
              complete &&
                "border-emerald-300/20 bg-emerald-500/5 text-emerald-300",
              active && "border-emerald-300/40 bg-emerald-500/10 text-white",
              !complete && !active && "bg-white/[0.02] text-zinc-500",
            )}
          >
            {status === "failed" && index === 0 ? (
              <XCircle className="size-4 text-red-300" aria-hidden="true" />
            ) : complete ? (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            ) : active ? (
              <Loader2
                className="size-4 animate-spin text-emerald-300"
                aria-hidden="true"
              />
            ) : (
              <ArrowRight className="size-4" aria-hidden="true" />
            )}
            <span className="first-letter:capitalize">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================
export function ControlCenter() {
  // ── Store ──────────────────────────────────────────────────────────────
  const snapshot = useAgentStore(
    useShallow((s: AgentStoreSnapshot) => ({
      status: s.status,
      targetPairs: s.targetPairs,
      currentTask: s.currentTask,
      weakCode: s.weakCode,
      strongCode: s.strongCode,
      latestDiff: s.latestDiff,
      latestAuditStep: s.latestAuditStep,
      latestScreenshotSrc: s.latestScreenshotSrc,
      latestDefect: s.latestDefect,
      committedPairs: s.committedPairs,
      committedCount: s.committedCount,
      uScore: s.uScore,
      lastRejectedReason: s.lastRejectedReason,
      recipePatch: s.recipePatch,
      narration: s.narration,
      training: s.training,
      trainingRunId: s.trainingRunId,
      timeline: s.timeline,
      lastEventType: s.lastEventType,
      pulse: s.pulse,
      serveInfo: s.serveInfo,
      evalRunning: s.evalRunning,
      evalReport: s.evalReport,
      derivedConfig: s.derivedConfig,
      sampleTitles: s.sampleTitles,
    })),
  );
  const targetPairs = useAgentStore((s) => s.targetPairs);
  const setTargetPairs = useAgentStore((s) => s.setTargetPairs);
  const consumeEvent = useAgentStore((s) => s.consumeEvent);
  const reset = useAgentStore((s) => s.reset);

  // ── Local state ─────────────────────────────────────────────────────────
  const [intent, setIntent] = useState("");
  const [deriving, setDeriving] = useState(false);
  const [visualState, setVisualState] = useState<StreamState>("idle");
  const [trainingState, setTrainingState] = useState<StreamState>("idle");
  const [manualRunId, setManualRunId] = useState("");
  const [liveKitToken, setLiveKitToken] = useState<LiveKitTokenPayload | null>(
    null,
  );
  const [liveKitError, setLiveKitError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const visualAbortRef = useRef<AbortController | null>(null);
  const trainingAbortRef = useRef<AbortController | null>(null);

  // HF model picker
  const [hfSearch, setHfSearch] = useState("");
  const [hfResults, setHfResults] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [hfSearching, setHfSearching] = useState(false);

  // Try-it
  const [prompt, setPrompt] = useState("");
  const [baseOutput, setBaseOutput] = useState<string | null>(null);
  const [tunedOutput, setTunedOutput] = useState<string | null>(null);

  const trainingRunId = snapshot.trainingRunId || manualRunId;

  // ── Derived ─────────────────────────────────────────────────────────────
  const pulseClass = useMemo(() => {
    if (snapshot.pulse === "committed") return "flash-commit";
    if (snapshot.pulse === "rejected") return "flash-reject";
    return "";
  }, [snapshot.pulse]);

  const lossValue = useMemo(
    () => latestLoss(snapshot.training.loss),
    [snapshot.training.loss],
  );

  const lossData = useMemo(
    () =>
      snapshot.training.loss.length > 0
        ? snapshot.training.loss
        : [
            { step: 0, epoch: 0, loss: 2.4 },
            { step: 1, epoch: 0.1, loss: 2.1 },
          ],
    [snapshot.training.loss],
  );

  // ── Handlers ────────────────────────────────────────────────────────────
  const derivePlan = useCallback(async () => {
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
  }, [intent, consumeEvent]);

  const runVisualLoop = useCallback(async () => {
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
            config: {
              ...(snapshot.derivedConfig ?? {}),
              max_pairs: targetPairs,
            },
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
  }, [snapshot.derivedConfig, targetPairs, consumeEvent]);

  const streamTraining = useCallback(async () => {
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
  }, [trainingRunId, consumeEvent]);

  const connectLiveKit = useCallback(async () => {
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
  }, []);

  const stopStreams = useCallback(() => {
    visualAbortRef.current?.abort();
    trainingAbortRef.current?.abort();
    setVisualState("idle");
    setTrainingState("idle");
  }, []);

  const searchHF = useCallback(async () => {
    setHfSearching(true);
    // Mock: simulate a network call, filtering the pre-seeded catalogue.
    // Replace with a real fetch("/api/hf/models?...") once the endpoint exists.
    await new Promise((r) => setTimeout(r, 400));
    const q = hfSearch.trim().toLowerCase();
    const filtered = q
      ? MOCK_HF_REPOS.filter(
          (r) =>
            r.id.toLowerCase().includes(q) || r.label.toLowerCase().includes(q),
        )
      : MOCK_HF_REPOS;
    setHfResults(filtered);
    setHfSearching(false);
  }, [hfSearch]);

  const runEval = useCallback(async () => {
    if (!trainingRunId) return;
    await streamAgentEvents({
      url: "/api/eval/stream",
      init: {
        method: "POST",
        body: JSON.stringify({ runId: trainingRunId, k: 3 }),
      },
      onEvent: consumeEvent,
    });
  }, [trainingRunId, consumeEvent]);

  const tryModel = useCallback(
    async (model: "base" | "tuned") => {
      if (!prompt.trim()) return;
      const res = await fetch("/api/model/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: trainingRunId, prompt, model }),
      });
      const { code } = (await res.json()) as { code: string };
      if (model === "base") setBaseOutput(code);
      else setTunedOutput(code);
    },
    [prompt, trainingRunId],
  );

  // ── Tabs data ───────────────────────────────────────────────────────────
  const tabRoles = useMemo(
    () => [
      {
        value: "challenger",
        label: "Challenger",
        icon: Sparkles,
        body: snapshot.currentTask?.prompt ?? "Waiting for a challenge…",
        meta: snapshot.currentTask?.target_mechanism ?? "No mechanism selected",
      },
      {
        value: "weak",
        label: "Weak solver",
        icon: Bot,
        body: snapshot.weakCode ?? "Weak solver draft has not arrived.",
        meta: snapshot.latestDefect
          ? `${snapshot.latestDefect.category} / ${snapshot.latestDefect.severity}`
          : "No defect captured",
      },
      {
        value: "auditor",
        label: "Auditor",
        icon: Gauge,
        body: snapshot.latestAuditStep?.intent ?? "Awaiting visual audit step.",
        meta: snapshot.latestAuditStep
          ? `${snapshot.latestAuditStep.viewport.width}x${snapshot.latestAuditStep.viewport.height}`
          : "No viewport",
      },
      {
        value: "strong",
        label: "Strong solver",
        icon: ShieldCheck,
        body: snapshot.strongCode ?? "Strong fix has not arrived.",
        meta: snapshot.latestDiff ?? "No diff",
      },
    ],
    [
      snapshot.currentTask,
      snapshot.weakCode,
      snapshot.latestDefect,
      snapshot.latestAuditStep,
      snapshot.strongCode,
      snapshot.latestDiff,
    ],
  );

  // =========================================================================
  // RENDER
  // =========================================================================
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* ── CONTROL BAR ───────────────────────────────────────────────── */}
      <section className="sticky top-0 z-40 -mx-4 -mt-6 border-b border-white/10 bg-[#0a0a0b]/90 px-4 py-4 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          {/* Start / Stop / Reset */}
          <Button
            onClick={runVisualLoop}
            disabled={visualState === "streaming"}
            className="gap-1.5"
          >
            {visualState === "streaming" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            Start loop
          </Button>
          <Button variant="outline" onClick={stopStreams}>
            <Square className="size-4" aria-hidden="true" />
            Stop
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={reset}
            aria-label="Reset"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </Button>

          {/* Divider */}
          <span className="mx-1 h-5 w-px bg-white/10" aria-hidden="true" />

          {/* Target pairs */}
          <label className="flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 text-xs text-zinc-400">
            Pairs
            <input
              className="h-5 w-12 rounded border border-white/10 bg-black px-1.5 text-xs text-white outline-none focus:border-emerald-300 font-mono"
              min={1}
              max={99}
              type="number"
              value={targetPairs}
              onChange={(e) => setTargetPairs(Number(e.target.value))}
              aria-label="Target pairs"
            />
          </label>

          {/* Status indicator */}
          <span className="live-dot text-xs text-zinc-400">
            {snapshot.status === "idle"
              ? "Ready"
              : snapshot.status.charAt(0).toUpperCase() +
                snapshot.status.slice(1)}
          </span>

          <span className="mx-1 h-5 w-px bg-white/10" aria-hidden="true" />

          {/* HF model picker */}
          <div className="relative flex items-center gap-1.5">
            <Search className="size-3.5 text-zinc-500" aria-hidden="true" />
            <input
              className="h-8 w-40 rounded-md border border-white/10 bg-black px-2 text-xs text-white outline-none focus:border-emerald-300 placeholder:text-zinc-600"
              placeholder="Browse trained models…"
              value={hfSearch}
              onChange={(e) => setHfSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") searchHF();
              }}
              aria-label="Search Hugging Face models"
            />
            <Button
              variant="secondary"
              size="xs"
              onClick={searchHF}
              disabled={hfSearching}
            >
              {hfSearching ? <Loader2 className="size-3 animate-spin" /> : "Go"}
            </Button>

            {/* Dropdown results */}
            {hfResults.length > 0 && (
              <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-white/10 bg-[#0d0d10] p-1 shadow-2xl shadow-black/50">
                {hfResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-white/10",
                      selectedModel === r.id
                        ? "bg-emerald-500/10 text-emerald-200"
                        : "text-zinc-300",
                    )}
                    onClick={() => {
                      setSelectedModel(r.id);
                      setHfResults([]);
                      setHfSearch(r.label);
                    }}
                  >
                    <Package
                      className="size-3.5 shrink-0 text-zinc-500"
                      aria-hidden="true"
                    />
                    <span className="truncate font-mono">{r.label}</span>
                    {selectedModel === r.id && (
                      <CheckCircle2
                        className="ml-auto size-3.5 text-emerald-300"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Visual stream state indicator */}
        {visualState !== "idle" && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            {visualState === "streaming" ? (
              <>
                <Loader2
                  className="size-3 animate-spin text-emerald-300"
                  aria-hidden="true"
                />
                <span className="text-emerald-300">Loop streaming…</span>
              </>
            ) : (
              <>
                <AlertTriangle
                  className="size-3 text-amber-300"
                  aria-hidden="true"
                />
                <span className="text-amber-300">
                  Stream error — check console
                </span>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── INTENT INPUT ───────────────────────────────────────────────── */}
      <section className="animate-reveal flex flex-col gap-2">
        <label className="font-serif text-sm text-zinc-300">
          What should the model get good at?
        </label>
        <div className="flex gap-2">
          <input
            className="h-9 flex-1 rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-emerald-300 placeholder:text-zinc-600"
            placeholder="e.g. a model good at responsive React layouts"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            aria-label="Model intent"
          />
          <Button onClick={derivePlan} disabled={deriving || !intent.trim()}>
            {deriving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Derive plan
          </Button>
        </div>
        {snapshot.derivedConfig ? (
          <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs text-zinc-300">
            <div>
              <span className="text-zinc-500">Framework:</span>{" "}
              <span className="text-white">
                {snapshot.derivedConfig.framework ?? "—"}
              </span>
            </div>
            <div className="mt-1">
              <span className="text-zinc-500">Framing:</span>{" "}
              {snapshot.derivedConfig.domain_framing ?? "—"}
            </div>
            {Object.keys(snapshot.derivedConfig.challenger_weights ?? {})
              .length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {Object.entries(
                  snapshot.derivedConfig.challenger_weights ?? {},
                ).map(([m, w]) => (
                  <span
                    key={m}
                    className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5"
                  >
                    {m} ·{String(w)}
                  </span>
                ))}
              </div>
            )}
            {snapshot.sampleTitles.length > 0 && (
              <div className="mt-2 text-zinc-500">
                e.g. {snapshot.sampleTitles.join(" · ")}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          PHASE 1 — Watch it work
          ═══════════════════════════════════════════════════════════════════ */}
      <section
        className="animate-reveal glass rounded-xl p-5"
        style={{ animationDelay: "0.05s" }}
      >
        <h2 className="font-serif text-xl text-white">Watch it work</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Live audit screenshots and plain-language narration of what the agents
          are doing right now.
        </p>

        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)]">
          {/* Screenshot stream */}
          <div className="flex min-h-[300px] flex-col justify-between rounded-lg border border-white/10 bg-[#050608] p-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-white">
                  Screenshot stream
                </h3>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300/30 px-2 py-0.5 text-xs text-emerald-300">
                  <CircleDot className="size-3" aria-hidden="true" />
                  {snapshot.status}
                </span>
              </div>

              {/* Audio visualizer */}
              <div className="mt-4">
                {liveKitToken ? (
                  <LiveKitRoom
                    token={liveKitToken.token}
                    serverUrl={liveKitToken.url}
                    connect
                    audio={true}
                    video={false}
                    className="contents"
                  >
                    <RoomAudioRenderer />
                    <MemoLiveKitNarrationVisualizer />
                    <MemoMicrophoneControl
                      muted={micMuted}
                      onToggle={() => setMicMuted((m) => !m)}
                    />
                  </LiveKitRoom>
                ) : (
                  <MemoAgentAudioVisualizer />
                )}
              </div>
            </div>

            {/* Connect audio + mic toggle */}
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={connectLiveKit}>
                  <Mic2 className="size-4" aria-hidden="true" />
                  Connect audio narration
                </Button>
                {liveKitToken && (
                  <Button
                    variant={micMuted ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMicMuted((m) => !m)}
                  >
                    {micMuted ? (
                      <MicOff className="size-4" aria-hidden="true" />
                    ) : (
                      <Mic2 className="size-4" aria-hidden="true" />
                    )}
                    {micMuted ? "Mic off" : "Mic on"}
                  </Button>
                )}
              </div>
              {liveKitError && (
                <p className="text-xs leading-5 text-amber-200">
                  {liveKitError}
                </p>
              )}
              <NarrationLog narration={snapshot.narration} />
            </div>
          </div>

          {/* Screenshot display */}
          <div className="min-h-[300px] overflow-hidden rounded-lg border border-white/10 bg-zinc-950">
            {snapshot.latestScreenshotSrc ? (
              <Image
                src={snapshot.latestScreenshotSrc}
                alt="Latest visual audit screenshot"
                width={1280}
                height={720}
                unoptimized
                className="h-full min-h-[300px] w-full object-contain"
              />
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,#111827,#080a0d_45%,#0b1512)] p-6 text-center">
                <ShieldCheck
                  className="size-10 text-emerald-300"
                  aria-hidden="true"
                />
                <p className="max-w-sm text-sm leading-6 text-zinc-400">
                  Audit screenshots appear here as the visual auditor inspects
                  each generated UI.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          PHASE 2 — What it learned
          ═══════════════════════════════════════════════════════════════════ */}
      <section
        className={cn("animate-reveal glass rounded-xl p-5", pulseClass)}
        style={{ animationDelay: "0.1s" }}
      >
        <h2 className="font-serif text-xl text-white">What it learned</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Each adversarial round produces a training pair — or gets filtered out
          by the quality gate.
        </p>

        {/* Top-line metrics */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="surface rounded-lg px-3 py-2.5">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              Pairs committed
            </div>
            <div className="mt-1 font-mono text-lg font-semibold text-white">
              {snapshot.committedCount}{" "}
              <span className="text-sm font-normal text-zinc-500">
                / {snapshot.targetPairs}
              </span>
            </div>
          </div>
          <GapMeter value={snapshot.uScore ?? 0} />
          <div className="surface rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              {snapshot.lastRejectedReason ? (
                <AlertTriangle
                  className="size-4 text-amber-300"
                  aria-hidden="true"
                />
              ) : (
                <CheckCircle2
                  className="size-4 text-emerald-300"
                  aria-hidden="true"
                />
              )}
              Gate state
            </div>
            <p className="mt-1.5 text-xs leading-5 text-zinc-400">
              {snapshot.lastRejectedReason
                ? `Last pair was filtered out: ${snapshot.lastRejectedReason.replace("_", " ")}. ` +
                  "The recipe will be adjusted."
                : snapshot.committedCount > 0
                  ? "Latest pair passed the quality gate and is locked into the training set."
                  : "Waiting for the first pair to be evaluated by the auditor."}
            </p>
          </div>
        </div>

        {/* Tabs: Challenger / Weak / Auditor / Strong */}
        <div className="mt-5">
          <Tabs.Root defaultValue="challenger">
            <Tabs.List className="mb-4 flex flex-wrap gap-1 rounded-lg border border-white/10 bg-black/30 p-1">
              {tabRoles.map((role) => {
                const Icon = role.icon;
                return (
                  <Tabs.Tab
                    key={role.value}
                    value={role.value}
                    className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-zinc-400 outline-none transition hover:bg-white/10 hover:text-white data-[active]:bg-white data-[active]:text-black"
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {role.label}
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>

            {tabRoles.map((role) => {
              const Icon = role.icon;
              return (
                <Tabs.Panel
                  key={role.value}
                  value={role.value}
                  className="min-h-[180px] rounded-lg border border-white/10 bg-black/25 p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Icon
                        className="size-4 text-emerald-300"
                        aria-hidden="true"
                      />
                      {role.label}
                    </div>
                    <span className="max-w-[55%] truncate text-xs text-zinc-500">
                      {role.meta}
                    </span>
                  </div>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-300">
                    {role.body}
                  </pre>
                </Tabs.Panel>
              );
            })}
          </Tabs.Root>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          PHASE 3 — Train it better
          ═══════════════════════════════════════════════════════════════════ */}
      <section
        className="animate-reveal glass rounded-xl p-5"
        style={{ animationDelay: "0.15s" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl text-white">Train it better</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Watch the model improve — live loss curve, instance cost, and
              training pipeline progress.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="h-8 w-56 rounded-md border border-white/10 bg-black px-2.5 text-xs text-white font-mono outline-none focus:border-emerald-300 placeholder:text-zinc-600"
              placeholder="Paste Prime pod ID…"
              value={manualRunId}
              onChange={(e) => setManualRunId(e.target.value)}
              aria-label="Training run ID"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={streamTraining}
              disabled={
                trainingState === "streaming" ||
                trainingRunId.trim().length === 0
              }
            >
              {trainingState === "streaming" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Radio className="size-4" aria-hidden="true" />
              )}
              Stream metrics
            </Button>
          </div>
        </div>

        {/* Top metrics */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="surface rounded-lg px-3 py-2.5">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              Instance
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-white">
              {snapshot.training.instance ?? "standby"}
            </div>
          </div>
          <div className="surface rounded-lg px-3 py-2.5">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              Cost so far
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-white">
              {formatMicrocents(snapshot.training.cost_microcents)}
            </div>
          </div>
          <div className="surface rounded-lg px-3 py-2.5">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              Latest loss
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-white">
              {lossValue === null ? "—" : lossValue.toFixed(3)}
            </div>
          </div>
        </div>

        {/* Loss chart */}
        <div className="mt-4 h-56 rounded-lg border border-white/10 bg-black/25 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lossData}>
              <XAxis
                dataKey="step"
                stroke="#71717a"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                stroke="#71717a"
                tickLine={false}
                axisLine={false}
                width={40}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                cursor={{ stroke: "#334155" }}
                contentStyle={{
                  background: "#09090b",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 6,
                  color: "#fff",
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="loss"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Training pipeline timeline */}
        <div className="mt-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
            <TerminalSquare
              className="size-4 text-emerald-300"
              aria-hidden="true"
            />
            Training pipeline
          </div>
          <TrainingTimeline status={snapshot.training.status} />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          USE THE MODEL
          ═══════════════════════════════════════════════════════════════════ */}
      <section
        className="animate-reveal glass rounded-xl p-5"
        style={{ animationDelay: "0.2s" }}
      >
        <h2 className="font-serif text-xl text-white">Use the model</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Browse trained models on Hugging Face and try them out side by side.
        </p>

        {/* HF model browser */}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs text-zinc-500">
              Search Hugging Face repositories
            </label>
            <div className="flex gap-2">
              <input
                className="h-9 flex-1 rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-emerald-300 placeholder:text-zinc-600 font-mono"
                placeholder="peytonali/gemma-bbb-lora"
                value={hfSearch}
                onChange={(e) => setHfSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") searchHF();
                }}
                aria-label="Search HF repos"
              />
              <Button
                variant="secondary"
                onClick={searchHF}
                disabled={hfSearching}
              >
                {hfSearching ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="size-4" aria-hidden="true" />
                )}
                Search
              </Button>
            </div>
          </div>
        </div>

        {/* Search results */}
        {hfResults.length > 0 && (
          <div className="mt-3 space-y-1 rounded-lg border border-white/10 bg-black/30 p-1">
            {hfResults.map((r) => (
              <button
                key={r.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/10",
                  selectedModel === r.id
                    ? "bg-emerald-500/10 text-emerald-200"
                    : "text-zinc-300",
                )}
                onClick={() => {
                  setSelectedModel(r.id);
                  setHfResults([]);
                  setHfSearch(r.label);
                }}
              >
                <Package
                  className="size-4 shrink-0 text-zinc-500"
                  aria-hidden="true"
                />
                <span className="truncate font-mono">{r.label}</span>
                {selectedModel === r.id && (
                  <CheckCircle2
                    className="ml-auto size-4 text-emerald-300"
                    aria-hidden="true"
                  />
                )}
                <ExternalLink
                  className="size-3.5 text-zinc-600"
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        )}

        {/* Model ready panel (shown when serveInfo is present) */}
        {snapshot.serveInfo && (
          <div className="mt-5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-emerald-300" aria-hidden="true" />
                <h3 className="text-sm font-medium text-white">
                  Model serving — ready
                </h3>
              </div>
              <span className="text-xs text-zinc-500">
                Expires{" "}
                {new Date(snapshot.serveInfo.expiresAt).toLocaleTimeString()}
              </span>
            </div>

            {/* Eval */}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={runEval}
                disabled={snapshot.evalRunning}
              >
                {snapshot.evalRunning ? (
                  <>
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                    Evaluating…
                  </>
                ) : (
                  <>
                    <GitCompareArrows className="size-4" aria-hidden="true" />
                    Run before/after eval
                  </>
                )}
              </Button>
              {snapshot.evalReport && (
                <span className="text-xs text-zinc-300">
                  Tuned vs base:{" "}
                  <span className="text-emerald-400">
                    {snapshot.evalReport.wins}W
                  </span>{" "}
                  / {snapshot.evalReport.ties}T /{" "}
                  <span className="text-rose-400">
                    {snapshot.evalReport.losses}L
                  </span>{" "}
                  · Δscore{" "}
                  <span className="font-mono">
                    {snapshot.evalReport.mean_score_delta.toFixed(3)}
                  </span>
                </span>
              )}
            </div>

            {/* Try-it */}
            <div className="mt-4">
              <label className="mb-1.5 block text-xs text-zinc-500">
                Describe a UI to generate
              </label>
              <input
                className="h-9 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-emerald-300 placeholder:text-zinc-600"
                placeholder="e.g. a responsive pricing grid with three tiers"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => tryModel("base")}
                  disabled={!prompt.trim()}
                >
                  Run base model
                </Button>
                <Button
                  size="sm"
                  onClick={() => tryModel("tuned")}
                  disabled={!prompt.trim()}
                >
                  <Zap className="size-4" aria-hidden="true" />
                  Run tuned model
                </Button>
              </div>

              {/* Side-by-side outputs */}
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="mb-2 text-xs font-medium text-zinc-500">
                    Base model output
                  </div>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-300">
                    {baseOutput ?? "Run base model to see output…"}
                  </pre>
                </div>
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                    <Sparkles className="size-3" aria-hidden="true" />
                    Tuned model output
                  </div>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-300">
                    {tunedOutput ?? "Run tuned model to see output…"}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* No model serving yet */}
        {!snapshot.serveInfo && (
          <div className="mt-5 flex flex-col items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-8 text-center">
            <Cpu className="size-8 text-zinc-600" aria-hidden="true" />
            <p className="max-w-sm text-sm leading-6 text-zinc-500">
              Start a training run to serve the model. Once a run completes,
              you&apos;ll be able to evaluate and try the tuned model here.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// LiveKit narration visualizer — must live inside <LiveKitRoom>
// ---------------------------------------------------------------------------
function LiveKitNarrationVisualizer() {
  const tracks = useTracks([Track.Source.Microphone], {
    onlySubscribed: true,
  });
  const narratorTrack =
    tracks.find((t) => t.participant.identity.startsWith("narrator-")) ??
    tracks[0];
  const levels = useMultibandTrackVolume(narratorTrack, {
    bands: 24,
    updateInterval: 80,
  });

  return (
    <MemoAgentAudioVisualizer
      connected={Boolean(narratorTrack)}
      levels={levels}
    />
  );
}

const MemoLiveKitNarrationVisualizer = memo(LiveKitNarrationVisualizer);

// ---------------------------------------------------------------------------
// Microphone toggle — must live inside <LiveKitRoom> for useLocalParticipant
// ---------------------------------------------------------------------------
function MicrophoneControl({
  muted,
  onToggle,
}: {
  muted: boolean;
  onToggle: () => void;
}) {
  const { localParticipant } = useLocalParticipant();

  // Sync the LiveKit mic state with our muted state
  const prevMuted = useRef(muted);
  useEffect(() => {
    if (prevMuted.current === muted) return;
    prevMuted.current = muted;
    localParticipant?.setMicrophoneEnabled(!muted).catch(() => {});
  }, [muted, localParticipant]);

  return null; // UI is rendered outside the room context
}

const MemoMicrophoneControl = memo(MicrophoneControl);
