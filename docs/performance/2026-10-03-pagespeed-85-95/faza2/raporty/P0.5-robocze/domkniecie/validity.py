#!/usr/bin/env python3
"""P0.5 (domknięcie): filtr ważności przebiegów. Czyta wszystkie *-summary.txt z art/ i art2/ (gather.mjs zapisuje
load = loadavg 1 min tuż przed przebiegiem) i drukuje tabelę: przebieg, load, kod, TBT, werdykt (ważny: load <= 3 i kod 0).
Użycie: validity.py [--md]"""
import glob, os, re, sys
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
rows = []
for f in sorted(glob.glob(f'{P}/art/*-summary.txt') + glob.glob(f'{P}/art2/*-summary.txt')):
    for line in open(f):
        m = re.match(r'(\S+) code=(\S+) .*?load=([\d.]+)(.*)', line)
        if not m:
            continue
        name, code, load, rest = m.group(1), m.group(2), float(m.group(3)), m.group(4)
        tbt = re.search(r'TBT=(\d+)', rest)
        fcp = re.search(r'FCP=(\d+)', rest)
        ok = code == '0' and load <= 3.0
        why = 'ważny' if ok else ('błąd przebiegu' if code != '0' else 'load > 3')
        rows.append((os.path.basename(os.path.dirname(f)), name, load, code, tbt.group(1) if tbt else '-', fcp.group(1) if fcp else '-', why))
for r in rows:
    print('\t'.join(str(x) for x in r))
