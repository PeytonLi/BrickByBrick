'use client'

import { useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import {
  LiveKitRoom,
  RoomAudioRenderer,
} from '@livekit/components-react'
import { Tabs } from '@base-ui/react/tabs'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  Cpu,
  Gauge,
  GitCompareArrows,
  Loader2,
  Mic2,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  XCircle,
  Zap,
} from 'lucide-react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useShallow } from 'zustand/react/shallow'

import { Button } from '@/components/ui/button'
import { Nav } from '@/components/nav'
import {
  formatMicrocents,
  latestLoss,
  trainingStatusLabel,
  useAgentStore,
  type AgentStoreSnapshot,
} from '@/lib/store'
import { streamAgentEvents } from '@/lib/stream-client'
import { cn } from '@/lib/utils'

interface LiveKitTokenPayload {
  token: string
  url: string
}

type StreamState = 'idle' | 'streaming' | 'error'

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
      timeline: state.timeline,
      lastEventType: state.lastEventType,
      pulse: state.pulse,
    })),
  )
  const targetPairs = useAgentStore((state) => state.targetPairs)
  const setTargetPairs = useAgentStore((state) => state.setTargetPairs)
  const consumeEvent = useAgentStore((state) => state.consumeEvent)
  const reset = useAgentStore((state) => state.reset)

  const [visualState, setVisualState] = useState<StreamState>('idle')
  const [trainingState, setTrainingState] = useState<StreamState>('idle')
  const [liveKitToken, setLiveKitToken] = useState<LiveKitTokenPayload | null>(null)
  const [liveKitError, setLiveKitError] = useState<string | null>(null)
  const visualAbortRef = useRef<AbortController | null>(null)
  const trainingAbortRef = useRef<AbortController | null>(null)

  async function runVisualLoop() {
    visualAbortRef.current?.abort()
    const controller = new AbortController()
    visualAbortRef.current = controller
    setVisualState('streaming')

    try {
      await streamAgentEvents({
        url: '/api/agent/visual-loop/stream',
        signal: controller.signal,
        init: {
          method: 'POST',
          body: JSON.stringify({ config: { max_pairs: targetPairs } }),
        },
        onEvent: consumeEvent,
      })
      setVisualState('idle')
    } catch (error) {
      if (!controller.signal.aborted) {
        setVisualState('error')
        consumeEvent({
          type: 'narration',
          text: error instanceof Error ? error.message : 'Visual loop stream failed.',
        })
      }
    }
  }

  async function streamTraining() {
    trainingAbortRef.current?.abort()
    const controller = new AbortController()
    trainingAbortRef.current = controller
    setTrainingState('streaming')

    try {
      await streamAgentEvents({
        url: '/api/training/stream',
        signal: controller.signal,
        init: {
          method: 'POST',
          body: JSON.stringify({ runId: 'demo-run' }),
        },
        onEvent: consumeEvent,
      })
      setTrainingState('idle')
    } catch (error) {
      if (!controller.signal.aborted) {
        setTrainingState('error')
        consumeEvent({
          type: 'narration',
          text: error instanceof Error ? error.message : 'Training stream failed.',
        })
      }
    }
  }

  async function connectLiveKit() {
    setLiveKitError(null)

    try {
      const response = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: 'brickbybrick-control',
          identity: `operator-${crypto.randomUUID().slice(0, 8)}`,
        }),
      })

      if (!response.ok) {
        throw new Error(`LiveKit token request failed with ${response.status}`)
      }

      setLiveKitToken((await response.json()) as LiveKitTokenPayload)
    } catch (error) {
      setLiveKitError(
        error instanceof Error ? error.message : 'Unable to mint a LiveKit token.',
      )
    }
  }

  function stopStreams() {
    visualAbortRef.current?.abort()
    trainingAbortRef.current?.abort()
    setVisualState('idle')
    setTrainingState('idle')
  }

  return (
    <div className="min-h-screen bg-[#080a0d] text-zinc-100">
      <Nav />
      <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Closed-loop visual data control center
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Watch the agent generate challenges, audit weak UI code, commit high-gap training pairs, and stream LoRA telemetry.
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
            <Button onClick={runVisualLoop} disabled={visualState === 'streaming'}>
              {visualState === 'streaming' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              Run loop
            </Button>
            <Button
              variant="secondary"
              onClick={streamTraining}
              disabled={trainingState === 'streaming'}
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
      </main>
    </div>
  )
}

interface SectionProps {
  snapshot: AgentStoreSnapshot
}

interface LiveMediaRoomProps extends SectionProps {
  liveKitToken: LiveKitTokenPayload | null
  liveKitError: string | null
  onConnectLiveKit: () => void
}

