"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, AudioLines } from "lucide-react";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Live Demo", icon: Activity },
  { href: "/models", label: "Models", icon: AudioLines },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5">
            <AudioLines
              className="size-4 text-emerald-400"
              aria-hidden="true"
            />
          </span>
          <span>
            <span className="font-serif text-base text-white">
              BrickByBrick
            </span>
            <span className="ml-2 text-xs text-zinc-500">Visual data loop</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname?.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-zinc-400 transition hover:bg-white/5 hover:text-white",
                  active &&
                    "bg-white text-black hover:bg-white hover:text-black",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
