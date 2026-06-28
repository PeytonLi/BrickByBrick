import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuditStepSchema } from "@brickbybrick/core";
import {
  createInteraction,
  continueInteraction,
  parseInteractionStream,
  extractAuditSteps,
  parseAuditStepsFromText,
  frameDeltaText,
  parseAuditReport,
  destroyInteraction,
  computeCostMicrocents,
  type InteractionResult,
  type AntigravityUsage,
} from "./antigravity";

const noSleep = () => Promise.resolve();

// The REAL captured Antigravity stream + consolidated interaction (scripts/spike).
const RAW_STREAM = readFileSync(
  new URL("../__fixtures__/interaction.stream.txt", import.meta.url),
  "utf8",
);

/** Build a mock fetch whose Response streams `text` as the body (one chunk). */
function streamFetch(text: string, status = 200) {
  return vi.fn(async (..._args: unknown[]) => {
    const enc = new TextEncoder();
    let sent = false;
    return {
      ok: status >= 200 && status < 300,
      status,
      body: {
        getReader() {
          return {
            read: async () =>
              sent
                ? { done: true, value: undefined }
                : ((sent = true), { done: false, value: enc.encode(text) }),
            releaseLock() {},
          };
        },
      },
      text: async () => text,
    };
  });
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.ANTIGRAVITY_AGENT = "antigravity-preview-05-2026";
});
afterEach(() => vi.unstubAllGlobals());

describe("parseInteractionStream — the real event-typed SSE protocol", () => {
  it("folds the captured stream into a consolidated interaction", () => {
    const res = parseInteractionStream(RAW_STREAM);
    expect(res.id).toBe(
      "v1_ChdWRFZBYXZHMEZycXYtOFlQZ1AzUGlRRRIXVkRWQWF2RzBGcnF2LThZUGdQM1BpUUU",
    );
    expect(res.environmentId).toBe("8c31eeec-635f-4f2e-9bcd-bf657bca3de0");
    expect(res.status).toBe("completed");
    expect(res.steps.length).toBe(80);
  });

  it("captures the agent's final model_output report as outputText", () => {
    const res = parseInteractionStream(RAW_STREAM);
    // The final model_output for the spike prompt described the verdict.
    expect(res.outputText.toLowerCase()).toContain("layout looks correct");
    expect(res.outputText.length).toBeGreaterThan(100);
  });

  it("returns a failed status when the stream reports interaction.failed", () => {
    const raw = [
      "event: interaction.created",
      'data: {"interaction":{"id":"v1_x","status":"in_progress"},"event_type":"interaction.created"}',
      "",
      "event: interaction.failed",
      'data: {"interaction":{"id":"v1_x","status":"failed","environment_id":"env_1","steps":[]},"event_type":"interaction.failed"}',
    ].join("\n");
    const res = parseInteractionStream(raw);
    expect(res.status).toBe("failed");
    expect(res.id).toBe("v1_x");
  });
});

describe("extractAuditSteps — our sentinel protocol embedded in the agent output", () => {
  it("parses <<<AUDIT_STEP>>> blocks printed in code_execution_result output", () => {
    const result: InteractionResult = {
      id: "i",
      environmentId: "e",
      status: "completed",
      outputText: "",
      steps: [
        { type: "code_execution_call", arguments: { code: "python shot.py" } },
        {
          type: "code_execution_result",
          result:
            "Navigating to http://localhost:3000\n" +
            '<<<AUDIT_STEP>>>{"action":"resize","intent":"check mobile layout","viewport":{"width":375,"height":667},"thumbnail":"BASE64THUMB375"}<<<END>>>\n' +
            "done",
        },
      ],
    };
    const steps = extractAuditSteps(result);
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe("resize");
    expect(steps[0].intent).toBe("check mobile layout");
    expect(steps[0].viewport).toEqual({ width: 375, height: 667 });
    expect(steps[0].screenshot).toBe("BASE64THUMB375");
    expect(() => AuditStepSchema.parse(steps[0])).not.toThrow();
  });

  it("collects multiple audit steps across several result steps in order", () => {
    const mk = (vp: number, thumb: string) =>
      `<<<AUDIT_STEP>>>{"action":"resize","intent":"viewport ${vp}","viewport":{"width":${vp},"height":800},"thumbnail":"${thumb}"}<<<END>>>`;
    const result: InteractionResult = {
      id: "i",
      environmentId: "e",
      status: "completed",
      outputText: "",
      steps: [
        { type: "code_execution_result", result: mk(1280, "A") },
        { type: "code_execution_result", result: mk(768, "B") },
        { type: "code_execution_result", result: mk(375, "C") },
      ],
    };
    const steps = extractAuditSteps(result);
    expect(steps.map((s) => s.viewport.width)).toEqual([1280, 768, 375]);
    expect(steps.map((s) => s.screenshot)).toEqual(["A", "B", "C"]);
  });

  it("strips a data-uri prefix from the thumbnail", () => {
    const result: InteractionResult = {
      id: "i",
      environmentId: "e",
      status: "completed",
      outputText:
        '<<<AUDIT_STEP>>>{"action":"click","intent":"open modal","viewport":{"width":375,"height":667},"thumbnail":"data:image/jpeg;base64,ZZZ"}<<<END>>>',
      steps: [],
    };
    const steps = extractAuditSteps(result);
    expect(steps[0].screenshot).toBe("ZZZ");
  });

  it("returns [] for a real interaction that emitted no sentinels", () => {
    // The captured spike used a generic prompt (no sentinel contract) — proves
    // the real `steps` carry NO inline screenshots without our prompt protocol.
    const res = parseInteractionStream(RAW_STREAM);
    expect(extractAuditSteps(res)).toEqual([]);
  });
});

