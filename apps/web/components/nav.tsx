'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, AudioLines, Boxes, Dumbbell, FlaskConical } from 'lucide-react'

import { cn } from '@/lib/utils'

const navItems = [
  { href: '/', label: 'Control', icon: Activity },
  { href: '/ingest', label: 'Ingest', icon: Boxes },
  { href: '/synthesis', label: 'Synthesis', icon: FlaskConical },
  { href: '/training', label: 'Training', icon: Dumbbell },
]

export function Nav() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-black/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <Link href="/" className="flex items-center gap-3 text-white">
          <span className="flex size-9 items-center justify-center rounded-md border border-white/15 bg-white/10">
            <AudioLines className="size-4 text-emerald-300" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold leading-5">BrickByBrick</span>
            <span className="block text-xs leading-4 text-zinc-400">Visual data loop</span>
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon
            const active =
              item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-zinc-400 transition hover:bg-white/10 hover:text-white',
                  active && 'bg-white text-black hover:bg-white hover:text-black',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
