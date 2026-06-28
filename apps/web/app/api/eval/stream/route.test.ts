import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "./route";

async function collect(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  return out;
}

describe("POST /api/eval/stream", () => {
  beforeEach(() => {
    process.env.BBB_DEMO_MODE = "1";
  });
  afterEach(() => {
    delete process.env.BBB_DEMO_MODE;
  });

  it("400s without runId", async () => {
    const res = await POST(
      new Request("http://t", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(400);
  });
  it("streams eval_started → eval_complete in demo mode", async () => {
    const res = await POST(
      new Request("http://t", {
        method: "POST",
        body: JSON.stringify({ runId: "demo", k: 2 }),
      }),
    );
    const text = await collect(res);
    expect(text).toMatch(/eval_started/);
    expect(text).toMatch(/eval_complete/);
  });
});