describe("frameDeltaText — pulling text out of a live step.delta frame", () => {
  it("returns the stdout of a code_execution_result delta", () => {
    const frame = {
      event_type: "step.delta",
      delta: {
        type: "code_execution_result",
        result: "Screenshot saved\n<<<AUDIT_STEP>>>{}<<<END>>>",
      },
    };
    expect(frameDeltaText(frame)).toContain("<<<AUDIT_STEP>>>");
  });
  it("returns the text of a model_output / thought content delta", () => {
    const frame = {
      event_type: "step.delta",
      delta: { type: "text", content: { text: "hello", type: "text" } },
    };
    expect(frameDeltaText(frame)).toBe("hello");
  });
  it("returns empty string for a frame with no text payload", () => {
    expect(
      frameDeltaText({ event_type: "step.start", step: { type: "thought" } }),
    ).toBe("");
  });
});

describe("parseAuditStepsFromText — single-text sentinel scan (for live streaming)", () => {
  it("extracts every complete sentinel in one text blob", () => {
    const text =
      '<<<AUDIT_STEP>>>{"action":"resize","intent":"a","viewport":{"width":375,"height":667},"thumbnail":"X"}<<<END>>>' +
      " noise " +
      '<<<AUDIT_STEP>>>{"action":"click","intent":"b","viewport":{"width":1280,"height":800},"thumbnail":"Y"}<<<END>>>';
    const steps = parseAuditStepsFromText(text);
    expect(steps.map((s) => s.screenshot)).toEqual(["X", "Y"]);
  });
  it("ignores an unterminated sentinel (still being streamed)", () => {
    const text =
      '<<<AUDIT_STEP>>>{"action":"resize","intent":"a","viewport":{"width":375,"height":667},"thumbnail":"X"';
    expect(parseAuditStepsFromText(text)).toEqual([]);
  });

  it("extracts frames from a realistic multi-step sentinel sample (Finding E)", () => {
    // Simulate what an agent stdout looks like during a live audit: mixed
    // sentinels, noise text, and a partial (streaming) sentinel at the tail.
    const text = [
      "Starting Playwright audit on http://localhost:3000",
      '<<<AUDIT_STEP>>>{"action":"resize","intent":"check desktop layout","viewport":{"width":1280,"height":720},"thumbnail":"dGVzdDE="}<<<END>>>',
      "Desktop layout looks correct — moving to tablet",
      '<<<AUDIT_STEP>>>{"action":"resize","intent":"check tablet layout","viewport":{"width":768,"height":1024},"thumbnail":"dGVzdDI="}<<<END>>>',
      "No overflow at 768px — checking mobile",
      '<<<AUDIT_STEP>>>{"action":"resize","intent":"check mobile","viewport":{"width":375,"height":812},"thumbnail":"dGVzdDM="}<<<END>>>',
      "Mobile layout passes — injecting long text",
      '<<<AUDIT_STEP>>>{"action":"type","intent":"inject 500-char string","viewport":{"width":375,"height":812},"thumbnail":"dGVzdDQ="}<<<END>>>',
      "Text is truncated at card boundary — DEFECT",
      '<<<AUDIT_STEP>>>{"action":"click","intent":"open modal on mobile","viewport":{"width":375,"height":812},"thumbnail":"dGVzdDU="}<<<END>>>',
      "Modal content overflows viewport — DEFECT",
      // Partial sentinel being streamed (should be ignored)
      '<<<AUDIT_STEP>>>{"action":"scroll","intent":"check long list","viewport":{"width":375,',
    ].join("\n");

    const steps = parseAuditStepsFromText(text);
    expect(steps).toHaveLength(5);
    expect(steps.map((s) => s.action)).toEqual([
      "resize",
      "resize",
      "resize",
      "type",
      "click",
    ]);
    expect(steps.map((s) => s.screenshot)).toEqual([
      "dGVzdDE=",
      "dGVzdDI=",
      "dGVzdDM=",
      "dGVzdDQ=",
      "dGVzdDU=",
    ]);
    expect(steps.map((s) => s.viewport.width)).toEqual([
      1280, 768, 375, 375, 375,
    ]);
    // Every step must conform to the core schema
    for (const step of steps) {
      expect(() => AuditStepSchema.parse(step)).not.toThrow();
    }
  });
});

