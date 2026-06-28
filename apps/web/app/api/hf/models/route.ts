import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HFModel {
  id: string;
  author: string;
  tags: string[];
  pipeline_tag?: string;
  lastModified: string;
}

export async function GET() {
  const hfToken = process.env.HF_TOKEN;
  const hubRepo = process.env.BBB_HF_HUB_REPO;

  const namespace = hubRepo?.split("/")[0] || null;

  if (!namespace) {
    return NextResponse.json(
      { models: [], error: "BBB_HF_HUB_REPO not configured" },
      { status: 200 },
    );
  }

  try {
    const url = `https://huggingface.co/api/models?author=${encodeURIComponent(namespace)}&limit=50&sort=lastModified&direction=-1`;
    const res = await fetch(url, {
      headers: hfToken ? { Authorization: `Bearer ${hfToken}` } : {},
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { models: [], error: `HF API returned ${res.status}` },
        { status: 200 },
      );
    }

    const all = (await res.json()) as HFModel[];
    const models = all.map((m) => ({
      id: m.id,
      label: m.id,
      lastModified: m.lastModified,
    }));

    return NextResponse.json({ models });
  } catch {
    return NextResponse.json(
      { models: [], error: "Failed to reach HF API" },
      { status: 200 },
    );
  }
}