function LiveMediaRoom({
  snapshot,
  liveKitToken,
  liveKitError,
  onConnectLiveKit,
}: LiveMediaRoomProps) {
  return (
    <section
      aria-labelledby="live-media-room-title"
      className="grid gap-5 rounded-lg border border-white/10 bg-[#050608] p-4 shadow-2xl shadow-black/40 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)]"
      data-testid="live-media-room"
    >
      <div className="flex min-h-[300px] flex-col justify-between rounded-md border border-emerald-300/20 bg-black p-4">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="live-media-room-title" className="text-lg font-semibold text-white">
                A - Live Media Room
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                LiveKit narration and visual audit frames.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-md border border-emerald-300/30 px-2 py-1 text-xs text-emerald-200">
              <CircleDot className="size-3" aria-hidden="true" />
              {snapshot.status}
            </span>
          </div>

          <div className="mt-5">
            {liveKitToken ? (
              <LiveKitRoom
                token={liveKitToken.token}
                serverUrl={liveKitToken.url}
                connect
                audio={false}
                video={false}
                className="contents"
              >
                <RoomAudioRenderer />
                <AgentAudioVisualizer active={snapshot.status !== 'idle'} />
              </LiveKitRoom>
            ) : (
              <AgentAudioVisualizer active={snapshot.status !== 'idle'} />
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          <Button variant="outline" onClick={onConnectLiveKit}>
            <Mic2 className="size-4" aria-hidden="true" />
            Connect audio room
          </Button>
          {liveKitError ? (
            <p className="text-xs leading-5 text-amber-200">{liveKitError}</p>
          ) : (
            <p className="text-xs leading-5 text-zinc-500">
              Token route stays server-side; the room connects only after this control is used.
            </p>
          )}
          <NarrationLog narration={snapshot.narration} />
        </div>
      </div>

      <div className="min-h-[300px] overflow-hidden rounded-md border border-white/10 bg-zinc-950">
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
            <ShieldCheck className="size-10 text-emerald-300" aria-hidden="true" />
            <p className="max-w-sm text-sm leading-6 text-zinc-400">
              Audit screenshots will swap here on each audit_step event.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function AgentAudioVisualizer({ active }: { active: boolean }) {
  return (
    <div
      className={cn(
        'grid h-24 grid-cols-[repeat(24,minmax(0,1fr))] items-end gap-1 rounded-md border border-white/10 bg-zinc-950 p-3',
        active && 'border-emerald-300/40',
      )}
      aria-label="Agent audio visualizer"
    >
      {Array.from({ length: 24 }, (_, index) => (
        <span
          key={index}
          className={cn(
            'rounded-t bg-zinc-700 transition-all',
            active && 'audio-bar-active bg-emerald-300',
          )}
          style={{
            height: `${18 + ((index * 17) % 52)}%`,
            animationDelay: `${index * 45}ms`,
          }}
        />
      ))}
    </div>
  )
}

function NarrationLog({ narration }: { narration: string[] }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
        <Radio className="size-3" aria-hidden="true" />
        Narration
      </div>
      <div className="space-y-2">
        {(narration.length > 0 ? narration : ['No narration events yet.']).map(
          (line, index) => (
            <p key={`${line}-${index}`} className="text-xs leading-5 text-zinc-300">
              {line}
            </p>
          ),
        )}
      </div>
    </div>
  )
}

function AdversarialMatrix({ snapshot }: SectionProps) {
  const pulseClass =
    snapshot.pulse === 'committed'
      ? 'pulse-committed'
      : snapshot.pulse === 'rejected'
        ? 'pulse-rejected'
        : ''

  const roles = [
    {
      value: 'challenger',
      label: 'Challenger',
      icon: Sparkles,
      body: snapshot.currentTask?.prompt ?? 'Waiting for a challenge.',
      meta: snapshot.currentTask?.target_mechanism ?? 'No mechanism selected',
    },
    {
      value: 'weak',
      label: 'Weak solver',
      icon: Bot,
      body: snapshot.weakCode ?? 'Weak draft has not arrived.',
      meta: snapshot.latestDefect
        ? `${snapshot.latestDefect.category} / ${snapshot.latestDefect.severity}`
        : 'No defect captured',
    },
    {
      value: 'auditor',
      label: 'Visual auditor',
      icon: Gauge,
      body: snapshot.latestAuditStep?.intent ?? 'Awaiting visual audit step.',
      meta: snapshot.latestAuditStep
        ? `${snapshot.latestAuditStep.viewport.width}x${snapshot.latestAuditStep.viewport.height}`
        : 'No viewport',
    },
    {
      value: 'strong',
      label: 'Strong solver',
      icon: ShieldCheck,
      body: snapshot.strongCode ?? 'Strong fix has not arrived.',
      meta: snapshot.latestDiff ?? 'No diff',
    },
  ]

  return (
    <section
      aria-labelledby="adversarial-matrix-title"
      className={cn('rounded-lg border border-white/10 bg-[#101217] p-4', pulseClass)}
      data-testid="adversarial-matrix"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="adversarial-matrix-title" className="text-lg font-semibold text-white">
            B - Adversarial Matrix
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Challenge, weak draft, visual audit, and strong repair.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right">
          <Metric label="Pairs" value={`${snapshot.committedCount} / ${snapshot.targetPairs}`} />
          <Metric label="U gap" value={snapshot.uScore === null ? '--' : snapshot.uScore.toFixed(2)} />
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <GapMeter value={snapshot.uScore ?? 0} />
        <div className="rounded-md border border-white/10 bg-black/25 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            {snapshot.lastRejectedReason ? (
              <AlertTriangle className="size-4 text-amber-300" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-4 text-emerald-300" aria-hidden="true" />
            )}
            Gate state
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            {snapshot.lastRejectedReason
              ? `Filtered out: ${snapshot.lastRejectedReason.replace('_', ' ')}`
              : snapshot.committedCount > 0
                ? 'Latest accepted pair is locked.'
                : 'Waiting for a pair decision.'}
          </p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/25 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <GitCompareArrows className="size-4 text-sky-300" aria-hidden="true" />
            Recipe focus
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            {snapshot.recipePatch?.focus_mechanism ?? 'Default sampling weights'}
          </p>
        </div>
      </div>

      <Tabs.Root defaultValue="challenger">
        <Tabs.List className="mb-3 flex flex-wrap gap-1 rounded-md border border-white/10 bg-black/30 p-1">
          {roles.map((role) => {
            const Icon = role.icon
            return (
              <Tabs.Tab
                key={role.value}
                value={role.value}
                className="inline-flex h-9 items-center gap-2 rounded px-3 text-sm font-medium text-zinc-400 outline-none transition hover:bg-white/10 hover:text-white data-[active]:bg-white data-[active]:text-black"
              >
                <Icon className="size-4" aria-hidden="true" />
                {role.label}
              </Tabs.Tab>
            )
          })}
        </Tabs.List>

        {roles.map((role) => {
          const Icon = role.icon
          return (
            <Tabs.Panel
              key={role.value}
              value={role.value}
              className="min-h-48 rounded-md border border-white/10 bg-black/25 p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Icon className="size-4 text-emerald-300" aria-hidden="true" />
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
          )
        })}
      </Tabs.Root>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/25 px-3 py-2">
      <div className="text-xs uppercase tracking-normal text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function GapMeter({ value }: { value: number }) {
  const bounded = Math.min(1, Math.max(0, value))
  return (
    <div className="rounded-md border border-white/10 bg-black/25 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <Zap className="size-4 text-emerald-300" aria-hidden="true" />
          Live U gap
        </div>
        <span className="font-mono text-sm text-zinc-300">{bounded.toFixed(2)}</span>
      </div>
      <div className="h-3 overflow-hidden rounded bg-zinc-800">
        <div
          className="h-full rounded bg-[linear-gradient(90deg,#f59e0b,#22c55e)] transition-[width]"
          style={{ width: `${bounded * 100}%` }}
        />
      </div>
    </div>
  )
}

function WeightComputeConsole({ snapshot }: SectionProps) {
  const lossValue = latestLoss(snapshot.training.loss)
  const statuses = ['provisioning', 'streaming_dataset', 'training', 'saving', 'complete']
  const activeIndex = statuses.indexOf(snapshot.training.status)

  const lossData = useMemo(
    () =>
      snapshot.training.loss.length > 0
        ? snapshot.training.loss
        : [
            { step: 0, epoch: 0, loss: 2.4 },
            { step: 1, epoch: 0.1, loss: 2.1 },
          ],
    [snapshot.training.loss],
  )

  return (
    <section
      aria-labelledby="weight-compute-console-title"
      className="rounded-lg border border-white/10 bg-[#0d1117] p-4"
      data-testid="weight-compute-console"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id="weight-compute-console-title" className="text-lg font-semibold text-white">
            C - Weight Compute Console
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Training metrics, active instance, cost, and lifecycle.
          </p>
        </div>
        <Cpu className="size-5 text-sky-300" aria-hidden="true" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
        <Metric label="Instance" value={snapshot.training.instance ?? 'standby'} />
        <Metric label="Cost" value={formatMicrocents(snapshot.training.cost_microcents)} />
        <Metric label="Loss" value={lossValue === null ? '--' : lossValue.toFixed(3)} />
      </div>

      <div className="mt-4 h-56 rounded-md border border-white/10 bg-black/25 p-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={lossData}>
            <XAxis dataKey="step" stroke="#71717a" tickLine={false} axisLine={false} />
            <YAxis stroke="#71717a" tickLine={false} axisLine={false} width={36} />
            <Tooltip
              cursor={{ stroke: '#334155' }}
              contentStyle={{
                background: '#09090b',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                color: '#fff',
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

      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <TerminalSquare className="size-4 text-emerald-300" aria-hidden="true" />
          Status timeline
        </div>
        <ol className="space-y-2">
          {statuses.map((status, index) => {
            const complete = activeIndex >= 0 && index < activeIndex
            const active = status === snapshot.training.status
            return (
              <li
                key={status}
                className={cn(
                  'flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-400',
                  complete && 'text-emerald-300',
                  active && 'border-emerald-300/40 bg-emerald-300/10 text-white',
                )}
              >
                {snapshot.training.status === 'failed' && index === 0 ? (
                  <XCircle className="size-4 text-red-300" aria-hidden="true" />
                ) : complete ? (
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                ) : active ? (
                  <Activity className="size-4 text-emerald-300" aria-hidden="true" />
                ) : (
                  <ArrowRight className="size-4" aria-hidden="true" />
                )}
                {trainingStatusLabel(status as typeof snapshot.training.status)}
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