describe("parseAuditReport — the <<<VERDICT>>> block", () => {
  it("parses a FAIL verdict with category, severity and criteria", () => {
    const result: InteractionResult = {
      id: "i",
      environmentId: "e",
      status: "completed",
      outputText:
        "Here is my report.\n" +
        '<<<VERDICT>>>{"passed":false,"passed_criteria":["a"],"failed_criteria":["b"],"category":"overflow","severity":"high","dom_trace":"<div overflow>","notes":"content spills at 375px"}<<<END>>>',
      steps: [],
    };
    const report = parseAuditReport(result);
    expect(report.passed).toBe(false);
    expect(report.passedCriteria).toEqual(["a"]);
    expect(report.failedCriteria).toEqual(["b"]);
    expect(report.category).toBe("overflow");
    expect(report.severity).toBe("high");
    expect(report.domTrace).toContain("overflow");
  });

  it("parses a PASS verdict", () => {
    const result: InteractionResult = {
      id: "i",
      environmentId: "e",
      status: "completed",
      outputText:
        '<<<VERDICT>>>{"passed":true,"passed_criteria":["a","b"],"failed_criteria":[]}<<<END>>>',
      steps: [],
    };
    const report = parseAuditReport(result);
    expect(report.passed).toBe(true);
    expect(report.passedCriteria).toEqual(["a", "b"]);
    expect(report.failedCriteria).toEqual([]);
  });

  it("falls back to a PASS/FAIL keyword scan when no sentinel is present", () => {
    const pass: InteractionResult = {
      id: "i",
      environmentId: "e",
      status: "completed",
      outputText: "Everything works. Verdict: PASS.",
      steps: [],
    };
    const fail: InteractionResult = {
      id: "i",
      environmentId: "e",
      status: "completed",
      outputText: "There is an overflow defect. Verdict: FAIL.",
      steps: [],
    };
    expect(parseAuditReport(pass).passed).toBe(true);
    expect(parseAuditReport(fail).passed).toBe(false);
  });
});

