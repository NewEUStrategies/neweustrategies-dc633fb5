#!/usr/bin/env python3
"""P0.5 (domknięcie): klasy zadań po korekcie heurystyki summarize.py, na przebiegach ważnych w0q-<forma>-1..5.
Korekty (dowód w raporcie §2.3): (1) K8 dzielone po grupie animacji, której start przychodzi w zadaniu (animtasks.py):
K8a = zawiera oi-fade-in, K8b = szkielety lv-shimmer (+ ticker) bez oi-fade-in; (2) K13 = wyłącznie sygnatura zapisu
--sticky-header-h na <html> (przeliczenie >= 780 el. bez Layout, stos Header.tsx:566 w śladach inwalidacji);
zadanie 706 el. na mobile = K16 (sygnatura przełączenia urządzenia); pozostałe "style nagłówka" = K13b
(klatka stylu+layoutu po commicie, przyczyna nieustalona). Zwraca listę wierszy z polem kid.
Użycie (moduł): from classes import rows_for; rows_for(form)"""
import json, collections
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
W = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/w0fix/P0.5'
CM = json.load(open(f'{P}/classmap.json'))
REG = {'mobile': ['m4', 'm4c3'], 'desktop': ['d4', 'd4c3', 'd5', 'd5c3']}

def anim_groups(form):
    """run -> {round(obs task start): {grupa: liczba}} z animtasks.py (zapisane do anim-<form>.json)."""
    return json.load(open(f'{W}/anim-{form}.json'))

def rows_for(form):
    runs = [f'w0q-{form}-{i}' for i in range(1, 6)]
    dump = [r for r in json.load(open(f'{P}/dump-w0q-{form}.json')) if r['run'] in runs]
    an = anim_groups(form)
    led = {}
    for run in runs:
        m = {}
        for reg in reversed(REG[form]):  # pierwszy reżim wygrywa (m4/d4); pozostałe jako zapas sygnatury
            for t in json.load(open(f'{P}/ledgers/{run}-{reg}.json'))['tasks']:
                m[round(t['obsStart'], 1)] = t
        led[run] = m
    out = []
    for r in dump:
        kid = CM.get(r['cls'], {}).get('id', 'K-')
        t = led[r['run']].get(round(r['obs'], 1))
        els = [u['el'] or 0 for u in t['ult']] if t else []
        big = max(els or [0])
        nolay = not (t and t['lay'])
        if kid == 'K8':
            g = an.get(r['run'], {}).get(str(round(r['obs'])), {})
            if 'oi-fade-in' in g:
                kid = 'K8a'
            elif 'lv-shimmer' in g:
                kid = 'K8b'
            elif big >= 650 and nolay:
                kid = 'K13'  # restyle po commicie bez startu animacji (w0q-mobile-1, 696 el.)
            else:
                kid = 'K8c'  # tylko utworzenie animacji tickera (tt-flip, tt-flame-flicker)
        elif kid == 'K13':
            if form == 'mobile' and r['obs'] > 1000 and 700 <= big <= 712:
                kid = 'K16'
            elif big >= 650 and nolay or (not t or not t['ult']):
                kid = 'K13'
            else:
                kid = 'K13b'
        out.append({**r, 'kid': kid})
    return out

if __name__ == '__main__':
    import sys
    for form in ('mobile', 'desktop'):
        c = collections.Counter((r['kid'], r['cls'][:30]) for r in rows_for(form))
        for k, v in sorted(c.items()):
            print(form, k, v)
