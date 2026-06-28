// packages/inference/src/intent.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { expandIntent } from "./intent";

const noSleep = async () => {};
function mockGenerate(jsonText: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: jsonText }] } }],
      }),
      text: async () => "",
    })),
  );
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("expandIntent", () => {
  it("maps intent to a partial GenerationConfig + sample titles", async () => {
    mockGenerate(
      JSON.stringify({
        domain_framing: "React responsive grids",
        framework: "react",
        challenger_weights: {
          "responsive-card-grid": 3,
          "modal-focus-trap": 2,
        },
        focus_mechanism: null,
        sample_titles: ["Pricing grid", "Photo wall"],
      }),
    );
    const r = await expandIntent("I want a model good at react", {
      sleep: noSleep,
    });
    expect(r.config.intent).toBe("I want a model good at react");
    expect(r.config.framework).toBe("react");
    expect(r.config.challenger_weights).toMatchObject({
      "responsive-card-grid": 3,
    });
    expect(r.sample_titles).toHaveLength(2);
  });
  it("rejects empty intent", async () => {
    await expect(expandIntent("   ")).rejects.toThrow(/empty/);
  });
  it("throws on non-JSON model output", async () => {
    mockGenerate("not json at all");
    await expect(expandIntent("x", { sleep: noSleep })).rejects.toThrow();
  });
});