describe("createInteraction — streams stream:true and folds the result", () => {
  it("posts the agent + prompt, requests streaming, and maps the result", async () => {
    const frames = [
      "event: interaction.created",
      'data: {"interaction":{"id":"v1_a","status":"in_progress"},"event_type":"interaction.created"}',
      "",
      "event: interaction.completed",
      'data: {"interaction":{"id":"v1_a","status":"completed","environment_id":"env_9","steps":[{"type":"model_output","content":[{"text":"done","type":"text"}]}]},"event_type":"interaction.completed"}',
      "",
    ].join("\n");
    const fetchMock = streamFetch(frames);
    vi.stubGlobal("fetch", fetchMock);

    const events: string[] = [];
    const res = await createInteraction("build a card", {
      sleep: noSleep,
      onEvent: (e) => events.push(String(e.event_type)),
    });

    expect(res.id).toBe("v1_a");
    expect(res.environmentId).toBe("env_9");
    expect(res.status).toBe("completed");
    expect(res.outputText).toContain("done");
    expect(events).toEqual(["interaction.created", "interaction.completed"]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1beta/interactions");
    const body = JSON.parse((init as any).body);
    expect(body.agent).toBe("antigravity-preview-05-2026");
    expect(body.input[0].text).toBe("build a card");
    expect(body.environment).toEqual({ type: "remote" });
    expect(body.stream).toBe(true);
    expect((init as any).headers["x-goog-api-key"]).toBe("test-key");
  });
});

describe("continueInteraction — multi-turn same sandbox", () => {
  it("passes previous_interaction_id and the environment id", async () => {
    const frames = [
      "event: interaction.completed",
      'data: {"interaction":{"id":"v1_b","status":"completed","environment_id":"env_9","steps":[]},"event_type":"interaction.completed"}',
      "",
    ].join("\n");
    const fetchMock = streamFetch(frames);
    vi.stubGlobal("fetch", fetchMock);

    await continueInteraction("v1_a", "env_9", "re-audit the fix", {
      sleep: noSleep,
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.previous_interaction_id).toBe("v1_a");
    expect(body.environment).toBe("env_9");
    expect(body.input[0].text).toBe("re-audit the fix");
    expect(body.stream).toBe(true);
  });
});

describe("parseInteractionStream — usage block (Finding G)", () => {
  it("extracts the usage object from the terminal interaction.completed frame", () => {
    const raw = [
      "event: interaction.created",
      'data: {"interaction":{"id":"v1_u","status":"in_progress"},"event_type":"interaction.created"}',
      "",
      "event: interaction.completed",
      'data: {"interaction":{"id":"v1_u","status":"completed","environment_id":"env_c","steps":[],"usage":{"total_tokens":50000,"total_input_tokens":48000,"total_output_tokens":2000}},"event_type":"interaction.completed"}',
    ].join("\n");
    const res = parseInteractionStream(raw);
    expect(res.usage).toBeDefined();
    expect(res.usage!.total_tokens).toBe(50000);
    expect(res.usage!.total_input_tokens).toBe(48000);
    expect(res.usage!.total_output_tokens).toBe(2000);
  });

  it("leaves usage undefined when no frame carries it", () => {
    const raw = [
      "event: interaction.created",
      'data: {"interaction":{"id":"v1_n","status":"in_progress"},"event_type":"interaction.created"}',
      "",
      "event: interaction.completed",
      'data: {"interaction":{"id":"v1_n","status":"completed","environment_id":"env_n","steps":[]},"event_type":"interaction.completed"}',
    ].join("\n");
    const res = parseInteractionStream(raw);
    expect(res.usage).toBeUndefined();
  });
});

describe("computeCostMicrocents — Gemini 2.5 Pro pricing (Finding G)", () => {
  it("returns 0 for empty usage", () => {
    expect(computeCostMicrocents({})).toBe(0);
  });

  it("charges output tokens at $10/M (1000 µ¢/tok)", () => {
    const usage: AntigravityUsage = {
      total_output_tokens: 1000,
      total_input_tokens: 0,
      total_cached_tokens: 0,
    };
    expect(computeCostMicrocents(usage)).toBe(1_000_000);
  });

  it("charges input tokens at $1.25/M (125 µ¢/tok)", () => {
    const usage: AntigravityUsage = {
      total_input_tokens: 1000,
      total_output_tokens: 0,
      total_cached_tokens: 0,
    };
    expect(computeCostMicrocents(usage)).toBe(125_000);
  });

  it("charges cached input at $0.3125/M (31.25 µ¢/tok)", () => {
    const usage: AntigravityUsage = {
      total_input_tokens: 2000,
      total_cached_tokens: 1000,
      total_output_tokens: 0,
    };
    expect(computeCostMicrocents(usage)).toBe(156_250);
  });

  it("matches the real fixture order-of-magnitude", () => {
    const usage: AntigravityUsage = {
      total_tokens: 1_333_223,
      total_input_tokens: 1_324_427,
      total_cached_tokens: 1_110_016,
      total_output_tokens: 6_308,
    };
    const cost = computeCostMicrocents(usage);
    expect(cost).toBeGreaterThan(50_000_000);
    expect(cost).toBeLessThan(100_000_000);
  });
});

describe("destroyInteraction — teardown", () => {
  it("issues a DELETE for the interaction (verified live: /v1beta/interactions/{id})", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({
      ok: true,
      status: 200,
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await destroyInteraction("8c31eeec", { sleep: noSleep });
    const [url, init] = fetchMock.mock.calls[0];
    expect((init as any).method).toBe("DELETE");
    expect(url).toContain("/interactions/8c31eeec");
    expect(url).not.toContain("environment-");
  });
});
