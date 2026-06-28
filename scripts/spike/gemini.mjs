// Spike (b)+(c): confirm Gemini 3.1 Pro (strong solver) and Gemma 4 (weak solver)
// both respond on the single GEMINI_API_KEY.  Run: node scripts/spike/gemini.mjs
import { loadEnv } from "./_env.mjs";

const env = loadEnv();
const key = env.GEMINI_API_KEY;
if (!key) {
  console.error("✗ GEMINI_API_KEY missing in .env.local");
  process.exit(1);
}

const STRONG = env.STRONG_MODEL || "gemini-3.1-pro-preview";
const WEAK = env.WEAK_MODEL || "gemma-4-26b-a4b-it";

async function gen(model) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: "Reply with the single word OK." }] },
        ],
      }),
    },
  );
  return { ok: res.ok, status: res.status, body: await res.text() };
}

let allOk = true;
for (const [label, model] of [
  ["strong solver", STRONG],
  ["weak solver  ", WEAK],
]) {
  const { ok, status, body } = await gen(model);
  console.log(`${ok ? "✓" : "✗"} ${label} (${model}) → ${status}`);
  if (!ok) {
    allOk = false;
    console.log("   " + body.slice(0, 300));
  }
}
if (!allOk) {
  console.log(
    "\n  If the weak model 404s, Gemma 4 may not be served on the Gemini key.\n" +
      "  Fallback per docs/DECISIONS.md: set WEAK_MODEL=gemini-3.5-flash and re-run.",
  );
  process.exit(1);
}
