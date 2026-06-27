import { Cpu, Dumbbell, LineChart, Activity } from 'lucide-react'
import { ControlCenter } from '@/components/dashboard/control-center'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export default function TrainingPage() {
  return (
    <>
      <section className="border-b border-white/5 bg-white/[0.01] px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex size-10 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <Dumbbell className="size-5 text-emerald-400" />
            </div>
            <Badge variant="secondary" className="border-emerald-500/20 bg-emerald-500/5">Training</Badge>
          </div>
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">Weight compute console</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Prime Intellect spot GPU nodes run LoRA fine-tuning on committed pairs. Live loss curve, cost tracking, and lifecycle status.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              { icon: Cpu, label: 'GPU provisioning', desc: 'H100 spot nodes via Prime Intellect CLI' },
              { icon: LineChart, label: 'Loss telemetry', desc: 'Live streaming loss curve from training run' },
              { icon: Activity, label: 'Adapter export', desc: 'Checkpoint fetch and weight delivery' },
            ].map((item) => (
              <Card key={item.label} className="border-white/5 bg-white/[0.02]">
                <CardHeader>
                  <item.icon className="size-5 text-emerald-400/60" />
                  <CardTitle className="text-sm text-white">{item.label}</CardTitle>
                  <CardDescription className="text-xs">{item.desc}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>
      <Separator className="bg-white/5" />
      <ControlCenter />
    </>
  )
}
