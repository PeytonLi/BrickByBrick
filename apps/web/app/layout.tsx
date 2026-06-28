import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Nav } from "@/components/nav";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "BrickByBrick",
  description: "Closed-Loop Multi-Agent Data Synthesizer",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("dark", "font-sans", geist.variable)}>
      <body className="min-h-screen bg-[#090a0d] text-foreground antialiased">
        <TooltipProvider>
          <Nav />
          <main className="ml-56">{children}</main>
        </TooltipProvider>
      </body>
    </html>
  );
}
