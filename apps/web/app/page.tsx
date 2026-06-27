import Link from 'next/link'
import { ArrowDown, ArrowRight, Sparkles, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ControlCenter } from '@/components/dashboard/control-center'

export default function HomePage() {
  return (
    <>
      <section className="relative flex min-h-[calc(100vh-57px)] flex-col items-center justify-center overflow-hidden px-4 py-20 text-center">
        <div className="pointer-events-none absolute inset-0 z-0">
          <div className="bg-drift absolute top-1/4 left-1/4 h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(34,197,94,0.08),transparent_70%)] blur-3xl" />
          <div className="bg-drift absolute right-1/4 bottom-1/4 h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.06),transparent_70%)] blur-3xl" style={{ animationDelay: '-7s' }} />
        </div>

        <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center gap-6">
          <div className="hero-reveal" style={{ animationDelay: '0.1s', opacity: 0 }}>
            <Badge variant="secondary" className="gap-1.5 border-emerald-500/20 bg-emerald-500/5 px-3 py-1">
              <Sparkles className="size-3 text-emerald-400" />
              <span className="text-emerald-300/90">Closed-loop RSI platform</span>
            </Badge>
          </div>

          <h1
            className="hero-reveal bg-gradient-to-b from-white via-white to-zinc-400 bg-clip-text text-5xl font-bold leading-tight tracking-tight text-transparent sm:text-6xl md:text-7xl"
            style={{ animationDelay: '0.25s', opacity: 0 }}
          >
            Train AI to see
            <br />
            what it gets wrong
          </h1>

          <p
            className="hero-reveal max-w-2xl text-lg leading-relaxed text-zinc-400 sm:text-xl"
            style={{ animationDelay: '0.4s', opacity: 0 }}
          >
            BrickByBrick finds a small model&apos;s UI-coding blind spots, turns them into a
            curated synthetic training dataset, and fine-tunes the model on real GPUs — all
            live, all autonomous.
          </p>

          <div
            className="hero-reveal flex flex-wrap items-center justify-center gap-3 pt-4"
            style={{ animationDelay: '0.55s', opacity: 0 }}
          >
            <Button size="lg" className="glow-accent gap-2 px-6">
              <Zap className="size-4" />
              Launch control center
              <ArrowRight className="size-4" />
            </Button>
            <Link
              href="/ingest"
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 text-sm font-medium text-secondary-foreground whitespace-nowrap transition-all hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]"
            >
              Explore ingest pipeline
            </Link>
          </div>

          <div
            className="hero-reveal grid w-full max-w-2xl grid-cols-3 gap-4 pt-12 text-left"
            style={{ animationDelay: '0.7s', opacity: 0 }}
          >
            {[
              {
                value: 'Visual',
                label: 'Antigravity sandbox runs real browser audits, finds layout & overflow bugs',
              },
              {
                value: 'Discriminative',
                label: 'Only high-gap pairs survive — U = S(strong) − S(weak) ≥ 0.4',
              },
              {
                value: 'Live LoRA',
                label: 'Prime Intellect spot GPU nodes fine-tune Gemma on committed pairs',
              },
            ].map((item) => (
              <div
                key={item.value}
                className="rounded-xl border border-white/5 bg-white/[0.02] p-5 backdrop-blur-sm"
              >
                <p className="text-xs font-medium uppercase tracking-wider text-emerald-400/80">
                  {item.value}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">{item.label}</p>
              </div>
            ))}
          </div>

          <div
            className="hero-reveal pt-16"
            style={{ animationDelay: '0.85s', opacity: 0 }}
          >
            <ArrowDown className="size-5 animate-bounce text-zinc-600" />
          </div>
        </div>
      </section>

      <section className="relative z-10 border-t border-white/5 bg-black/20 backdrop-blur-sm">
        <ControlCenter />
      </section>
    </>
  )
}
