#!/usr/bin/env python3
"""P0.5 (domknięcie): deterministyczne what-if fal na 5 przebiegach ważnych W0 (w0q-<forma>-1..5).
Każda klasa zadania (classes.py) dostaje współczynnik skrócenia czasu obs (shrink w whatif.py, ±0,3 ms wokół startu
zadania; f=0,01 = zadanie usunięte; Layout zostaje w zadaniu - reguła 4), Lantern liczy TBT od nowa (audit.mjs).
Warianty: half = reguła x0,5 planu dla pozycji niezweryfikowanych na poziomie zadania, full = pełny szacunek.
Fale: W1 (P1.2 F1/F1b/F2/F3, P1.7 F5/F6) we wszystkich reżimach; W2 = W1 + C3 + P2.2/P2.4/P2.5/P2.6 (tylko reżimy c3);
W3 = W2 + P3.4 (reżimy c3); K8 = samo usunięcie zadań startu animacji (kontrola raportu roboczego).
Użycie: wave.py <form> <half|full> <W1|W2|W3|K8|K8a> [--runs 1,2,3,4,5]   -> JSON w wi-<wave>-<variant>-<form>.jsonl"""
import json, os, subprocess, sys, statistics as st
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classes import rows_for
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
W = os.path.dirname(os.path.abspath(__file__))
form, var, wave = sys.argv[1], sys.argv[2], sys.argv[3]
runs_sel = sys.argv[sys.argv.index('--runs') + 1].split(',') if '--runs' in sys.argv else ['1', '2', '3', '4', '5']
H = var == 'half'
# współczynniki: (half, full); 1.0 = bez zmian
W1F = {'K8a': (0.01, 0.01), 'K8b': (0.5, 0.01), 'K13': (0.01, 0.01), 'K13b': (1.0, 0.5),
       'K9': (0.67, 0.35), 'K11': (0.75, 0.5)}
W2F = {'K12': (0.75, 0.5), 'K14': (0.7, 0.4), 'K15': (0.7, 0.4), 'K16': (0.7, 0.4), 'K6': (0.8, 0.6),
       'K4': (0.6, 0.4), 'K5': (0.85, 0.69), 'K8c': (1.0, 0.01)}
W3F = {'K7': (0.67, 0.35)}
def factor(kid):
    f = 1.0
    tables = {'W1': [W1F], 'W2': [W1F, W2F], 'W3': [W1F, W2F, W3F], 'K8': [{'K8a': (0.01, 0.01), 'K8b': (0.01, 0.01), 'K8c': (0.01, 0.01)}],
              'K8a': [{'K8a': (0.01, 0.01)}]}[wave]
    for t in tables:
        if kid in t:
            f = t[kid][0 if H else 1]
    return f
REGS = {'mobile': [('m4', []), ('m4c3', ['dropscripts-before-lcp'])],
        'desktop': [('d4', ['cpu:4']), ('d4c3', ['cpu:4', 'dropscripts-before-lcp']), ('d5', ['cpu:5']), ('d5c3', ['cpu:5', 'dropscripts-before-lcp'])]}[form]
if wave in ('W2', 'W3'):
    REGS = [r for r in REGS if r[0].endswith('c3')]
rows = rows_for(form)
out = open(f'{W}/wi-{wave}-{var}-{form}.jsonl', 'a')
for i in runs_sel:
    run = f'w0q-{form}-{i}'
    parts = [(r['obs'], factor(r['kid']), r['kid']) for r in rows if r['run'] == run and factor(r['kid']) < 1.0]
    shr = [f'shrink:{o - 0.3}:{o + 0.3}:{f}' for o, f, _ in parts]
    for tag, edits in REGS:
        base = json.load(open(f'{P}/ledgers/{run}-{tag}.json'))['tbtExact']
        if not shr:
            after = base
        else:
            env = dict(os.environ, WI_SRC=f'{P}/art2/{run}')
            r = subprocess.run(['python3', f'{P}/whatif.py', form, f'fx-{wave}-{var}-{run}-{tag}', *edits, *shr], capture_output=True, text=True, env=env)
            line = [l for l in r.stdout.splitlines() if l.startswith('{')]
            if not line:
                print('BŁĄD', run, tag, r.stdout[-500:], r.stderr[-800:], file=sys.stderr); continue
            after = json.loads(line[-1])['TBT']
        rec = {'run': run, 'reg': tag, 'wave': wave, 'var': var, 'base': round(base), 'after': round(after), 'delta': round(after) - round(base),
               'shrunk': [(round(o), f, k) for o, f, k in parts]}
        out.write(json.dumps(rec) + '\n'); out.flush()
        print(json.dumps(rec))
