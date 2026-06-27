'use client'

import { Tabs } from '@base-ui/react/tabs'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Gauge,
  GitCompareArrows,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react'

import { type AgentStoreSnapshot } from '@/lib/store'
import { cn } from '@/lib/utils'

interface SectionProps {
  snapshot: AgentStoreSnapshot
}

export function AdversarialMatrix({ snapshot }: SectionProps) {
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

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/25 px-3 py-2">
      <div className="text-xs uppercase tracking-normal text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

export function GapMeter({ value }: { value: number }) {
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
