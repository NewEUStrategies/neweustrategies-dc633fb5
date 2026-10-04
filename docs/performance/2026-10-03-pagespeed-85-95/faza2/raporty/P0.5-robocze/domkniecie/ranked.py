#!/usr/bin/env python3
"""P0.5 (domknięcie): księga rankingowa per klasa zadania (klasy po korekcie z classes.py) z ksiąg Lantern
(ledgers/<run>-<reżim>.json), tylko przebiegi ważne w0q-<forma>-1..5. Per klasa: n przebiegów z klasą, mediany startu
i czasu obs, startu sym. (graf opt/pes), czasu sym., blokowania opt/pes/śr (suma zadań klasy w przebiegu, 0 gdy brak;
mediana z n = 5) i udziału w TBT przebiegu (mediana z 5). Moduł: ranked(form, reg) -> dict; CLI drukuje tabelę."""
import json, os, statistics as st, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classes import rows_for
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
med = lambda v: st.median(v) if v else None

def ranked(form, reg, merge_k8=False):
    runs = [f'w0q-{form}-{i}' for i in range(1, 6)]
    rows = rows_for(form)
    if merge_k8:
        rows = [{**r, 'kid': 'K8'} if r['kid'].startswith('K8') else r for r in rows]
    agg = collections.defaultdict(dict)
    tbt, win = {}, {}
    for run in runs:
        d = json.load(open(f'{P}/ledgers/{run}-{reg}.json'))
        tbt[run] = d['tbtExact']
        win[run] = (d['fcp']['opt'], d['fcp']['pes'], d['tti']['opt'], d['tti']['pes'])
        led = {round(t['obsStart'], 1): t for t in d['tasks']}
        for r in (x for x in rows if x['run'] == run):
            t = led.get(round(r['obs'], 1))
            e = agg[r['kid']].setdefault(run, {'opt': 0, 'pes': 0, 'avg': 0, 'tasks': []})
            if t:
                e['opt'] += t['opt']; e['pes'] += t['pes']; e['avg'] += t['avg']
            e['tasks'].append({'obs': r['obs'], 'dur': r['dur'], 'L': r['L'],
                               'so': t['optSimStart'] if t else None, 'sp': t['pesSimStart'] if t else None,
                               'sd': max(t['optSimDur'], t['pesSimDur']) if t else None, 'avg': t['avg'] if t else 0})
    out = []
    for kid, a in agg.items():
        per = [a.get(run, {'opt': 0, 'pes': 0, 'avg': 0, 'tasks': []}) for run in runs]
        present = [p for p in per if p['tasks']]
        rep = [max(p['tasks'], key=lambda t: (t['avg'], t['dur'])) for p in present]
        sims = [t for t in rep if t['so'] is not None]
        out.append({'kid': kid, 'n': len(present), 'nL': sum(1 for t in rep if t['L']),
                    'obsStart': med([t['obs'] for t in rep]), 'obsDur': med([t['dur'] for t in rep]),
                    'obsDurMin': min(t['dur'] for t in rep), 'obsDurMax': max(t['dur'] for t in rep),
                    'simStartOpt': med([t['so'] for t in sims]), 'simStartPes': med([t['sp'] for t in sims]),
                    'simDur': med([t['sd'] for t in sims]), 'nSim': len(sims),
                    'opt': med([p['opt'] for p in per]), 'pes': med([p['pes'] for p in per]), 'avg': med([p['avg'] for p in per]),
                    'avgMin': min(p['avg'] for p in per), 'avgMax': max(p['avg'] for p in per),
                    'avgMean': st.mean([p['avg'] for p in per]),
                    'share': med([100 * p['avg'] / tbt[run] if tbt[run] else 0 for p, run in zip(per, runs)]),
                    'perRun': [round(p['avg']) for p in per], 'nTasks': sum(len(p['tasks']) for p in present)})
    out.sort(key=lambda r: (-r['avg'], -r['avgMean'], -(r['simDur'] or 0)))
    W = {k: med([w[i] for w in win.values()]) for i, k in enumerate(['fcpOpt', 'fcpPes', 'ttiOpt', 'ttiPes'])}
    return {'form': form, 'reg': reg, 'runs': runs, 'tbt': [round(tbt[r]) for r in runs], 'tbtMedian': med([tbt[r] for r in runs]), 'window': W, 'rows': out}

if __name__ == '__main__':
    res = ranked(sys.argv[1], sys.argv[2], '--merge' in sys.argv)
    W = res['window']
    print(f"# {res['form']} {res['reg']}: TBT {res['tbt']} mediana {res['tbtMedian']:.0f}; FCPsim {W['fcpOpt']:.0f}/{W['fcpPes']:.0f} TTIsim {W['ttiOpt']:.0f}/{W['ttiPes']:.0f}")
    f = lambda x: '-' if x is None else f'{x:.0f}'
    for i, r in enumerate(res['rows'], 1):
        print(f"{i:2d} {r['kid']:5s} n={r['n']} nL={r['nL']} obs {f(r['obsStart'])}/{r['obsDur']:.1f} [{r['obsDurMin']:.0f}-{r['obsDurMax']:.0f}] sym {f(r['simStartOpt'])}/{f(r['simStartPes'])} dur {f(r['simDur'])} blok {f(r['opt'])}/{f(r['pes'])}/{f(r['avg'])} [{r['avgMin']:.0f}-{r['avgMax']:.0f}] udz {r['share']:.0f}% {r['perRun']}")
