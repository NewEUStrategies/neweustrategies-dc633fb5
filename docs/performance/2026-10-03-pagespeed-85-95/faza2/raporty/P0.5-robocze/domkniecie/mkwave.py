#!/usr/bin/env python3
"""P0.5 (domknięcie): tabele §4 (what-if fal na fixture, n = 5) i projekcji PSI z wi-*.jsonl i project.json."""
import json, glob, os, statistics as st, collections
W = os.path.dirname(os.path.abspath(__file__))
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
pl = lambda x: f'{x:.0f}'.replace('-', '−')
recs = collections.defaultdict(dict)
for f in glob.glob(f'{W}/wi-*.jsonl'):
    for l in open(f):
        d = json.loads(l); recs[(d['wave'], d['var'], d['reg'])][d['run']] = d
def base(reg):
    form = 'mobile' if reg.startswith('m') else 'desktop'
    v = [round(json.load(open(f'{P}/ledgers/w0q-{form}-{i}-{reg}.json'))['tbtExact']) for i in range(1, 6)]
    return v
def cell(wave, var, reg):
    R = recs.get((wave, var, reg))
    if not R or len(R) < 5:
        return '…'
    runs = sorted(R)
    after = [R[r]['after'] for r in runs]; delta = [R[r]['delta'] for r in runs]
    return f"**{pl(st.median(after))}** (Δ {pl(st.median(delta))}; {pl(min(delta))}…{pl(max(delta))})"
rows = []
hdr = '| punkt | mobile x4 (m4) | mobile x4 z C3 (m4c3) | desktop x4 (d4) | desktop x4 z C3 (d4c3) | desktop x5 (d5) | desktop x5 z C3 (d5c3) |'
rows.append(hdr); rows.append('|---|---|---|---|---|---|---|')
regs = ['m4', 'm4c3', 'd4', 'd4c3', 'd5', 'd5c3']
rows.append('| W0 (dziś) | ' + ' | '.join(f"**{pl(st.median(base(r)))}** ({', '.join(map(str, base(r)))})" for r in regs) + ' |')
rows.append('| tylko usunięcie K8 (mobile: K8a; desktop: K8a — samo F1) | ' + ' | '.join(cell('K8' if r.startswith('m') else 'K8a', 'half', r) for r in regs) + ' |')
for wave, label in (('W1', 'W1 (P1.2 F1/F1b/F2/F3 + P1.7 F5/F6)'), ('W2', 'W2 = W1 + C3 + P2.2/P2.4/P2.5/P2.6 + P2.3 (K8c)'), ('W3', 'W3 = W2 + P3.4 (K7)')):
    for var, vl in (('half', 'reguła ×0,5'), ('full', 'pełne')):
        cells = []
        for r in regs:
            if wave in ('W2', 'W3') and not r.endswith('c3'):
                cells.append('—')
            else:
                cells.append(cell(wave, var, r))
        rows.append(f'| {label}, {vl} | ' + ' | '.join(cells) + ' |')
open(f'{W}/gen/waves.md', 'w').write('\n'.join(rows) + '\n')
print('\n'.join(rows))
