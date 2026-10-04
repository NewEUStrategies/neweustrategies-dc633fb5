#!/usr/bin/env python3
"""P0.5 (domknięcie): generuje tabele raportu (gen/*.md) z ksiąg przebiegów ważnych i what-if fal."""
import json, os, sys, statistics as st, collections, glob, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ranked import ranked
from meta import META
W = os.path.dirname(os.path.abspath(__file__))
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
pl = lambda x, d=0: (f'{x:.{d}f}').replace('.', ',').replace('-', '−')
f0 = lambda x: '–' if x is None else pl(x)
MULT = {'m4': 4, 'm4c3': 4, 'd4': 4, 'd4c3': 4, 'd5': 5, 'd5c3': 5}

def ledger_table(form, reg, merge=True):
    res = ranked(form, reg, merge)
    rows = [r for r in res['rows'] if r['avgMean'] > 0 or (r['simDur'] or 0) >= 50]
    out = ['| # | klasa | n | L | start obs [ms] | czas obs [ms] (min–maks) | start sym. opt / pes [ms] | czas sym. [ms] | blok. opt / pes / śr. [ms] (śr. min–maks) | udział w TBT | plik:linia (główne) | właściciel | po poprawce: czas sym. [ms] (pełne / reguła ×0,5; podstawa) |',
           '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for i, r in enumerate(rows, 1):
        m = META.get(r['kid'], META['K-'])
        L = 'L' if r['nL'] * 2 >= r['n'] else ('L w ' + str(r['nL']) + '/' + str(r['n']) if r['nL'] else '')
        sd = r['simDur']
        if r['kid'] == 'K8':
            exp = 'zob. K8a/K8b/K8c (§2.5)'
        elif sd is None:
            exp = '–'
        elif m[3] >= 1.0 and (m[4] or 1.0) >= 1.0:
            exp = f'{f0(sd)} (bez zmian; {m[5]})'
        else:
            exp = f'≈{f0(sd * m[3])} / ≈{f0(sd * (m[4] if m[4] is not None else 1.0))} (×{pl(m[3], 2)} / ×{pl(m[4] or 1.0, 2)}; {m[5]})'
        out.append(f"| {i} | **{r['kid']}** {m[0]} | {r['n']}/5 | {L} | {f0(r['obsStart'])} | {pl(r['obsDur'], 1)} ({pl(r['obsDurMin'])}–{pl(r['obsDurMax'])}) | "
                   f"{f0(r['simStartOpt'])} / {f0(r['simStartPes'])} | {f0(sd)} | {f0(r['opt'])} / {f0(r['pes'])} / **{f0(r['avg'])}** ({f0(r['avgMin'])}–{f0(r['avgMax'])}) | {pl(r['share'])} % | {m[1]} | {m[2]} | {exp} |")
    w = res['window']
    head = (f"TBT (audyt Lantern = suma księgi) w przebiegach 1–5: {', '.join(str(x) for x in res['tbt'])} → **mediana {pl(res['tbtMedian'])} ms (n = 5)**; "
            f"okno (mediany, n = 5): FCP_sim {pl(w['fcpOpt'])} ms, TTI_sim opt / pes {pl(w['ttiOpt'])} / {pl(w['ttiPes'])} ms; mnożnik CPU ×{MULT[reg]} (zadania z Layout ×{pl(MULT[reg] / 2, 1)}).")
    return head + '\n\n' + '\n'.join(out) + '\n'

def k8_table():
    out = ['| przebieg | zadanie (start / czas obs [ms]) | grupy animacji startujące w zadaniu | klasa po korekcie | blokowanie [ms] |', '|---|---|---|---|---|']
    for form in ('mobile', 'desktop'):
        an = json.load(open(f'{W}/anim-{form}.json'))
        dump = {(r['run'], round(r['obs'])): r for r in json.load(open(f'{P}/dump-w0q-{form}.json'))}
        from classes import rows_for
        kid = {(r['run'], round(r['obs'])): r['kid'] for r in rows_for(form)}
        for run in sorted(an):
            for t, g in sorted(an[run].items(), key=lambda kv: int(kv[0])):
                r = dump.get((run, int(t)))
                if not r:
                    continue
                k = kid.get((run, int(t)), '?')
                b = ', '.join(f'{g2} {pl(v)}' for g2, v in r['b'].items())
                gg = ', '.join(f'{n} ×{c}' for n, c in g.items())
                out.append(f"| `{run}` | {pl(r['obs'])} / {pl(r['dur'], 1)} | {gg} | {k} | {b} |")
    return '\n'.join(out) + '\n'

def wave_table():
    recs = collections.defaultdict(list)
    for f in glob.glob(f'{W}/wi-*.jsonl'):
        for l in open(f):
            d = json.loads(l); recs[(d['wave'], d['var'], d['reg'])].append(d)
    return recs

if __name__ == '__main__':
    for form, regs in (('mobile', ['m4', 'm4c3']), ('desktop', ['d4', 'd4c3', 'd5', 'd5c3'])):
        for reg in regs:
            open(f'{W}/gen/ledger-{reg}.md', 'w').write(ledger_table(form, reg))
    open(f'{W}/gen/k8.md', 'w').write(k8_table())
    print('ok')
