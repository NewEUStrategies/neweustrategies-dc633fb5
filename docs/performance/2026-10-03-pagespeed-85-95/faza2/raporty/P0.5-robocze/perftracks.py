#!/usr/bin/env python3
"""P0.5: React Performance Tracks (build profilujący, console.timeStamp -> zdarzenia TimeStamp) per długie zadanie.
Dla zadań RunTask >= min ms: komponenty z najdłuższym czasem własnym (render/efekty), fazy Schedulera.
start/end w TimeStamp = ms od timeOrigin (performance.now); timeOrigin ~ navigationStart.
Użycie: perftracks.py <dir artefaktu> [min=12] [top=12]"""
import json, sys, collections
d = sys.argv[1]; mn = float(sys.argv[2]) if len(sys.argv) > 2 else 12; top = int(sys.argv[3]) if len(sys.argv) > 3 else 12
tr = json.load(open(d + '/trace.json')); ev = tr['traceEvents'] if isinstance(tr, dict) else tr
nav = next(e for e in ev if e.get('name') == 'navigationStart' and e.get('args', {}).get('data', {}).get('isLoadingMainFrame'))
t0, pid, tid = nav['ts'], nav['pid'], nav['tid']
ts_ev = [e for e in ev if e.get('name') == 'TimeStamp' and isinstance(e.get('args', {}).get('data'), dict)]
spans = []
for e in ts_ev:
    dd = e['args']['data']
    st, en = dd.get('start'), dd.get('end')
    if not isinstance(st, (int, float)) or not isinstance(en, (int, float)):
        continue
    spans.append({'name': dd.get('message') or dd.get('name'), 'track': dd.get('track'), 'group': dd.get('trackGroup'),
                  's': t0 + st * 1000, 'e': t0 + en * 1000, 'emit': e['ts']})
print(f'# TimeStamp: {len(ts_ev)} zdarzeń, {len(spans)} przedziałów; ścieżki:', collections.Counter(s['track'] for s in spans).most_common(8))
comp = sorted([s for s in spans if s['track'] == 'Components ⚛'], key=lambda s: (s['s'], -(s['e'] - s['s'])))
# czas własny: przedział minus przedziały bezpośrednio zagnieżdżone (ta sama ścieżka)
stack = []
for s in comp:
    s['self'] = s['e'] - s['s']; s['kids'] = 0
    while stack and stack[-1]['e'] <= s['s']:
        stack.pop()
    if stack and s['e'] <= stack[-1]['e'] + 1:
        stack[-1]['self'] -= (s['e'] - s['s'])
    stack.append(s)
tasks = [e for e in ev if e.get('pid') == pid and e.get('tid') == tid and e.get('name') == 'RunTask' and e.get('ph') == 'X' and e.get('dur', 0) >= mn * 1000]
for t in sorted(tasks, key=lambda e: e['ts']):
    a, b = t['ts'], t['ts'] + t['dur']
    inside = [s for s in comp if s['s'] >= a - 50 and s['e'] <= b + 50]
    sched = [s for s in spans if s['group'] == 'Scheduler ⚛' and s['s'] < b and s['e'] > a]
    if not inside and not sched:
        continue
    agg = collections.defaultdict(lambda: [0, 0.0, 0.0])
    for s in inside:
        agg[s['name']][0] += 1; agg[s['name']][1] += max(0, s['self']) / 1000; agg[s['name']][2] += (s['e'] - s['s']) / 1000
    ph = collections.defaultdict(float)
    for s in sched:
        ph[f"{s['track']}:{s['name']}"] += (min(b, s['e']) - max(a, s['s'])) / 1000
    print(f"\n== {(a - t0) / 1000:.0f} / {t['dur'] / 1000:.1f} ms: komponentów {len(inside)}; fazy: " + ', '.join(f'{k} {v:.1f}' for k, v in sorted(ph.items(), key=lambda kv: -kv[1])[:6]))
    for k, (n, sf, inc) in sorted(agg.items(), key=lambda kv: -kv[1][1])[:top]:
        print(f'   {sf:6.1f} własny  {inc:6.1f} inkl  x{n:<3} {k}')
