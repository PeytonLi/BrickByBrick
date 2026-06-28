"use client";
import React, { useEffect, useRef } from "react";
import {
  BarChart3,
  Cpu,
  Zap,
  TrendingDown,
  Layers,
  ArrowUpRight,
} from "lucide-react";

const STEPS = [
  1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56, 61, 66, 71, 76, 81, 86, 91, 96,
  101, 106, 111, 116, 121, 126, 131, 136, 141, 146, 151, 156, 161, 166, 171,
  176, 181, 186, 191, 196, 201, 206, 211, 216, 221, 226, 231, 236, 241, 246,
  251, 256, 261, 266, 271, 276, 281, 286, 291, 296, 301, 306, 311, 316, 321,
  326, 331, 336, 341, 346, 351, 356, 361, 366, 371, 376, 381, 386, 391, 396,
  401, 406, 411, 416, 421, 426, 431, 436, 441, 446, 451, 456, 461, 466, 471,
  476, 481, 486, 491, 496, 501, 506, 511, 516, 521, 526, 531, 536, 541, 546,
  551, 556, 561, 566, 570,
];
const LOSSES = [
  6.1725, 6.4225, 6.5912, 6.6252, 6.4671, 6.7796, 5.9887, 6.6303, 6.1698,
  6.3662, 6.7062, 6.125, 5.9801, 5.9413, 6.2355, 5.8364, 6.2863, 6.8364, 6.5217,
  6.5505, 6.9697, 6.1182, 5.8961, 5.8213, 6.2114, 6.3434, 5.8633, 6.2714,
  6.3774, 6.4017, 6.0459, 5.9559, 6.5261, 6.4774, 5.8816, 5.6387, 6.3183,
  5.9053, 6.2121, 5.8592, 6.0504, 6.9747, 6.4938, 6.5659, 6.6653, 6.0798,
  6.4894, 6.6011, 6.2146, 6.0699, 5.9569, 5.9089, 5.9915, 6.7592, 6.9518,
  6.3425, 5.9264, 6.6398, 5.5129, 6.3576, 6.7648, 6.0442, 6.9811, 6.3693,
  5.5462, 6.5126, 6.1993, 6.0694, 6.3354, 5.6796, 6.0314, 6.241, 6.8086, 6.8063,
  6.3675, 5.9366, 5.9162, 6.1941, 6.2612, 6.0507, 6.0854, 6.2796, 5.8373,
  6.1487, 6.5479, 7.0132, 5.9593, 5.8743, 6.2596, 6.2214, 5.932, 6.5279, 6.232,
  6.2103, 6.5367, 6.9699, 6.7053, 5.9458, 5.9489, 6.3102, 6.3192, 6.4561,
  6.1028, 6.198, 5.6126, 6.1336, 6.2205, 6.1817, 6.5998, 6.0697, 6.6972, 6.8236,
  6.8331, 6.957, 5.6824,
];
const STATS = { il: 6.1725, fl: 5.6824, ml: 5.5129, rd: 7.9 };
const MECHS = [
  ["responsive-grid", 110],
  ["modal-focus-trap", 110],
  ["form-validation", 90],
  ["dropdown-menu", 80],
  ["toast-system", 100],
  ["carousel", 100],
  ["tabs", 100],
  ["accordion", 90],
  ["infinite-scroll", 90],
  ["drag-drop", 90],
  ["tooltip", 90],
  ["search-autocomplete", 90],
  ["data-table", 90],
  ["stepper-wizard", 90],
  ["pagination", 95],
  ["skeleton-loader", 100],
];

function LossChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 360 * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width,
      H = 360;
    const pad = { top: 20, right: 20, bottom: 40, left: 50 };
    const ph = H - pad.top - pad.bottom;
    const yMin = 4,
      yMax = 7;
    const sy = (v: number) => pad.top + ph * (1 - (v - yMin) / (yMax - yMin));
    const sx = (i: number) =>
      pad.left + (i / (STEPS.length - 1)) * (W - pad.left - pad.right);
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let y = yMin; y <= yMax; y++) {
      const py = sy(y);
      ctx.beginPath();
      ctx.moveTo(pad.left, py);
      ctx.lineTo(W - pad.right, py);
      ctx.stroke();
      ctx.fillStyle = "#52525b";
      ctx.font = "11px system-ui";
      ctx.textAlign = "right";
      ctx.fillText(String(y), pad.left - 8, py + 4);
    }
    ctx.fillStyle = "#52525b";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    for (let s = 0; s <= 570; s += 100) {
      const idx = STEPS.findIndex((v: number) => v >= s);
      if (idx >= 0) ctx.fillText(String(s), sx(idx), H - pad.bottom + 16);
    }
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    grad.addColorStop(0, "rgba(63,185,80,0.15)");
    grad.addColorStop(1, "rgba(63,185,80,0)");
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(LOSSES[0]));
    for (let i = 1; i < LOSSES.length; i++) {
      const x = sx(i),
        y = sy(LOSSES[i]),
        px = sx(i - 1),
        py = sy(LOSSES[i - 1]),
        cp = (x + px) / 2;
      ctx.bezierCurveTo(cp, py, cp, y, x, y);
    }
    ctx.strokeStyle = "#3fb950";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(sx(LOSSES.length - 1), H - pad.bottom);
    ctx.lineTo(sx(0), H - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }, []);
  return React.createElement("canvas", {
    ref: canvasRef,
    className: "h-full w-full rounded-lg",
    style: { height: 360 },
  });
}

