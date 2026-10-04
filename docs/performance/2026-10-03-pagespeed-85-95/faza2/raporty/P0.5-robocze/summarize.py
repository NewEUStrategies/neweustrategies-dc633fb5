#!/usr/bin/env python3
"""P0.5: składa księgi per zadanie (ledgers/<run>-<reżim>.json) w tabele: per przebieg i per klasa zadania.
Użycie: summarize.py <form: mobile|desktop> <run1> [run2 ...]   (run = prefiks nazwy, np. w0q-mobile-1)
Klasa zadania: heurystyka po zdarzeniach-dzieciach węzła CPU (ta sama dla śladów z i bez profilera)."""
import json, sys, statistics, os
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
form, runs = sys.argv[1], [a for a in sys.argv[2:] if not a.startswith('--')]
DUMP = next((a.split('=',1)[1] for a in sys.argv[2:] if a.startswith('--dump=')), None)
REG = ['m4', 'm4c3'] if form == 'mobile' else ['d4', 'd4c3', 'd5', 'd5c3']

def ms(t, k):
    return t['agg'].get(k, {}).get('ms', 0)

def cnt(t, k):
    return t['agg'].get(k, {}).get('n', 0)

def classify(t, state):
    fc = max(ms(t, 'FunctionCall'), ms(t, 'v8.callFunction'), ms(t, 'TimerFire'), ms(t, 'EventDispatch'))  # miara JS
    if 'DocumentLoader::CommitNavigation' in t['agg']:
        return 'nav (commit nawigacji + początek parsowania)'
    if 'ParseAuthorStyleSheet' in t['agg'] and fc < 2:
        return 'ParseHTML+CSS dokumentu (head: arkusz blokujący, inline <style>)' if ms(t, 'ParseHTML') >= 5 else 'ParseCSS (arkusz blokujący)'
    if ms(t, 'ParseHTML') >= 3 and fc < 2 and cnt(t, 'ParseHTML') < 10:
        return 'ParseHTML dokumentu (+inline skrypty)'
    if cnt(t, 'Animation') >= 3 and fc < 4 and ms(t, 'Layout') < 3:
        return 'start animacji CSS (kompozytor, animationstart)'
    if 'ScriptCatchup' in t['agg'] and fc < 2 and ms(t, 'RunMicrotasks') < 2 and ms(t, 'UpdateLayoutTree') < 3:
        return 'ScriptCatchup (kompilacja zestawu bootu)'
    if ms(t, 'Layout') >= 5 and ms(t, 'UpdateLayoutTree') >= 5 and fc < 8 and not state.get('frame1'):
        state['frame1'] = 1
        return 'pierwsza klatka (Style+Layout dokumentu)'
    if ms(t, 'Layout') >= 5 and ms(t, 'UpdateLayoutTree') >= 3 and fc < 8 and not state.get('root'):
        return 'druga klatka (odsłonięcie sekcji strumieniowanych $RV)'
    if 'v8.evaluateModule' in t['agg'] and ms(t, 'RunMicrotasks') >= 8 and not state.get('root'):
        state['root'] = 1
        return 'przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot)'
    if ms(t, 'TimerFire') >= 5 and state.get('root') and not state.get('timer'):
        state['timer'] = 1
        return 'timer startu (ciało po setTimeout(0) router.tsx:210)'
    if t['layout'] and fc >= 30 and not state.get('commit'):
        state['commit'] = 1
        return 'commit hydratacji + efekty pasywne + re-render sync'
    if ms(t, 'UpdateLayoutTree') >= 12 and fc < 3:
        if not state.get('root'):
            return 'druga klatka (odsłonięcie sekcji strumieniowanych $RV)'
        if state.get('commit') and not state.get('hdr'):
            state['hdr'] = 1
            return 'styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472)'
        if form == 'mobile' and t['obsStart'] > 900:
            return 'styl po przełączeniu urządzenia (data-device + style kolumn)'
        return 'styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472)' if form == 'desktop' else 'styl/klatka późna (inne)'
    if cnt(t, 'ParseHTML') >= 15 and fc >= 5:
        return 'ParseHTML w commicie Reacta (innerHTML arkuszy)'
    if fc >= 5:
        if not state.get('commit'):
            if state.get('root') and not state.get('router'):
                state['router'] = 1
                return 'hydrateStart: createRouter (processRouteTree) + hydracja zapytań'
            return 'render hydratacji (plaster przed commitem)'
        return 'plaster Reacta po commicie (leniwe granice, efekty)'
    if ms(t, 'MajorGC') + ms(t, 'MinorGC') >= 5:
        return 'GC'
    if 'TimerFire' in t['agg']:
        return 'timer (inny)'
    return 'inne'

