import type {
  AuditStep,
  DefectCategory,
  Severity,
  Viewport,
} from "@brickbybrick/core";
import { withRetry, type RetryOptions } from "./gemini";

/**
 * Wrapper over the Antigravity Managed Agents (Interactions API). The managed
 * agent writes code, runs a server, drives a real browser (via its own Playwright
 * in `code_execution`), and reports back. Runs on the same GEMINI_API_KEY.
 *
 * Protocol (captured live by scripts/spike/antigravity.mjs, fixtures in
 * __fixtures__/): a typed Server-Sent-Events stream. Each event is
 *   event: <event_type>\n
 *   data: <json>\n\n
 * with event types interaction.created / interaction.status_update /
 * step.start|delta|stop / interaction.completed|failed. The terminal
 * interaction.{completed,failed} event carries the whole consolidated
 * `interaction` object: { id, environment_id, status, steps[] }.
 *
 * Screenshots are NOT in the stream — the agent saves PNGs to the sandbox
 * filesystem, which the Interactions API does NOT expose for download (there is
 * no environment/Files endpoint: the sandbox is owned by the interaction
 * lifecycle, not a retrievable resource). So the audit prompt makes the agent
 * print small base64 JPEG thumbnails wrapped in <<<AUDIT_STEP>>>…<<<END>>>
 * sentinels (parsed by extractAuditSteps); these both stream to the UI live AND
 * are the dataset's image source. The verdict rides the final model_output text
 * as a <<<VERDICT>>>…<<<END>>> JSON block (parsed by parseAuditReport).
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

function agentId(): string {
  return process.env.ANTIGRAVITY_AGENT || "antigravity-preview-05-2026";
}

/** A step from the consolidated interaction (loose — we read only a few fields). */
export interface InteractionStep {
  type: string;
  name?: string;
  arguments?: unknown;
  /** stdout of a code_execution_result step (where thumbnails are printed) */
  result?: string;
  /** content blocks of a model_output step */
  content?: Array<{ text?: string; type?: string }>;
  [k: string]: unknown;
}

/**
 * Token accounting the API reports on the consolidated interaction (top-level,
 * alongside id/status/steps). We read only the totals we bill on; everything
 * else (per-modality breakdowns) is ignored.
 */
export interface AntigravityUsage {
  total_tokens?: number;
  total_input_tokens?: number;
  total_cached_tokens?: number;
  total_output_tokens?: number;
  total_thought_tokens?: number;
  total_tool_use_tokens?: number;
  [k: string]: unknown;
}

export interface InteractionResult {
  id: string;
  environmentId: string;
  /** 'in_progress' | 'completed' | 'failed' */
  status: string;
  steps: InteractionStep[];
  /** concatenated model_output text — the agent's final report */
  outputText: string;
  /** token usage reported on the consolidated interaction (for cost) */
  usage?: AntigravityUsage;
}

interface SSEFrame {
  event_type?: string;
  interaction?: {
    id?: string;
    environment_id?: string;
    status?: string;
    steps?: InteractionStep[];
    usage?: AntigravityUsage;
  };
  interaction_id?: string;
  status?: string;
  [k: string]: unknown;
}

/** Concatenate the text of every model_output step (the agent's report). */
function outputTextFromSteps(steps: InteractionStep[]): string {
  const parts: string[] = [];
  for (const s of steps) {
    if (s.type !== "model_output" || !Array.isArray(s.content)) continue;
    for (const c of s.content)
      if (typeof c.text === "string") parts.push(c.text);
  }
  return parts.join("\n");
}

/**
 * Fold a raw SSE stream into a single consolidated InteractionResult. The
 * terminal interaction.{completed,failed} event supplies the authoritative
 * steps[]; earlier events fill id/status as they arrive.
 */
export function parseInteractionStream(raw: string): InteractionResult {
  const result: InteractionResult = {
    id: "",
    environmentId: "",
    status: "",
    steps: [],
    outputText: "",
  };
  // Events are separated by a blank line; each `data:` payload is single-line JSON.
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice("data:".length).trim());
    if (!dataLines.length) continue;
    const payload = dataLines.join("\n");
    if (!payload || payload === "[DONE]") continue;
    let frame: SSEFrame;
    try {
      frame = JSON.parse(payload) as SSEFrame;
    } catch {
      continue;
    }
    const it = frame.interaction;
    if (it && typeof it === "object") {
      if (it.id) result.id = it.id;
      if (it.environment_id) result.environmentId = it.environment_id;
      if (it.status) result.status = it.status;
      if (Array.isArray(it.steps)) result.steps = it.steps;
      if (it.usage) result.usage = it.usage;
    } else {
      if (frame.interaction_id && !result.id) result.id = frame.interaction_id;
      if (typeof frame.status === "string") result.status = frame.status;
    }
  }
  result.outputText = outputTextFromSteps(result.steps);
  return result;
}

