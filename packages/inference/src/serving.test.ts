// packages/inference/src/serving.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { inferOnModel } from "./serving";

afterEach(() => vi.unstubAllGlobals());

describe("inferOnModel", () => {
  it("POSTs chat/completions and returns the message content", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "<div/>" } }] }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await inferOnModel("http://pod:8000/v1", "tuned", "Build X", {
      sleep: async () => {},
    });
    expect(out).toBe("<div/>");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("http://pod:8000/v1/chat/completions");
    expect(JSON.parse((init! as RequestInit).body as string).model).toBe(
      "tuned",
    );
  });
});