allrows = []
for run in runs:
    per = {}
    for reg in REG:
        f = f'{P}/ledgers/{run}-{reg}.json'
        if not os.path.exists(f):
            continue
        d = json.load(open(f))
        for t in d['tasks']:
            r = per.setdefault(round(t['obsStart'], 1), {'t': t, 'b': {}, 'sim': {}})
            r['b'][reg] = t['avg']; r['sim'][reg] = max(t['optSimDur'], t['pesSimDur'])
    state = {}
    rows = []
    for k in sorted(per):
        r = per[k]; t = r['t']
        rows.append({'run': run, 'obs': k, 'dur': t['obsDur'], 'L': t['layout'], 'cls': classify(t, state), 'b': r['b'], 'sim': r['sim']})
    allrows += rows
    print(f'\n### {run}')
    print('| obs start / czas [ms] | L | klasa | ' + ' | '.join(f'sym/blok {g}' for g in REG) + ' |')
    print('|---|---|---|' + '---|' * len(REG))
    tot = {g: 0 for g in REG}
    for r in rows:
        if max([r['sim'].get(g, 0) for g in REG] + [0]) < 50 and max(r['b'].values() or [0]) == 0:
            continue
        cells = []
        for g in REG:
            tot[g] += r['b'].get(g, 0)
            cells.append(f"{r['sim'].get(g, 0):.0f}/{r['b'].get(g, 0):.0f}" if g in r['sim'] else '-')
        print(f"| {r['obs']:.0f} / {r['dur']:.1f} | {'L' if r['L'] else ''} | {r['cls']} | " + ' | '.join(cells) + ' |')
    print('| **suma** | | | ' + ' | '.join(f'**{tot[g]:.0f}**' for g in REG) + ' |')
if DUMP:
    json.dump([{k: r[k] for k in ('run', 'obs', 'dur', 'L', 'cls', 'b', 'sim')} for r in allrows], open(DUMP, 'w'), indent=0)
print('\n### klasy (mediana [min-max] po przebiegach; czas obs, blokowanie per reżim)')
cls = {}
for r in allrows:
    c = cls.setdefault(r['cls'], {'dur': [], **{g: [] for g in REG}, 'runs': set(), 'obs': []})
    c['runs'].add(r['run']); c['dur'].append(r['dur']); c['obs'].append(r['obs'])
    for g in REG:
        c[g].append(r['b'].get(g, 0))
def fmt(v):
    return f'{statistics.median(v):.0f} [{min(v):.0f}-{max(v):.0f}]' if v else '-'
print('| klasa | przebiegi | start obs | czas obs | ' + ' | '.join(f'blok {g}' for g in REG) + ' |')
print('|---|---|---|---|' + '---|' * len(REG))
n = len(runs)
for k, c in sorted(cls.items(), key=lambda kv: -sum(kv[1][REG[1]]) - sum(kv[1][REG[0]])):
    # suma per przebieg (klasa może mieć kilka zadań w przebiegu)
    per_run = {g: [] for g in REG}
    for run in runs:
        for g in REG:
            per_run[g].append(sum(r['b'].get(g, 0) for r in allrows if r['run'] == run and r['cls'] == k))
    if max(max(v) for v in per_run.values()) == 0 and max(c['dur']) < 12.5:
        continue
    print(f"| {k} | {len(c['runs'])}/{n} | {fmt(c['obs'])} | {fmt(c['dur'])} | " + ' | '.join(fmt(per_run[g]) for g in REG) + ' |')
