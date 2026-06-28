/**
 * Gemini client for the engine: the strong solver (Gemini 3.1 Pro), the weak /
 * target solver (Gemma 4, or a Flash fallback), and text embeddings for the
 * diversity gate. Everything runs on the single GEMINI_API_KEY. See
 * docs/ARCHITECTURE.md §1. withRetry mirrors the reference branch 2473c0f.
 */

import type { VisualTask, Defect } from "@brickbybrick/core";
import { STRONG_SOLVER_SYSTEM, WEAK_SOLVER_SYSTEM } from "./prompts";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Model ids resolve from env so the setup spike's fallbacks (e.g. WEAK_MODEL=
 *  gemini-3.5-flash if Gemma 4 404s) take effect without code changes. */
export const STRONG_MODEL = () =>
  process.env.STRONG_MODEL || "gemini-3.1-pro-preview";
export const WEAK_MODEL = () => process.env.WEAK_MODEL || "gemma-4-26b-a4b-it";
export const EMBED_MODEL = () =>
  process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  /** Injectable for tests; defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) =>
  new Promise<void>((res) => setTimeout(res, ms));

/** Exponential backoff with jitter. Retries `retries` times after the first try. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { retries = 3, baseDelayMs = 1000, sleep = realSleep } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      const jitter = Math.random() * 500;
      await sleep(baseDelayMs * Math.pow(2, attempt) + jitter);
    }
  }
  throw lastError;
}

/** Strip ```lang … ``` markdown fences an LLM may wrap code in. */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

interface GenerateParts {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** One-shot generateContent call against a Gemini/Gemma model, with retry. */
export async function generateContent(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  opts: RetryOptions = {},
): Promise<string> {
  return withRetry(async () => {
    const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini ${model} → ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as GenerateParts;
    return (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");
  }, opts);
}

function describeTask(task: VisualTask): string {
  const criteria = task.criteria
    .map((c) => `- (${c.weight}) ${c.id}: ${c.description}`)
    .join("\n");
  return [
    `UI task: ${task.prompt}`,
    `Target mechanism: ${task.target_mechanism}`,
    `Acceptance criteria:\n${criteria}`,
  ].join("\n\n");
}

/** The weak / target model's first attempt at the UI task (Gemma 4 by default). */
export async function weakSolver(
  task: VisualTask,
  opts: RetryOptions = {},
): Promise<string> {
  const out = await generateContent(
    WEAK_MODEL(),
    WEAK_SOLVER_SYSTEM,
    describeTask(task),
    opts,
  );
  return stripCodeFences(out);
}

/**
 * The strong model's fix for the audited defect (Gemini 3.1 Pro). Follows the
 * brief's `strongSolver(task, defect)` interface; `weakCode` is optional so the
 * loop can hand the model the exact implementation it is repairing.
 */
export async function strongSolver(
  task: VisualTask,
  defect: Defect,
  weakCode?: string,
  opts: RetryOptions = {},
): Promise<string> {
  const parts = [
    describeTask(task),
    `A visual audit found a ${defect.severity} ${defect.category} defect.`,
    `DOM / console trace:\n${defect.dom_trace}`,
  ];
  if (weakCode) parts.push(`The implementation to fix:\n${weakCode}`);
  parts.push(
    "Return the corrected implementation that passes every criterion.",
  );
  const out = await generateContent(
    STRONG_MODEL(),
    STRONG_SOLVER_SYSTEM,
    parts.join("\n\n"),
    opts,
  );
  return stripCodeFences(out);
}

/** Embed text into a vector for the cosine diversity gate (MATH §3). */
export async function embed(
  text: string,
  opts: RetryOptions = {},
): Promise<number[]> {
  return withRetry(async () => {
    const model = EMBED_MODEL();
    const res = await fetch(`${GEMINI_BASE}/models/${model}:embedContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    });
    if (!res.ok) {
      throw new Error(
        `Gemini embed ${model} → ${res.status}: ${await res.text()}`,
      );
    }
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    return data.embedding?.values ?? [];
  }, opts);
}