export default function TrainingPage() {
  return React.createElement(
    "div",
    { className: "min-h-screen" },
    React.createElement(
      "div",
      {
        className:
          "border-b border-white/[0.06] bg-[#07080a]/80 px-8 py-6 backdrop-blur-sm",
      },
      React.createElement(
        "div",
        { className: "flex items-center gap-3" },
        React.createElement(
          "span",
          {
            className:
              "flex size-9 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10",
          },
          React.createElement(BarChart3, {
            className: "size-4 text-emerald-400",
          }),
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "h1",
            { className: "font-serif text-xl font-medium text-white" },
            "Training Results",
          ),
          React.createElement(
            "p",
            { className: "text-sm text-zinc-500" },
            "QLoRA fine-tuning \u2014 Gemma 4 26B-A4B-it",
          ),
        ),
      ),
    ),
    React.createElement(
      "div",
      { className: "mx-auto max-w-6xl px-8 py-8" },
      React.createElement(
        "div",
        { className: "mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4" },
        [
          {
            label: "Initial Loss",
            value: STATS.il.toFixed(4),
            icon: TrendingDown,
          },
          {
            label: "Final Loss",
            value: STATS.fl.toFixed(4),
            icon: Zap,
            accent: true,
          },
          { label: "Best Loss", value: STATS.ml.toFixed(4), icon: Cpu },
          {
            label: "Reduction",
            value: STATS.rd.toFixed(1) + "%",
            icon: ArrowUpRight,
            accent: true,
          },
        ].map((m: any) =>
          React.createElement(
            "div",
            {
              key: m.label,
              className:
                "rounded-xl border border-white/[0.06] bg-[#0a0b0e] p-4",
            },
            React.createElement(
              "div",
              { className: "mb-2 flex items-center gap-2" },
              React.createElement(m.icon, {
                className:
                  "size-3.5 " +
                  (m.accent ? "text-emerald-400" : "text-zinc-500"),
              }),
              React.createElement(
                "span",
                {
                  className:
                    "text-[11px] uppercase tracking-wider text-zinc-500",
                },
                m.label,
              ),
            ),
            React.createElement(
              "span",
              {
                className:
                  "font-mono text-2xl font-semibold tabular-nums tracking-tight " +
                  (m.accent ? "text-emerald-300" : "text-white"),
              },
              m.value,
            ),
          ),
        ),
      ),
      React.createElement(
        "div",
        { className: "grid gap-6 lg:grid-cols-[1fr_320px]" },
        React.createElement(
          "div",
          {
            className: "rounded-xl border border-white/[0.06] bg-[#0a0b0e] p-6",
          },
          React.createElement(
            "div",
            { className: "mb-4 flex items-center gap-2" },
            React.createElement(BarChart3, {
              className: "size-4 text-zinc-500",
            }),
            React.createElement(
              "h2",
              { className: "text-sm font-medium text-zinc-300" },
              "Training Loss \u00b7 570 Steps \u00b7 3 Epochs",
            ),
          ),
          React.createElement(LossChart),
        ),
        React.createElement(
          "div",
          { className: "space-y-4" },
          React.createElement(
            "div",
            {
              className:
                "rounded-xl border border-white/[0.06] bg-[#0a0b0e] p-5",
            },
            React.createElement(
              "h3",
              {
                className:
                  "mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500",
              },
              "Configuration",
            ),
            React.createElement(
              "dl",
              { className: "space-y-3" },
              [
                ["Dataset", "1,515 pairs"],
                ["Epochs", "3"],
                ["Total Steps", "570"],
                ["Batch Size", "2 \u00d7 4 GA (eff. 8)"],
                ["Learning Rate", "5e-5 cosine"],
                ["LoRA", "r=16, \u03b1=32"],
              ].map(([l, v]: string[]) =>
                React.createElement(
                  "div",
                  { key: l, className: "flex justify-between" },
                  React.createElement(
                    "dt",
                    { className: "text-xs text-zinc-500" },
                    l,
                  ),
                  React.createElement(
                    "dd",
                    {
                      className:
                        "text-xs font-medium text-zinc-300 tabular-nums",
                    },
                    v,
                  ),
                ),
              ),
            ),
          ),
          React.createElement(
            "div",
            {
              className:
                "rounded-xl border border-white/[0.06] bg-[#0a0b0e] p-5",
            },
            React.createElement(
              "h3",
              {
                className:
                  "mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500",
              },
              "Infrastructure",
            ),
            React.createElement(
              "dl",
              { className: "space-y-3" },
              [
                ["GPU", "H100 80GB (MassedCompute)"],
                ["Duration", "~25 min"],
                ["Cost", "$0.98"],
                ["Adapter", "peytonali/gemma-bbb-lora"],
              ].map(([l, v]: string[]) =>
                React.createElement(
                  "div",
                  { key: l, className: "flex justify-between" },
                  React.createElement(
                    "dt",
                    { className: "text-xs text-zinc-500" },
                    l,
                  ),
                  React.createElement(
                    "dd",
                    {
                      className:
                        "text-xs font-medium text-zinc-300 tabular-nums",
                    },
                    v,
                  ),
                ),
              ),
            ),
            React.createElement(
              "a",
              {
                href: "https://huggingface.co/peytonali/gemma-bbb-lora",
                target: "_blank",
                rel: "noopener noreferrer",
                className:
                  "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20",
              },
              "View on Hugging Face ",
              React.createElement(ArrowUpRight, { className: "size-3" }),
            ),
          ),
        ),
      ),
      React.createElement(
        "div",
        {
          className:
            "mt-8 rounded-xl border border-white/[0.06] bg-[#0a0b0e] p-6",
        },
        React.createElement(
          "div",
          { className: "mb-4 flex items-center gap-2" },
          React.createElement(Layers, { className: "size-4 text-zinc-500" }),
          React.createElement(
            "h2",
            { className: "text-sm font-medium text-zinc-300" },
            "Mechanisms in Training Set",
          ),
          React.createElement(
            "span",
            { className: "ml-auto font-mono text-xs text-zinc-500" },
            "1,515 total pairs",
          ),
        ),
        React.createElement(
          "div",
          { className: "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" },
          MECHS.map((item: any) => {
            const name: string = item[0];
            const count: number = item[1];
            return React.createElement(
              "div",
              {
                key: name,
                className:
                  "flex items-center justify-between rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2",
              },
              React.createElement(
                "span",
                { className: "truncate text-xs text-zinc-400" },
                name,
              ),
              React.createElement(
                "span",
                {
                  className:
                    "ml-2 shrink-0 font-mono text-xs tabular-nums text-zinc-600",
                },
                count,
              ),
            );
          }),
        ),
      ),
    ),
  );
}
