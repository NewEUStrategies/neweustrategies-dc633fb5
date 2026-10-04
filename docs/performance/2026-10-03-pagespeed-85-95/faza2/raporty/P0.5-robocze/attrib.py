#!/usr/bin/env python3
"""P0.5: łączy księgę (ledgers/<run>-<reżim>.json) z atrybucją profilera (art2/<run>.prof.json) po starcie zadania.
Dla zadań >= 50 ms sym. w którymkolwiek reżimie: blokowanie per reżim + najcięższe ramki źródłowe (inkluzywnie,
bez wnętrza react-dom/scheduler) i czas własny wg pliku. Użycie: attrib.py <form> <run> [--top 8]"""
import json, sys, re, os
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
form, run = sys.argv[1], sys.argv[2]
top = int(sys.argv[sys.argv.index('--top') + 1]) if '--top' in sys.argv else 8
REG = ['m4', 'm4c3'] if form == 'mobile' else ['d4', 'd4c3', 'd5', 'd5c3']
art = sys.argv[sys.argv.index('--art') + 1] if '--art' in sys.argv else f'{P}/art2'
prof = {round(t['obsStart']): t for t in json.load(open(f'{art}/{run}.prof.json'))}
per = {}
for reg in REG:
    f = f'{P}/ledgers/{run}-{reg}.json'
    if not os.path.exists(f):
        continue
    for t in json.load(open(f))['tasks']:
        r = per.setdefault(round(t['obsStart'], 1), {'t': t, 'b': {}, 'sim': {}})
        r['b'][reg] = t['avg']; r['sim'][reg] = max(t['optSimDur'], t['pesSimDur'])
NOISE = re.compile(r'node_modules/(react-dom|scheduler)/|\(program\)|\(idle\)|\(root\)|_lighthouse-eval')
for k in sorted(per):
    r = per[k]; t = r['t']
    if max(r['sim'].values()) < 50:
        continue
    p = prof.get(round(k)) or prof.get(round(k) - 1) or prof.get(round(k) + 1)
    print(f"\n== obs {k:.0f} / {t['obsDur']:.1f} ms {'L' if t['layout'] else ''} ({t['cls']}) " + ' '.join(f"{g}:{r['sim'].get(g,0):.0f}/{r['b'].get(g,0):.0f}" for g in REG))
    if not p:
        print('   (brak zadania w profilu)'); continue
    print('   dzieci:', ' '.join(p['children'][:6]))
    inc = [(lab, v) for lab, v in p['incl'] if not NOISE.search(lab)]
    print('   inkl.:', '; '.join(f'{lab} {v}' for lab, v in inc[:top]))
    print('   własny/plik:', '; '.join(f'{lab} {v}' for lab, v in p['byFile'][:top]))
