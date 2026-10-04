#!/usr/bin/env python3
"""P0.5 (domknięcie): składa raport z sekcji doc/*.md i tabel gen/*.md; wypełnia {{…}} liczbami z wi-*.jsonl
i project.json (uruchomić wcześniej: mkdoc.py, mkwave.py, project.py)."""
import os, json, glob, statistics as st, collections
W = os.path.dirname(os.path.abspath(__file__))
rd = lambda p: open(f'{W}/{p}').read().rstrip() + '\n'
pl = lambda x: f'{x:.0f}'
recs = collections.defaultdict(dict)
for f in glob.glob(f'{W}/wi-*.jsonl'):
    for l in open(f):
        d = json.loads(l); recs[(d['wave'], d['var'], d['reg'])][d['run']] = d['after']
def med(wave, var, reg):
    R = recs[(wave, var, reg)]
    assert len(R) == 5, (wave, var, reg, len(R))
    return pl(st.median(R.values()))
pj = json.load(open(f'{W}/project.json'))
def psi(key, wave, field='Mb'):
    r = pj[key]['rows'][wave]
    return f"{pl(r['half'][field])} / {pl(r['full'][field])}"
def sc(key, wave):
    r = pj[key]['rows'][wave]
    return f"{pl(r['half']['score'][1])} / {pl(r['full']['score'][1])}"
V = {
 'W2M_H': med('W2', 'half', 'm4c3'), 'W2M_F': med('W2', 'full', 'm4c3'),
 'W3M_H': med('W3', 'half', 'm4c3'), 'W3M_F': med('W3', 'full', 'm4c3'),
 'W2D4_H': med('W2', 'half', 'd4c3'), 'W2D4_F': med('W2', 'full', 'd4c3'),
 'W2D5_H': med('W2', 'half', 'd5c3'), 'W2D5_F': med('W2', 'full', 'd5c3'),
 'PSI_W1M': psi('mobile', 'W1'), 'PSI_W2M': psi('mobile', 'W2'), 'SC_W2M': sc('mobile', 'W2'),
 'PSI_W2D4': psi('desktop4', 'W2'), 'SC_W2D4': sc('desktop4', 'W2'),
 'PSI_W2D5': psi('desktop5', 'W2'), 'SC_W2D5': sc('desktop5', 'W2'),
}
V['W2M'] = f"{V['W2M_H']} (×0,5) / {V['W2M_F']} (pełne)"
V['W2PSI'] = V['PSI_W2M']
V['W2D'] = f"x4 {sc('desktop4', 'W2')}, x5 {sc('desktop5', 'W2')} (×0,5 / pełne; M-b); po W3 x4 {sc('desktop4', 'W3')}, x5 {sc('desktop5', 'W3')}"
V['WAVES'] = rd('gen/waves.md').rstrip()
V['PROJECT'] = rd('gen/project.md').rstrip()
parts = [rd('doc/s0.md'), rd('doc/s1.md'), rd('doc/s2head.md'),
         '### 2.1 Mobile x4 (m4)\n', rd('gen/ledger-m4.md'),
         '### 2.2 Desktop x4 (d4)\n', rd('gen/ledger-d4.md'),
         '### 2.3 Desktop x5 (d5)\n', rd('gen/ledger-d5.md'),
         rd('doc/s24.md'), rd('doc/s25.md'), rd('gen/k8.md'),
         rd('doc/s3head.md'),
         '### 3.1 Mobile x4 z C3 (m4c3)\n', rd('gen/ledger-m4c3.md'),
         '### 3.2 Desktop x4 z C3 (d4c3)\n', rd('gen/ledger-d4c3.md'),
         '### 3.3 Desktop x5 z C3 (d5c3)\n', rd('gen/ledger-d5c3.md'),
         rd('doc/s34.md'), rd('doc/s4.md'), rd('doc/s5.md'), rd('doc/s6.md'), rd('doc/s7.md'), rd('doc/s8.md'), rd('doc/s9.md')]
txt = '\n'.join(parts)
for k, v in V.items():
    txt = txt.replace('{{' + k + '}}', v)
assert '{{' not in txt, txt[txt.index('{{'):txt.index('{{') + 40]
open(f'{W}/REPORT.md', 'w').write(txt)
print(len(txt), 'znaków')
