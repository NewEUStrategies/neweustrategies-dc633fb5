#!/usr/bin/env python3
"""Lantern what-if engine: edit saved Lighthouse artifacts (devtoolslog / trace / settings) and re-run
the Lighthouse 13.5 audits offline (node audit.mjs) - deterministic, no CPU noise, no network.

Usage: whatif.py <form: mobile|desktop> <name> <edit> [<edit> ...]
Edits (composable, applied in order):
  h2                         all same-origin responses -> protocol h2 (production parity; fixture proxy is http/1.1)
  drop:<regex>               remove requests whose URL matches (as if not requested before LCP)
  dropscripts-before-lcp     remove every Script request that ENDED before observed LCP (boot-after-LCP upper bound)
  size:<regex>:<factor>      scale transfer bytes of matching requests
  prio:<regex>:<Priority>    set initial priority (VeryHigh/High/Medium/Low/VeryLow)
  cpu:<multiplier>           settings.throttling.cpuSlowdownMultiplier (mobile default 4, desktop 1)
  shrink:<t0ms>:<t1ms>:<f>   scale (f<=1) duration of main-thread top-level tasks starting in [t0,t1] ms after navStart
  shrinkurl:<regex>:<f>      scale (f<=1) top-level tasks whose FunctionCall/compile children reference URL regex
  shrinkcss:<f>              scale tasks containing ParseAuthorStyleSheet
  shrinkparse:<f>            scale tasks containing ParseHTML
Writes wi/<name>-<form>.json and prints one JSON line with metrics + score.
"""
import json, os, re, shutil, subprocess, sys
HERE = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase1/lighthouse-analyst'
P05 = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05'
SRC = {'mobile': f'{HERE}/artifacts/lha1-mobile', 'desktop': f'{HERE}/artifacts/lha1-desktop'}
sys.path.insert(0, HERE)
from score import perf_score, displayed


def load(p):
    with open(p) as f:
        return json.load(f)


