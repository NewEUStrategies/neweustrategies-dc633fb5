#!/usr/bin/env python3
"""P0.5 (domknięcie): przełożenie księgi fixture W0 -> PSI trzema mapowaniami z PLAN §1.5 (logika jak
phase1/ledger/project.py), ale z bazą W0 = mediany 5 przebiegów ważnych i falami z wave.py (mediany TBT po, n = 5).
 M-b' (k = 1): PSI = fixture + reszta zadań tylko-PSI
 M-b  (centralne): PSI = k_b * (fixture + reszta), k_b = PSI_W0 / (fixture_W0 + reszta_W0)
 M-a  (optymistyczne): PSI = PSI_W0 - (reszta_W0 - reszta) - k_a * (fixture_W0 - fixture), k_a = (PSI_W0 - reszta_W0) / fixture_W0
Reszta tylko-PSI (gtag, przepisanie arkusza marki, chunki zgód) i metryki F/L/SI po falach - bez zmian z PLAN §1.5."""
import json, glob, os, sys, statistics as st, collections
sys.path.insert(0, '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase1/lighthouse-analyst')
from score import perf_score
W = os.path.dirname(os.path.abspath(__file__))
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
def sc(form, F, L, T, S): return perf_score(form, {'FCP': F, 'LCP': L, 'TBT': T, 'SI': S, 'CLS': 0})[0] * 100
REG = {'mobile': ('m4', 'm4c3'), 'desktop4': ('d4', 'd4c3'), 'desktop5': ('d5', 'd5c3')}
FORM = {'mobile': 'mobile', 'desktop4': 'desktop', 'desktop5': 'desktop'}
recs = collections.defaultdict(list)
for f in glob.glob(f'{W}/wi-*.jsonl'):
    for l in open(f):
        d = json.loads(l); recs[(d['wave'], d['var'], d['reg'])].append(d)
def med_after(wave, var, reg):
    L = recs.get((wave, var, reg), [])
    runs = {d['run']: d['after'] for d in L}
    return (st.median(runs.values()), len(runs)) if runs else (None, 0)
def base(reg, form):
    v = [json.load(open(f'{P}/ledgers/w0q-{form}-{i}-{reg}.json'))['tbtExact'] for i in range(1, 6)]
    return st.median(v)
FX = {}
for key, (rb, rc) in REG.items():
    form = FORM[key]
    FX[key] = {'W0': (base(rb, form),) * 2, 'C3': (base(rc, form),) * 2}
    for wave, reg in (('W1', rb), ('W1c3', rc), ('W2', rc), ('W3', rc)):
        wv = 'W1' if wave == 'W1c3' else wave
        FX[key][wave] = tuple(med_after(wv, var, reg)[0] for var in ('half', 'full'))
PSI_BASE = {'mobile': 600, 'desktop4': 740, 'desktop5': 740}
R_BASE = {'mobile': 215 + 115 + 60, 'desktop4': 200 + 72 + 60, 'desktop5': 200 + 72 + 60}
R_AFTER = {'mobile': (18, 0), 'desktop4': (40, 20), 'desktop5': (40, 20)}
MET = {'mobile': {'W0': (3100, 6600, 4900), 'W1': (3100, 6600, 4200), 'C3': (1800, 2850, 3700), 'W1c3': (1800, 2850, 3700), 'W2': (1800, 2850, 3700), 'W3': (1800, 2700, 3700)},
       'desktop': {'W0': (600, 1100, 1500), 'W1': (600, 1100, 1450), 'C3': (450, 850, 1300), 'W1c3': (450, 850, 1300), 'W2': (450, 850, 1300), 'W3': (450, 810, 1300)}}
out = {}
for key in REG:
    form = FORM[key]
    fb = FX[key]['W0'][0]; rb = R_BASE[key]; pb = PSI_BASE[key]
    kb = pb / (fb + rb); ka = (pb - rb) / fb
    out[key] = {'k_b': kb, 'k_a': ka, 'k_harness_noflags': pb / fb, 'rows': {}}
    print(f"== {key}: fixture W0 = {fb:.0f} ms (n = 5), k_b = {kb:.2f}, k_a = {ka:.2f}, k(harness, bez flag) = PSI/fixture = {pb/fb:.2f}")
    for wave in ('W0', 'C3', 'W1', 'W1c3', 'W2', 'W3'):
        row = {}
        for i, var in enumerate(('half', 'full')):
            fa = FX[key][wave][i]
            if fa is None:
                continue
            ra = rb if wave in ('W0', 'C3') else R_AFTER[key][i]
            mbp = fa + ra; mb = kb * (fa + ra); ma = pb - (rb - ra) - ka * (fb - fa)
            F, L, S = MET[form][wave]
            row[var] = {'fx': fa, 'Mbp': mbp, 'Mb': mb, 'Ma': ma, 'score': (sc(form, F, L, mbp, S), sc(form, F, L, mb, S), sc(form, F, L, ma, S))}
            print(f"  {wave:5s} {var}: fixture {fa:4.0f}  PSI M-b'={mbp:4.0f} M-b={mb:4.0f} M-a={ma:4.0f}  wynik {row[var]['score'][0]:5.1f}/{row[var]['score'][1]:5.1f}/{row[var]['score'][2]:5.1f}  (F/L/SI {F}/{L}/{S})")
        out[key]['rows'][wave] = row
json.dump(out, open(f'{W}/project.json', 'w'), indent=1)

# --- tabela Markdown (gen/project.md)
pl = lambda x, d=0: f'{x:.{d}f}'.replace('.', ',')
LBL = {'W0': 'W0 (dziś)', 'C3': 'sam C3 (P2.1 bez spłaty)', 'W1': 'W1', 'W1c3': 'W1 + C3', 'W2': 'W2', 'W3': 'W3 (+ P3.4)'}
lines = ['| punkt | forma | fixture [ms] (×0,5 / pełne) | TBT PSI M-b′ / **M-b** / M-a [ms] (×0,5) | TBT PSI M-b′ / **M-b** / M-a [ms] (pełne) | wynik PSI M-b′ / **M-b** / M-a (×0,5) | wynik PSI M-b′ / **M-b** / M-a (pełne) |',
         '|---|---|---|---|---|---|---|']
names = {'mobile': 'mobile', 'desktop4': 'desktop (host ~x4)', 'desktop5': 'desktop (host ~x5)'}
for wave in ('W0', 'C3', 'W1', 'W1c3', 'W2', 'W3'):
    for key in REG:
        row = out[key]['rows'].get(wave, {})
        if not row:
            continue
        h, f = row.get('half'), row.get('full')
        fx = f"{pl(h['fx'])} / {pl(f['fx'])}" if h and f else (pl((h or f)['fx']) if (h or f) else '…')
        t = lambda r: f"{pl(r['Mbp'])} / **{pl(r['Mb'])}** / {pl(r['Ma'])}" if r else '…'
        s = lambda r: f"{pl(r['score'][0])} / **{pl(r['score'][1])}** / {pl(r['score'][2])}" if r else '…'
        lines.append(f"| {LBL[wave]} | {names[key]} | {fx} | {t(h)} | {t(f)} | {s(h)} | {s(f)} |")
open(f'{W}/gen/project.md', 'w').write('\n'.join(lines) + '\n')
