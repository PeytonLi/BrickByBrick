import type { Metadata } from 'next'
import './globals.css'
import { Geist } from "next/font/google"
import { cn } from "@/lib/utils"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Nav } from "@/components/nav"

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'BrickByBrick',
  description: 'Closed-Loop Multi-Agent Data Synthesizer',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={cn("dark", "font-sans", geist.variable)}>
      <body className="bg-background text-foreground min-h-screen antialiased">
        <TooltipProvider>
          <div className="relative min-h-screen bg-grain">
            <div className="pointer-events-none fixed inset-0 z-0">
              <div className="absolute inset-0 bg-grid-pattern" />
              <div
                className="absolute top-0 left-1/2 h-[800px] w-[1200px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.06),transparent_70%)] bg-blend-overlay"
                aria-hidden="true"
              />
              <div
                className="absolute bottom-0 right-0 h-[600px] w-[800px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(56,189,248,0.04),transparent_70%)]"
                aria-hidden="true"
              />
            </div>
            <div className="relative z-10">
              <Nav />
              {children}
            </div>
          </div>
        </TooltipProvider>
      </body>
    </html>
  )
}
