// Seed dataset generator for BrickByBrick trainer
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const CATS=["layout_collision","overflow","truncation","offscreen_render","frozen_state","script_error","other"];
const SEVS=["low","medium","high","critical"];
let sid=42;
const R=()=>{sid=(sid*1664525+1013904223)|0;return(sid>>>0)/4294967296};
const pick=a=>a[Math.floor(R()*a.length)];
const c=(id,desc,w)=>({id,description:desc,weight:w});

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(__dirname, "_mech_data.json");
const raw = readFileSync(dataPath, "utf-8");
const mechData = JSON.parse(raw);

const VOCABS = mechData.vocabs;
const sub=(t,v)=>{let o=t;for(const[k,val]of Object.entries(v))o=o.split(k).join(val);return o};

const pairs = [];
let count = 0;
for (const mech of mechData.mechs) {
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
        prompt: prompt,
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