export interface StreamOptions extends RetryOptions {
  /** called with each parsed SSE frame as it arrives (for live UI streaming) */
  onEvent?: (frame: { event_type?: string; [k: string]: unknown }) => void;
}

/** POST a streaming interaction, surface frames live, fold into a result. */
async function streamInteraction(
  body: unknown,
  opts: StreamOptions,
): Promise<InteractionResult> {
  return withRetry(async () => {
    const res = await fetch(`${GEMINI_BASE}/interactions`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey(),
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      throw new Error(
        `Antigravity interactions → ${res.status}: ${await res.text()}`,
      );
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    let buf = "";
    const emit = (block: string) => {
      const dataLines = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice("data:".length).trim());
      if (!dataLines.length) return;
      const payload = dataLines.join("\n");
      if (!payload || payload === "[DONE]") return;
      try {
        opts.onEvent?.(JSON.parse(payload));
      } catch {
        /* keepalive / partial */
      }
    };
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      buf += chunk;
      let idx: number;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const sep = buf.slice(idx).match(/^\r?\n\r?\n/)![0];
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + sep.length);
        if (opts.onEvent) emit(block);
      }
    }
    if (opts.onEvent && buf.trim()) emit(buf);
    return parseInteractionStream(raw);
  }, opts);
}

/** Provision a fresh sandbox and run the first turn (streaming). */
export async function createInteraction(
  prompt: string,
  opts: StreamOptions = {},
): Promise<InteractionResult> {
  return streamInteraction(
    {
      agent: agentId(),
      input: [{ type: "text", text: prompt }],
      environment: { type: "remote" },
      stream: true,
    },
    opts,
  );
}

/** Continue an existing conversation in the same sandbox (multi-turn, streaming). */
export async function continueInteraction(
  previousInteractionId: string,
  environmentId: string,
  input: string,
  opts: StreamOptions = {},
): Promise<InteractionResult> {
  return streamInteraction(
    {
      agent: agentId(),
      previous_interaction_id: previousInteractionId,
      environment: environmentId,
      input: [{ type: "text", text: input }],
      stream: true,
    },
    opts,
  );
}

function stripDataUri(b64: string): string {
  const m = b64.match(/^data:[^;]+;base64,(.*)$/s);
  return m ? m[1] : b64;
}

const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 720 };

function normalizeViewport(v: unknown): Viewport {
  const vp = v as { width?: unknown; height?: unknown } | undefined;
  const width = Number(vp?.width);
  const height = Number(vp?.height);
  return {
    width:
      Number.isFinite(width) && width > 0
        ? Math.round(width)
        : DEFAULT_VIEWPORT.width,
    height:
      Number.isFinite(height) && height > 0
        ? Math.round(height)
        : DEFAULT_VIEWPORT.height,
  };
}

const AUDIT_STEP_RE = /<<<AUDIT_STEP>>>([\s\S]*?)<<<END>>>/g;
const VERDICT_RE = /<<<VERDICT>>>([\s\S]*?)<<<END>>>/;

/** Text sources that may carry our sentinels: code_execution stdout + the report. */
function sentinelTexts(result: InteractionResult): string[] {
  const texts: string[] = [];
  for (const s of result.steps)
    if (typeof s.result === "string") texts.push(s.result);
  if (result.outputText) texts.push(result.outputText);
  return texts;
}

/** Scan a single text blob for complete <<<AUDIT_STEP>>>…<<<END>>> sentinels. */
export function parseAuditStepsFromText(text: string): AuditStep[] {
  const out: AuditStep[] = [];
  AUDIT_STEP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AUDIT_STEP_RE.exec(text))) {
    let obj: {
      action?: unknown;
      intent?: unknown;
      viewport?: unknown;
      thumbnail?: unknown;
    };
    try {
      obj = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const thumbnail =
      typeof obj.thumbnail === "string" ? stripDataUri(obj.thumbnail) : "";
    out.push({
      screenshot: thumbnail,
      action: String(obj.action ?? "screenshot"),
      intent: String(obj.intent ?? ""),
      viewport: normalizeViewport(obj.viewport),
    });
  }
  return out;
}

