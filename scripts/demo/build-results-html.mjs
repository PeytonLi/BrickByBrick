import { readFileSync, writeFileSync } from "fs";

const rawMetrics = readFileSync(
  new URL("loss-metrics.jsonl", import.meta.url),
  "utf-8"
).trim().split("\n");

const steps = [], losses = [];
for (const line of rawMetrics) {
  try {
    const m = JSON.parse(line.replace(/^.*?\{/, "{"));
    steps.push(m.step);
    losses.push(Number(m.loss.toFixed(4)));
  } catch {}
}

// Downsample to ~100 points
const target = 100;
const skip = Math.max(1, Math.floor(steps.length / target));
const sampledSteps = [], sampledLosses = [];
for (let i = 0; i < steps.length; i += skip) {
  sampledSteps.push(steps[i]);
  sampledLosses.push(losses[i]);
}
sampledSteps.push(steps[steps.length - 1]);
sampledLosses.push(losses[losses.length - 1]);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BrickByBrick — Training Results</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#e6edf3;padding:2rem}
h1{font-size:1.5rem;margin-bottom:.5rem}
.subtitle{color:#8b949e;margin-bottom:2rem}
.grid{display:grid;grid-template-columns:2fr 1fr;gap:1.5rem;max-width:1200px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1.5rem}
.card h2{font-size:1rem;color:#8b949e;margin-bottom:1rem;text-transform:uppercase;letter-spacing:.05em}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
.stat{background:#0d1117;border-radius:6px;padding:.75rem}
.stat-label{font-size:.75rem;color:#8b949e}
.stat-value{font-size:1.25rem;font-weight:600;margin-top:.25rem}
.green{color:#3fb950}.blue{color:#58a6ff}.purple{color:#bc8cff}
canvas{width:100%!important;height:360px!important}
.hub-link{display:inline-block;margin-top:.5rem;color:#58a6ff;text-decoration:none;font-size:.875rem}
.hub-link:hover{text-decoration:underline}
</style>
</head>
<body>
<h1>BrickByBrick — QLoRA Fine-Tuning Results</h1>
<p class="subtitle">Gemma 4 26B (4-bit) · LoRA r=16 · H100 · 1,515 pairs · 3 epochs</p>
<div class="grid">
<div class="card">
<h2>Loss Curve</h2>
<canvas id="lossChart"></canvas>
</div>
<div class="card">
<h2>Training Summary</h2>
<div class="stat-grid">
<div class="stat"><div class="stat-label">Base Model</div><div class="stat-value" style="font-size:.85rem">Gemma 4 26B-A4B-it</div></div>
<div class="stat"><div class="stat-label">Dataset Size</div><div class="stat-value blue">1,515 pairs</div></div>
<div class="stat"><div class="stat-label">Epochs</div><div class="stat-value">3</div></div>
<div class="stat"><div class="stat-label">Total Steps</div><div class="stat-value">570</div></div>
<div class="stat"><div class="stat-label">Initial Loss</div><div class="stat-value" id="initLoss">—</div></div>
<div class="stat"><div class="stat-label">Final Loss</div><div class="stat-value green" id="finalLoss">—</div></div>
<div class="stat"><div class="stat-label">Loss Reduction</div><div class="stat-value purple" id="lossReduction">—</div></div>
<div class="stat"><div class="stat-label">Adapter</div><div class="stat-value blue" style="font-size:.75rem">peytonali/gemma-bbb-lora</div></div>
</div>
<a class="hub-link" href="https://huggingface.co/peytonali/gemma-bbb-lora" target="_blank">View on Hugging Face &rarr;</a>
</div>
</div>
<div style="max-width:1200px;margin-top:1.5rem" class="card">
<h2>Configuration</h2>
<div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">
<div class="stat"><div class="stat-label">LoRA Rank</div><div class="stat-value">16</div></div>
<div class="stat"><div class="stat-label">LoRA Alpha</div><div class="stat-value">32</div></div>
<div class="stat"><div class="stat-label">Batch Size</div><div class="stat-value">2 &times; 4 GA</div></div>
<div class="stat"><div class="stat-label">Effective Batch</div><div class="stat-value">8</div></div>
<div class="stat"><div class="stat-label">Learning Rate</div><div class="stat-value">5e-5</div></div>
<div class="stat"><div class="stat-label">LR Schedule</div><div class="stat-value">Cosine</div></div>
<div class="stat"><div class="stat-label">Warmup</div><div class="stat-value">3%</div></div>
<div class="stat"><div class="stat-label">Max Seq Length</div><div class="stat-value">2048</div></div>
</div>
</div>
<script>
var STEPS = [${sampledSteps.join(",")}];
var LOSSES = [${sampledLosses.join(",")}];
document.getElementById("initLoss").textContent = LOSSES[0].toFixed(4);
document.getElementById("finalLoss").textContent = LOSSES[LOSSES.length-1].toFixed(4);
document.getElementById("lossReduction").textContent = ((LOSSES[0]-LOSSES[LOSSES.length-1])/LOSSES[0]*100).toFixed(1)+"%";
new Chart(document.getElementById("lossChart"),{
  type:"line",
  data:{labels:STEPS,datasets:[{label:"Training Loss",data:LOSSES,borderColor:"#58a6ff",backgroundColor:"rgba(88,166,255,0.08)",fill:true,tension:0.3,pointRadius:0,borderWidth:2}]},
  options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{title:{display:true,text:"Step",color:"#8b949e"},grid:{color:"#21262d"},ticks:{color:"#8b949e",maxTicksLimit:12}},y:{title:{display:true,text:"Loss",color:"#8b949e"},grid:{color:"#21262d"},ticks:{color:"#8b949e"},min:4,max:7}},interaction:{intersect:false,mode:"index"}}
});
<\/script>
</body>
</html>`;

const outPath = new URL("../../apps/web/public/training-results.html", import.meta.url);
writeFileSync(outPath, html);
console.log("Written " + sampledSteps.length + " data points to training-results.html");
console.log("Loss range:", Math.min(...losses).toFixed(2), "-", Math.max(...losses).toFixed(2));