def main():
    form, name, edits = sys.argv[1], sys.argv[2], sys.argv[3:]
    src = os.environ.get('WI_SRC') or SRC[form]
    dst = f'{P05}/wi/tmp-{name}-{form}'
    if os.path.exists(dst):
        shutil.rmtree(dst)
    os.makedirs(dst)
    dl = load(f'{src}/devtoolslog.json')
    art = load(f'{src}/artifacts.json')
    trace = None
    tr_dirty = False

    def get_trace():
        nonlocal trace
        if trace is None:
            trace = load(f'{src}/trace.json')
        return trace

    # request id -> url
    rid_url = {}
    for e in dl:
        if e['method'] == 'Network.requestWillBeSent':
            rid_url[e['params']['requestId']] = e['params']['request']['url']
    rid_end = {e['params']['requestId']: e['params']['timestamp'] for e in dl if e['method'] == 'Network.loadingFinished'}
    rid_type = {e['params']['requestId']: e['params'].get('type') for e in dl if e['method'] == 'Network.responseReceived'}

    def nav_info():
        tr = get_trace()['traceEvents']
        nav = next(e for e in tr if e.get('name') == 'navigationStart' and e.get('args', {}).get('data', {}).get('isLoadingMainFrame'))
        lcp = [e for e in tr if e.get('name') == 'largestContentfulPaint::Candidate']
        return nav, tr, lcp

    for ed in edits:
        parts = ed.split(':')
        op = parts[0]
        if op == 'h2':
            for e in dl:
                if e['method'] == 'Network.responseReceived' and e['params']['response'].get('protocol') == 'http/1.1':
                    e['params']['response']['protocol'] = 'h2'
        elif op == 'drop':
            rx = re.compile(':'.join(parts[1:]))
            ids = {r for r, u in rid_url.items() if rx.search(u)}
            dl = [e for e in dl if e.get('params', {}).get('requestId') not in ids]
        elif op == 'dropscripts-before-lcp':
            nav, tr, lcp = nav_info()
            t_lcp = max(e['ts'] for e in lcp) / 1e6  # seconds, same clock as devtools timestamps (monotonic)
            ids = {r for r, t in rid_type.items() if t == 'Script' and rid_end.get(r, 1e18) <= t_lcp}
            dl = [e for e in dl if e.get('params', {}).get('requestId') not in ids]
            print(f'# dropped {len(ids)} scripts ended before LCP', file=sys.stderr)
        elif op == 'size':
            rx = re.compile(':'.join(parts[1:-1])); f = float(parts[-1])
            ids = {r for r, u in rid_url.items() if rx.search(u)}
            for e in dl:
                p = e.get('params', {})
                if p.get('requestId') not in ids:
                    continue
                if e['method'] == 'Network.loadingFinished':
                    p['encodedDataLength'] = int(p['encodedDataLength'] * f)
                elif e['method'] == 'Network.dataReceived':
                    p['encodedDataLength'] = int(p.get('encodedDataLength', 0) * f)
                    p['dataLength'] = int(p.get('dataLength', 0) * f)
        elif op == 'ttfb':
            rx = re.compile(':'.join(parts[1:-1])); add = float(parts[-1])
            for e in dl:
                if e['method'] == 'Network.responseReceived' and rx.search(rid_url.get(e['params']['requestId'], '')):
                    t = e['params']['response'].get('timing')
                    if t:
                        for k in ('receiveHeadersStart', 'receiveHeadersEnd'):
                            if k in t and t[k] >= 0:
                                t[k] += add
        elif op == 'srt':
            # precomputedLanternData: server response time (ms) for the page origin + fixture images origin
            ms = float(parts[-1])
            art['settings']['precomputedLanternData'] = {
                'additionalRttByOrigin': {'http://127.0.0.1:5244': 0, 'https://fixture.invalid': 0},
                'serverResponseTimeByOrigin': {'http://127.0.0.1:5244': ms, 'https://fixture.invalid': ms}}
        elif op == 'prio':
            rx = re.compile(':'.join(parts[1:-1])); pr = parts[-1]
            for e in dl:
                if e['method'] == 'Network.requestWillBeSent' and rx.search(e['params']['request']['url']):
                    e['params']['request']['initialPriority'] = pr
                if e['method'] == 'Network.resourceChangedPriority' and rx.search(rid_url.get(e['params']['requestId'], '')):
                    e['params']['newPriority'] = pr
        elif op == 'cpu':
            art['settings']['throttling']['cpuSlowdownMultiplier'] = float(parts[1])
        elif op in ('shrink', 'shrinkurl', 'shrinkcss', 'shrinkparse', 'cap'):
            nav, tr, _ = nav_info()
            t_nav = nav['ts']
            main_pid, main_tid = nav['pid'], nav['tid']
            if op == 'shrink':
                t0, t1, f = float(parts[1]) * 1000 + t_nav, float(parts[2]) * 1000 + t_nav, float(parts[3])
                pick = lambda task, kids: t0 <= task['ts'] <= t1
            elif op == 'shrinkurl':
                rx = re.compile(':'.join(parts[1:-1])); f = float(parts[-1])
                def pick(task, kids):
                    for k in kids:
                        a = k.get('args', {})
                        d = a.get('data', {}) if isinstance(a.get('data'), dict) else {}
                        u = d.get('url') or d.get('scriptName') or a.get('fileName') or ''
                        if u and rx.search(u):
                            return True
                        st = d.get('stackTrace') or []
                        if st and rx.search(st[0].get('url', '')):
                            return True
                    return False
            elif op == 'cap':
                t0 = float(parts[1]) * 1000 + t_nav; capus = float(parts[2]) * 1000
                pick = lambda task, kids: task['ts'] >= t0 and task['dur'] > capus
                f = None
            elif op == 'shrinkcss':
                f = float(parts[1]); pick = lambda task, kids: any(k.get('name') == 'ParseAuthorStyleSheet' for k in kids)
            else:
                f = float(parts[1]); pick = lambda task, kids: any(k.get('name') == 'ParseHTML' for k in kids)
            main = [e for e in tr if e.get('pid') == main_pid and e.get('tid') == main_tid and e.get('ph') in ('X', 'B', 'E', 'I', 'i')]
            tops = [e for e in main if e.get('name') == 'RunTask' and e.get('ph') == 'X' and e.get('dur')]
            tops.sort(key=lambda e: e['ts'])
            main_sorted = sorted([e for e in main if e.get('ph') == 'X'], key=lambda e: e['ts'])
            n = 0; saved = 0
            j = 0
            for task in tops:
                s, en = task['ts'], task['ts'] + task['dur']
                kids = [e for e in main_sorted if s < e['ts'] < en or (e['ts'] == s and e is not task)]
                if not pick(task, kids):
                    continue
                if op == 'cap':
                    f = capus / task['dur']
                n += 1; saved += task['dur'] * (1 - f)
                for k in kids:
                    k['ts'] = s + (k['ts'] - s) * f
                    if 'dur' in k:
                        k['dur'] = k['dur'] * f
                task['dur'] = task['dur'] * f
            tr_dirty = True
            print(f'# {op}: scaled {n} tasks, removed {saved/1000:.0f} ms observed CPU', file=sys.stderr)
        else:
            raise SystemExit('unknown edit ' + ed)
    with open(f'{dst}/devtoolslog.json', 'w') as f:
        json.dump(dl, f)
    with open(f'{dst}/artifacts.json', 'w') as f:
        json.dump(art, f)
    if tr_dirty:
        with open(f'{dst}/trace.json', 'w') as f:
            json.dump(trace, f)
    else:
        os.symlink(f'{src}/trace.json', f'{dst}/trace.json')
    out = f'{P05}/wi/{name}-{form}.json'
    r = subprocess.run(['node', f'{HERE}/audit.mjs', dst, out], capture_output=True, text=True)
    line = [l for l in r.stdout.splitlines() if l.startswith('{')]
    if not line:
        print(r.stdout[-2000:], r.stderr[-3000:]); sys.exit(1)
    res = json.loads(line[-1])
    sc, _ = perf_score(form, {'FCP': res['FCP'], 'LCP': res['LCP'], 'TBT': res['TBT'], 'SI': res['SI'], 'CLS': 0})
    res.update({'name': name, 'form': form, 'edits': edits})
    print(json.dumps(res))
    if not os.environ.get("WI_KEEP"):
        shutil.rmtree(dst)


if __name__ == '__main__':
    main()
