#!/usr/bin/env python3
"""P0.5: what-if poprawek per zadanie na artefaktach przebiegu (deterministycznie, Lantern):
skraca wskazane zadania (start obs [ms] -> współczynnik) i liczy TBT w reżimach formy.
Użycie: fixwi.py <dir> <form> <nazwa> <start:f>[,<start:f>...]   (f=0.01 ~ zadanie usunięte; f=0.25 ~ podział na 4)
Wynik: jedna linia JSON per reżim {reg, TBT_bazowe, TBT_po}."""
import json, os, subprocess, sys
P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
src, form, name, spec = os.path.realpath(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
shr = []
for part in spec.split(','):
    s, f = part.split(':')
    shr.append(f'shrink:{float(s)-0.3}:{float(s)+0.3}:{f}')
regs = {'mobile': [('m4', []), ('m4c3', ['dropscripts-before-lcp'])],
        'desktop': [('d4', ['cpu:4']), ('d4c3', ['cpu:4', 'dropscripts-before-lcp']), ('d5', ['cpu:5']), ('d5c3', ['cpu:5', 'dropscripts-before-lcp'])]}[form]
def run(tag, edits):
    env = dict(os.environ, WI_SRC=src)
    r = subprocess.run(['python3', f'{P}/whatif.py', form, f'{name}-{tag}', *edits], capture_output=True, text=True, env=env)
    line = [l for l in r.stdout.splitlines() if l.startswith('{')]
    return json.loads(line[-1])['TBT'] if line else None
for tag, edits in regs:
    base = run(tag + '-base', edits) if edits else json.load(open(f'{src}/lhr.report.json'))['audits']['total-blocking-time']['numericValue']
    after = run(tag + '-fix', edits + shr)
    print(json.dumps({'run': os.path.basename(src), 'name': name, 'reg': tag, 'TBT_base': round(base), 'TBT_fix': after, 'delta': None if after is None else after - round(base)}))
