import type { Metadata } from 'next'
import './globals.css'

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
    <html lang="en" className="dark">
      <body className="bg-background text-white min-h-screen">
        {children}
      </body>
    </html>
  )
}
