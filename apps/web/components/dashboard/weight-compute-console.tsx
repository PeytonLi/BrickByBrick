'use client'

import { useMemo } from 'react'
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Cpu,
  TerminalSquare,
  XCircle,
} from 'lucide-react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  formatMicrocents,
  latestLoss,
  trainingStatusLabel,
  type AgentStoreSnapshot,
} from '@/lib/store'
import { cn } from '@/lib/utils'
import { Metric } from './adversarial-matrix'

interface SectionProps {
  snapshot: AgentStoreSnapshot
}

export function WeightComputeConsole({ snapshot }: SectionProps) {
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
