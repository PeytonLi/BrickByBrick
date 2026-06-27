import { FlaskConical, Gauge, GitCompareArrows, Microscope } from 'lucide-react'
import { ControlCenter } from '@/components/dashboard/control-center'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export default function SynthesisPage() {
  return (
    <>
      <section className="border-b border-white/5 bg-white/[0.01] px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex size-10 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <FlaskConical className="size-5 text-emerald-400" />
            </div>
            <Badge variant="secondary" className="border-emerald-500/20 bg-emerald-500/5">Synthesis</Badge>
          </div>
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">Pair synthesis engine</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            The visual auditor finds defects, the strong solver generates fixes, and the discriminative gap filter decides which pairs survive.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              { icon: Microscope, label: 'Visual audit', desc: 'Antigravity browser captures screenshots & DOM trace' },
              { icon: Gauge, label: 'U gap filter', desc: 'Discriminative gap U ≥ 0.4 gates pair acceptance' },
              { icon: GitCompareArrows, label: 'Diversity gate', desc: 'Cosine similarity < 0.82 prevents redundant pairs' },
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
