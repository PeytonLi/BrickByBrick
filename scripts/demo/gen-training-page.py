import json, os

raw = open('scripts/demo/loss-metrics.jsonl').read().strip().split('\n')
all_steps, all_losses = [], []
for line in raw:
    try:
        m = json.loads(line[line.index('{'):])
        all_steps.append(m['step'])
        all_losses.append(round(m['loss'], 4))
    except: pass

skip = max(1, len(all_steps) // 100)
steps = [all_steps[i] for i in range(0, len(all_steps), skip)]
losses = [all_losses[i] for i in range(0, len(all_steps), skip)]
steps.append(all_steps[-1])
losses.append(all_losses[-1])

stats = {'il': losses[0], 'fl': losses[-1], 'ml': min(losses), 'rd': round((losses[0]-losses[-1])/losses[0]*100, 1)}
mechs = [['responsive-grid',110],['modal-focus-trap',110],['form-validation',90],['dropdown-menu',80],['toast-system',100],['carousel',100],['tabs',100],['accordion',90],['infinite-scroll',90],['drag-drop',90],['tooltip',90],['search-autocomplete',90],['data-table',90],['stepper-wizard',90],['pagination',95],['skeleton-loader',100]]

template = open('scripts/demo/training-page-template.txt').read()

out = []
out.append('"use client";')
out.append("import React, { useEffect, useRef } from 'react';")
out.append("import { BarChart3, Cpu, Zap, TrendingDown, Layers, ArrowUpRight } from 'lucide-react';")
out.append('')
out.append('const STEPS = ' + json.dumps(steps) + ';')
out.append('const LOSSES = ' + json.dumps(losses) + ';')
out.append('const STATS = ' + json.dumps(stats) + ';')
out.append('const MECHS = ' + json.dumps(mechs) + ';')
out.append('')
out.append(template)

os.makedirs('apps/web/app/training', exist_ok=True)
with open('apps/web/app/training/page.tsx', 'w') as f:
    f.write('\n'.join(out))
print(f'Written training page with {len(steps)} data points')
