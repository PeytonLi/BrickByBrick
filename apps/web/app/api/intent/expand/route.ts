// apps/web/app/api/intent/expand/route.ts
import { NextResponse } from "next/server";
import type { GenerationConfig } from "@brickbybrick/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExpandResult {
  config: Partial<GenerationConfig>;
  sample_titles: string[];
  warning?: string;
}

function demoExpand(intent: string): ExpandResult {
  return {
    config: {
      intent,
      domain_framing: `Front-end UI tasks aligned to: ${intent}`,
      framework: "react",
      challenger_weights: {
        "responsive-card-grid": 3,
        "modal-focus-trap": 2,
        "long-text-truncation": 2,
      },
    },
    sample_titles: [
      "Responsive pricing grid",
      "Accessible modal dialog",
      "Truncated card titles",
    ],
  };
}

export async function POST(request: Request) {
  let intent = "";
  try {
    intent = (
      ((await request.json()) as { intent?: string }).intent ?? ""
    ).trim();
  } catch {
    intent = "";
  }
  if (!intent) {
    return NextResponse.json({ error: "intent is required" }, { status: 400 });
  }

  if (process.env.BBB_DEMO_MODE === "1") {
    return NextResponse.json(demoExpand(intent));
  }

  try {
    const { expandIntent } = (await import("@brickbybrick/inference")) as {
      expandIntent: (t: string) => Promise<ExpandResult>;
    };
    return NextResponse.json(await expandIntent(intent));
  } catch (error) {
    // API call failed — generate a sensible fallback instead of blank fields
    const fallback = demoExpand(intent);
    fallback.warning =
      error instanceof Error ? error.message : "intent expansion failed";
    return NextResponse.json(fallback);
  }
}
