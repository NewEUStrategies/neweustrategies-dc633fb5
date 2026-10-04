#!/usr/bin/env python3
"""P0.5 (domknięcie): w którym zadaniu głównego wątku (RunTask) przychodzi powiadomienie o starcie (stan running) każdej
animacji CSS - per przebieg ważny. Grupy: oi-fade-in (OptimizedImage), lv-shimmer (szkielety sekcji strumieniowanych),
ticker (tt-*), enter (tw-animate-css: baner zgód). Łączy z klasą zadania z dump summarize.py.
Użycie: animtasks.py <form> [runs...]"""
import json, sys, collections
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
form = sys.argv[1]
runs = sys.argv[2:] or [f'w0q-{form}-{i}' for i in range(1, 6)]
dump = json.load(open(f'{P}/dump-w0q-{form}.json'))
grp = lambda n: 'ticker' if n.startswith('tt-') else n
for run in runs:
    art = 'art' if run.startswith(('w0-', 'w0prof', 'w0inv', 'w0deep')) else 'art2'
    tr = json.load(open(f'{P}/{art}/{run}/trace.json')); ev = tr['traceEvents'] if isinstance(tr, dict) else tr
    nav = next(e for e in ev if e.get('name') == 'navigationStart' and e.get('args', {}).get('data', {}).get('isLoadingMainFrame'))
    t0, pid, tid = nav['ts'], nav['pid'], nav['tid']
    tasks = sorted([e for e in ev if e.get('pid') == pid and e.get('tid') == tid and e.get('name') == 'RunTask' and e.get('ph') == 'X'], key=lambda e: e['ts'])
    an = [e for e in ev if e.get('name') == 'Animation']
    names = {}
    for e in an:
        d = e.get('args', {}).get('data', {})
        if d.get('displayName'):
            names[(e.get('id2') or {}).get('local') or e.get('id')] = d['displayName']
    hits = collections.defaultdict(collections.Counter)
    durs = {}
    for e in an:
        d = e.get('args', {}).get('data', {})
        if e['ph'] != 'n' or d.get('state') != 'running':
            continue
        nm = grp(names.get((e.get('id2') or {}).get('local') or e.get('id'), '?'))
        cand = [t for t in tasks if t['ts'] <= e['ts'] <= t['ts'] + t['dur']]
        task = max(cand, key=lambda t: t['dur']) if cand else None
        key = round((task['ts'] - t0) / 1000, 1) if task else None
        hits[key][nm] += 1
        durs[key] = task['dur'] / 1000 if task else 0
    rows = {round(r['obs']): r for r in dump if r['run'] == run} if run.startswith('w0q') else {}
    for key in sorted(k for k in hits if k is not None):
        r = rows.get(round(key))
        cls = (r['cls'][:40] + ' ' + json.dumps(r['b'])) if r else '(poniżej progu księgi)'
        print(f"{run} zadanie {key:.0f}/{durs[key]:.1f} ms: {dict(hits[key])}  -> {cls}")
