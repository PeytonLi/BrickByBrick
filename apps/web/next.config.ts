import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { resolve } from "path";

// Next.js only loads .env.local from its own directory (apps/web/),
// but the monorepo keeps it at the repo root. Load it manually.
function loadRootEnv() {
  const rootEnvPath = resolve(__dirname, "..", "..", ".env.local");
  try {
    const content = readFileSync(rootEnvPath, "utf-8");
    for (const line of content.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim();
      }
    }
  } catch {}
}

loadRootEnv();

const config: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@brickbybrick/core",
    "@brickbybrick/inference",
    "@brickbybrick/trainer",
  ],
  // Native / dynamically-required packages webpack must NOT bundle:
  //  - @livekit/rtc-node ships platform-specific NAPI binaries.
  //  - @google/genai's Live API uses `ws`, whose native `bufferutil` frame
  //    masking breaks when bundled ("b.mask is not a function" at runtime).
  // Externalize so they load natively from node_modules at runtime.
  serverExternalPackages: ["@livekit/rtc-node", "@google/genai", "ws"],
};

export default config;
