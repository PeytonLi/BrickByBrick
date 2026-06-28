"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AudioLines,
  Cpu,
  BarChart3,
  Layers,
  Terminal,
} from "lucide-react";

import { cn } from "@/lib/utils";

const primaryNav = [
  { href: "/", label: "Live Demo", icon: Activity },
  { href: "/training", label: "Training", icon: BarChart3 },
  { href: "/models", label: "Models", icon: Layers },
];

const secondaryNav = [
  {
    href: "https://huggingface.co/peytonali/gemma-bbb-lora",
    label: "HF Adapter",
    icon: Cpu,
    external: true,
  },
  {
    href: "https://github.com/PeytonLi/BrickByBrick",
    label: "GitHub",
    icon: Terminal,
    external: true,
  },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-white/[0.06] bg-[#07080a]">
      {/* Logo */}
      <Link
        href="/"
        className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4"
      >
        <span className="flex size-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
          <AudioLines className="size-4 text-emerald-400" aria-hidden="true" />
        </span>
        <span>
          <span className="font-serif text-sm font-medium text-white">
            BrickByBrick
          </span>
          <span className="block text-[10px] uppercase tracking-widest text-zinc-600">
            Data loop
          </span>
        </span>
      </Link>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
        <div className="mb-3 px-2">
          <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">
            Navigation
          </span>
        </div>
        <ul className="space-y-0.5">
          {primaryNav.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname?.startsWith(item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                    active
                      ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                      : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200 border border-transparent",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      active
                        ? "text-emerald-400"
                        : "text-zinc-500 group-hover:text-zinc-400",
                    )}
                    aria-hidden="true"
                  />
                  {item.label}
                  {active && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* External links */}
        <div className="mb-2 mt-6 px-2">
          <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">
            Resources
          </span>
        </div>
        <ul className="space-y-0.5">
          {secondaryNav.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-zinc-500 transition-all duration-150 hover:bg-white/[0.04] hover:text-zinc-400"
                >
                  <Icon
                    className="size-4 shrink-0 text-zinc-600 group-hover:text-zinc-500"
                    aria-hidden="true"
                  />
                  {item.label}
                  <svg
                    className="ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-50"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-white/[0.06] px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(63,185,80,0.4)]" />
          <span className="text-[11px] text-zinc-600">System online</span>
        </div>
      </div>
    </aside>
  );
}
