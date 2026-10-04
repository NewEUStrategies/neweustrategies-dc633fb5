#!/usr/bin/env python3
"""P0.5: tabela przebiegu reprezentatywnego: start/czas obs, flaga L, klasa, per reżim sym. czas (opt/pes) i blokowanie (opt/pes/śr.),
plus kolumny z mapy klas: przyczyna plik:linia, właściciel, oczekiwany czas sym. po poprawce (współczynnik x czas sym.).
Użycie: reptable.py <form> <dump.json> <run>"""
import json, sys
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
form, dump, run = sys.argv[1:4]
REG = ['m4', 'm4c3'] if form == 'mobile' else ['d4', 'd4c3', 'd5', 'd5c3']
MAP = json.load(open(f'{P}/classmap.json'))
rows = [r for r in json.load(open(dump)) if r['run'] == run]
led = {}
for g in REG:
    for t in json.load(open(f'{P}/ledgers/{run}-{g}.json'))['tasks']:
        led.setdefault(round(t['obsStart'], 1), {})[g] = t
hdr = '| obs start / czas [ms] | L | klasa | ' + ' | '.join(f'{g}: sym · blok opt/pes/śr' for g in REG) + ' | właściciel | oczek. sym. po poprawce |'
print(hdr); print('|' + '---|' * (hdr.count('|') - 1))
tot = {g: 0 for g in REG}
for r in sorted(rows, key=lambda r: r['obs']):
    L = led.get(r['obs'], {})
    if max([r['sim'].get(g, 0) for g in REG]) < 50 and max(r['b'].values() or [0]) == 0:
        continue
    cells = []
    for g in REG:
        t = L.get(g)
        if not t:
            cells.append('-'); continue
        tot[g] += t['avg']
        sd = t['optSimDur'] if t['optSimDur'] == t['pesSimDur'] else f"{t['optSimDur']}/{t['pesSimDur']}"
        cells.append(f"{sd} · {t['opt']}/{t['pes']}/{t['avg']:.0f}")
    m = MAP.get(r['cls'], {})
    simmax = max(r['sim'].values())
    exp = m.get('f')
    exps = f"~{simmax * exp:.0f} ms ({m.get('fdesc', '')})" if exp is not None else m.get('fdesc', '—')
    print(f"| {r['obs']:.0f} / {r['dur']:.1f} | {'L' if r['L'] else ''} | {m.get('id','K-')} {r['cls'].split(' (')[0]} | " + ' | '.join(cells) + f" | {m.get('owner', 'nieprzypisane')} | {exps} |")
print('| **suma = audyt** | | | ' + ' | '.join(f'**{tot[g]:.0f}**' for g in REG) + ' | | |')
