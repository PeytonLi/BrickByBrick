// Seed dataset generator for BrickByBrick trainer
import { writeFileSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const CATS = [
  "layout_collision",
  "overflow",
  "truncation",
  "offscreen_render",
  "frozen_state",
  "script_error",
  "other",
];
const SEVS = ["low", "medium", "high", "critical"];
let sid = 42;
const R = () => {
  sid = (sid * 1664525 + 1013904223) | 0;
  return (sid >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(R() * a.length)];
const c = (id, desc, w) => ({ id, description: desc, weight: w });

const VOCABS = [
  {
    "@N@": "Comp",
    "@items@": "items",
    "@item@": "item",
    "@i@": "i",
    "@data@": "data",
    "@list@": "list",
    "@idx@": "idx",
    "@val@": "val",
    "@ref@": "ref",
    "@fn@": "fn",
  },
  {
    "@N@": "Widget",
    "@items@": "entries",
    "@item@": "entry",
    "@i@": "id",
    "@data@": "rows",
    "@list@": "lst",
    "@idx@": "n",
    "@val@": "v",
    "@ref@": "r",
    "@fn@": "cb",
  },
  {
    "@N@": "Module",
    "@items@": "cards",
    "@item@": "card",
    "@i@": "k",
    "@data@": "posts",
    "@list@": "dl",
    "@idx@": "j",
    "@val@": "x",
    "@ref@": "rf",
    "@fn@": "act",
  },
  {
    "@N@": "Block",
    "@items@": "blocks",
    "@item@": "blk",
    "@i@": "b",
    "@data@": "cols",
    "@list@": "bl",
    "@idx@": "m",
    "@val@": "y",
    "@ref@": "el",
    "@fn@": "h",
  },
  {
    "@N@": "Section",
    "@items@": "rows",
    "@item@": "row",
    "@i@": "r",
    "@data@": "tbl",
    "@list@": "rl",
    "@idx@": "p",
    "@val@": "z",
    "@ref@": "rr",
    "@fn@": "on",
  },
  {
    "@N@": "Panel",
    "@items@": "cells",
    "@item@": "cell",
    "@i@": "c",
    "@data@": "grid",
    "@list@": "cl",
    "@idx@": "q",
    "@val@": "t",
    "@ref@": "cr",
    "@fn@": "go",
  },
  {
    "@N@": "View",
    "@items@": "records",
    "@item@": "rec",
    "@i@": "x",
    "@data@": "set",
    "@list@": "rl2",
    "@idx@": "s",
    "@val@": "u",
    "@ref@": "vr",
    "@fn@": "do",
  },
  {
    "@N@": "Element",
    "@items@": "nodes",
    "@item@": "node",
    "@i@": "nd",
    "@data@": "tree",
    "@list@": "nl",
    "@idx@": "t2",
    "@val@": "w",
    "@ref@": "nr",
    "@fn@": "run",
  },
  {
    "@N@": "Unit",
    "@items@": "members",
    "@item@": "mem",
    "@i@": "p2",
    "@data@": "grp",
    "@list@": "ml",
    "@idx@": "v2",
    "@val@": "g",
    "@ref@": "ur",
    "@fn@": "exec",
  },
  {
    "@N@": "Card",
    "@items@": "tiles",
    "@item@": "tile",
    "@i@": "t3",
    "@data@": "arr",
    "@list@": "tl",
    "@idx@": "z2",
    "@val@": "e",
    "@ref@": "tr",
    "@fn@": "fire",
  },
];

const sub = (t, v) => {
  let o = t;
  for (const [k, val] of Object.entries(v)) o = o.split(k).join(val);
  return o;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(__dirname)
  .filter((f) => f.startsWith("_mech_") && f.endsWith(".json"))
  .sort();
const mechs = [];
for (const f of files) {
  const data = JSON.parse(readFileSync(join(__dirname, f), "utf-8"));
  mechs.push(...data);
}

const pairs = [];
let count = 0;
for (const mech of mechs) {
  const [name, prompt, criteria, bugs, n] = mech;
  const critObjs = criteria.map(([id, desc, w]) => c(id, desc, w));
  for (let i = 0; i < n; i++) {
    count++;
    const bi = i % bugs.length;
    const vi = Math.floor(i / bugs.length) % VOCABS.length;
    const bug = bugs[bi];
    const vocab = VOCABS[vi];
    const w_code = sub(bug[0], vocab);
    const trace = bug[1];
    const s_code = sub(bug[2], vocab);
    const cat = bug[3] || pick(CATS);
    const sev = bug[4] || pick(SEVS);
    pairs.push({
      id: "seed-" + String(count).padStart(4, "0"),
      task: {
        id: "task-" + name + "-" + String(i + 1).padStart(3, "0"),
        prompt,
        target_mechanism: name,
        criteria: critObjs,
      },
      weak_code: w_code,
      defect: {
        screenshot: "base64-placeholder-seed",
        dom_trace: trace,
        category: cat,
        severity: sev,
      },
      strong_code: s_code,
      u_score: Math.round((0.4 + R() * 0.5) * 100) / 100,
    });
  }
}

const outPath = resolve(__dirname, "..", "__fixtures__", "demo-dataset.jsonl");
writeFileSync(outPath, pairs.map((p) => JSON.stringify(p)).join("\n") + "\n");
console.log("Wrote " + pairs.length + " training pairs to demo-dataset.jsonl");
