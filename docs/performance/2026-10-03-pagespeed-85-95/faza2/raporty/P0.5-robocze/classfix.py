#!/usr/bin/env python3
"""P0.5: what-if poprawki per KLASA zadania na wielu przebiegach: dla każdego przebiegu znajduje zadania klasy
(z dump summarize.py) i skraca je współczynnikiem f (fixwi.py); drukuje TBT przed/po per reżim i medianę delty.
Użycie: classfix.py <form> <dump.json> <art_dir> "<klasa1>=f1;<klasa2>=f2" <run1> [run2...]"""
import json, subprocess, sys, statistics, collections
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
form, dump, art, spec, runs = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:]
fac = dict(x.split('=') for x in spec.split(';'))
rows = json.load(open(dump))
res = collections.defaultdict(list)
for run in runs:
    parts = [f"{r['obs']}:{fac[r['cls']]}" for r in rows if r['run'] == run and r['cls'] in fac]
    if not parts:
        print(f'# {run}: brak zadań klas'); continue
    out = subprocess.run(['python3', f'{P}/fixwi.py', f'{art}/{run}', form, f'cf-{run}', ','.join(parts)], capture_output=True, text=True).stdout
    for line in out.splitlines():
        d = json.loads(line); res[d['reg']].append(d)
        print(f"{run} {d['reg']}: {d['TBT_base']} -> {d['TBT_fix']} ({d['delta']:+})")
for reg, L in res.items():
    print(f"MEDIANA {reg}: przed {statistics.median([d['TBT_base'] for d in L])} po {statistics.median([d['TBT_fix'] for d in L])} delta {statistics.median([d['delta'] for d in L])} (n={len(L)})")
