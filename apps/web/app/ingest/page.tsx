import { Boxes, Database, GitBranch, Layers } from 'lucide-react'
import { ControlCenter } from '@/components/dashboard/control-center'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export default function IngestPage() {
  return (
    <>
      <section className="border-b border-white/5 bg-white/[0.01] px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex size-10 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <Boxes className="size-5 text-emerald-400" />
            </div>
            <Badge variant="secondary" className="border-emerald-500/20 bg-emerald-500/5">Ingest</Badge>
          </div>
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">Task ingest pipeline</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            The challenger agent generates visual UI assembly tasks, the weak model drafts initial code, and the sandbox launches — all feeding into the break-and-fix loop.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              { icon: Layers, label: 'Challenge bank', desc: 'Curated task library with mechanism coverage' },
              { icon: Database, label: 'Weak draft', desc: 'Gemma 4 generates initial React/CSS output' },
              { icon: GitBranch, label: 'Sandbox spawn', desc: 'Antigravity provisions a browser environment' },
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