/**
 * Pull the <<<AUDIT_STEP>>> thumbnail sentinels the audit prompt makes the agent
 * print, into the frozen AuditStep[] the UI streams. (The real API carries no
 * screenshots inline — see the module doc.)
 */
export function extractAuditSteps(result: InteractionResult): AuditStep[] {
  return sentinelTexts(result).flatMap(parseAuditStepsFromText);
}

/** Text payload of a live step.delta frame (code_execution stdout or content text). */
export function frameDeltaText(frame: {
  delta?: unknown;
  [k: string]: unknown;
}): string {
  const delta = frame.delta as
    { result?: unknown; content?: { text?: unknown } } | undefined;
  if (delta && typeof delta.result === "string") return delta.result;
  if (delta?.content && typeof delta.content.text === "string")
    return delta.content.text;
  return "";
}

export interface AuditReport {
  passed: boolean;
  passedCriteria: string[];
  failedCriteria: string[];
  category?: DefectCategory;
  severity?: Severity;
  domTrace: string;
  notes: string;
}

/**
 * Parse the auditor's verdict from the final report. Prefers the structured
 * <<<VERDICT>>> JSON block; falls back to a PASS/FAIL keyword scan.
 */
export function parseAuditReport(result: InteractionResult): AuditReport {
  const text = [
    result.outputText,
    ...result.steps.map((s) => (typeof s.result === "string" ? s.result : "")),
  ].join("\n");
  const m = text.match(VERDICT_RE);
  if (m) {
    try {
      const v = JSON.parse(m[1].trim()) as Record<string, unknown>;
      return {
        passed: Boolean(v.passed),
        passedCriteria: Array.isArray(v.passed_criteria)
          ? (v.passed_criteria as string[])
          : [],
        failedCriteria: Array.isArray(v.failed_criteria)
          ? (v.failed_criteria as string[])
          : [],
        category: v.category as DefectCategory | undefined,
        severity: v.severity as Severity | undefined,
        domTrace: typeof v.dom_trace === "string" ? v.dom_trace : "",
        notes: typeof v.notes === "string" ? v.notes : "",
      };
    } catch {
      /* fall through to keyword scan */
    }
  }
  const passed = /\bPASS\b/i.test(text) && !/\bFAIL\b/i.test(text);
  return {
    passed,
    passedCriteria: [],
    failedCriteria: [],
    domTrace: "",
    notes: text.slice(0, 4000),
  };
}

/**
 * Convert Antigravity token usage to microcents (millionths of a cent;
 * 1 µ¢ = 1e-8 $ — matches the UI's formatMicrocents, which divides by 1e6 to
 * reach cents). Pricing: Gemini 2.5 Pro standard tier — $1.25/M input,
 * $10/M output. Cached tokens are billed at $0.3125/M (25% of input price).
 * A real audit (~1.3M tokens, mostly cached input) lands near 87M µ¢ ≈ $0.87.
 */
export function computeCostMicrocents(usage: AntigravityUsage): number {
  const input =
    (usage.total_input_tokens ?? 0) - (usage.total_cached_tokens ?? 0);
  const cached = usage.total_cached_tokens ?? 0;
  const output = usage.total_output_tokens ?? 0;
  // $1.25/M = 125 microcents/token; $0.3125/M = 31.25 microcents; $10/M = 1000 microcents/token
  return Math.round(input * 125 + cached * 31.25 + output * 1000);
}

/**
 * Tear down a finished interaction (releasing its sandbox) to stop idle spend.
 * The sandbox has no standalone delete endpoint — it is owned by the interaction
 * lifecycle. Verified live: DELETE /v1beta/interactions/{id} → 200. (The old
 * `files/environment-<id>` scheme always 400s — that name exceeds the Files API
 * 40-char id cap.) Takes the INTERACTION id, not the environment id.
 */
export async function destroyInteraction(
  interactionId: string,
  opts: RetryOptions = {},
): Promise<void> {
  await withRetry(async () => {
    const res = await fetch(`${GEMINI_BASE}/interactions/${interactionId}`, {
      method: "DELETE",
      headers: { "x-goog-api-key": apiKey() },
    });
    if (!res.ok) {
      throw new Error(
        `Antigravity destroy ${interactionId} → ${res.status}: ${await res.text()}`,
      );
    }
  }, opts);
}
