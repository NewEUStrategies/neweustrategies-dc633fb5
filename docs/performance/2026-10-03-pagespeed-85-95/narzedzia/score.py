#!/usr/bin/env python3
"""Lighthouse 13 performance score model (mobile + desktop) - lighthouse-analyst workstream.

Re-implements lighthouse/core/lib/statistics.js getLogNormalScore + Audit score rounding
(2 decimals) + category weighted mean, and the Lantern SpeedIndex coefficient scaling, so that
any (FCP, LCP, TBT, SI, CLS) tuple can be scored exactly like PSI does.

CLI:
  score.py score  mobile FCP LCP TBT SI [CLS]        -> score + per-metric decomposition
  score.py json   <lighthouse.json>                  -> rescore a report (sanity check vs reported)
  score.py need   mobile 85 [--fix FCP=1800,...]     -> per-metric thresholds / feasible combos
  score.py sens   mobile FCP LCP TBT SI              -> points gained per -100 ms (-10 ms TBT)
  score.py si     mobile <observedSI> <layoutSI> <FCP> -> Lantern SI estimate
Library: metric_score(form, key, value), perf_score(form, dict), solve_metric(...), si_coeffs(rtt)
"""
import math, sys, json, itertools

# (p10, median, weight) - Lighthouse 13 default-config.js / scoring curves
CURVES = {
    'mobile': {'FCP': (1800, 3000, .10), 'SI': (3387, 5800, .10), 'LCP': (2500, 4000, .25),
               'TBT': (200, 600, .30), 'CLS': (0.1, 0.25, .25)},
    'desktop': {'FCP': (934, 1600, .10), 'SI': (1311, 2300, .10), 'LCP': (1200, 2400, .25),
                'TBT': (150, 350, .30), 'CLS': (0.1, 0.25, .25)},
}
INVERSE_ERFC_ONE_FIFTH = 0.9061938024368232


def _erf(x):
    # identical approximation to lighthouse statistics.js (Abramowitz-Stegun 7.1.26)
    sign = -1 if x < 0 else 1
    x = abs(x)
    a1, a2, a3, a4, a5 = 0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429
    p = 0.3275911
    t = 1 / (1 + p * x)
    y = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))))
    return sign * (1 - y * math.exp(-x * x))


def log_normal_score(p10, median, value):
    if value <= 0:
        return 1.0
    x_log_ratio = math.log(max(sys.float_info.min, value / median))
    p10_log_ratio = -math.log(max(sys.float_info.min, p10 / median))
    standardized_x = x_log_ratio * INVERSE_ERFC_ONE_FIFTH / p10_log_ratio
    cp = (1 - _erf(standardized_x)) / 2
    if value <= p10:
        s = max(0.9, min(1, cp))
    elif value <= median:
        s = max(0.5, min(0.89999999999999, cp))
    else:
        s = max(0, min(0.49999999999999, cp))
    return s


def metric_score(form, key, value, rounded=True):
    p10, med, _ = CURVES[form][key]
    s = log_normal_score(p10, med, value)
    if not rounded:
        return s
    # lighthouse/shared/util.js computeLogNormalScore: +0.05*(s-0.9) boost above 0.9, then FLOOR to 2 dp
    if s > 0.9:
        s += 0.05 * (s - 0.9)
    return math.floor(s * 100 + 1e-9) / 100


def perf_score(form, vals):
    """vals: dict FCP,LCP,TBT,SI,CLS (ms / unitless). Returns (score0..1, {k: (metricScore, points)})."""
    parts, tot = {}, 0.0
    for k, (_, _, w) in CURVES[form].items():
        v = vals.get(k, 0)
        s = metric_score(form, k, v)
        parts[k] = (s, s * w * 100)
        tot += s * w
    return tot, parts


def displayed(score):
    return round(score * 100)


def solve_metric(form, key, target_metric_score):
    """Largest metric value whose (rounded) score is >= target."""
    p10, med, _ = CURVES[form][key]
    lo, hi = 0.0, med * 6
    for _ in range(80):
        mid = (lo + hi) / 2
        if metric_score(form, key, mid) >= target_metric_score:
            lo = mid
        else:
            hi = mid
    return lo


def si_coeffs(rtt_ms):
    """Lantern SpeedIndex coefficients scaled by RTT (trace_engine lantern/metrics/SpeedIndex.js)."""
    mult = max((rtt_ms - 30) / (150 - 30), 0)
    return {'intercept': 0.0, 'optimistic': 0.5 + (1.4 - 0.5) * mult, 'pessimistic': 0.5 + (0.4 - 0.5) * mult}


def lantern_si(form, observed_si, layout_si, fcp):
    c = si_coeffs(150 if form == 'mobile' else 40)
    return max(fcp, c['intercept'] + c['optimistic'] * observed_si + c['pessimistic'] * layout_si)


def sensitivity(form, vals):
    base, _ = perf_score(form, vals)
    out = {}
    for k, step in (('FCP', 100), ('LCP', 100), ('SI', 100), ('TBT', 10)):
        v2 = dict(vals); v2[k] = max(0, vals[k] - step)
        out[k] = (perf_score(form, v2)[0] - base) * 100
    return out


def grid_targets(form, target, fixed=None):
    """Enumerate representative feasible combos reaching `target` points with CLS=0."""
    fixed = fixed or {}
    rng = {
        'mobile': {'FCP': [1500, 1800, 2000, 2200, 2500, 2800], 'LCP': [2000, 2300, 2500, 2800, 3000, 3300, 3600],
                   'TBT': [100, 150, 200, 250, 300, 350, 400], 'SI': [2500, 3000, 3400, 3800, 4200, 4600]},
        'desktop': {'FCP': [600, 700, 800, 934, 1000, 1100], 'LCP': [800, 900, 1000, 1100, 1200, 1400],
                    'TBT': [0, 50, 100, 150, 200, 250], 'SI': [900, 1100, 1311, 1500, 1700, 1900]},
    }[form]
    for k, v in fixed.items():
        rng[k] = [v]
    res = []
    for f, l, t, s in itertools.product(rng['FCP'], rng['LCP'], rng['TBT'], rng['SI']):
        if s < f:  # Lantern: SI >= FCP always
            continue
        sc, _ = perf_score(form, {'FCP': f, 'LCP': l, 'TBT': t, 'SI': s, 'CLS': 0})
        if displayed(sc) >= target:
            res.append((displayed(sc), f, l, t, s))
    return res


def _fmt(form, vals):
    tot, parts = perf_score(form, vals)
    lines = [f"{form}: score={tot*100:.2f} -> displayed {displayed(tot)}"]
    for k in ('FCP', 'LCP', 'TBT', 'SI', 'CLS'):
        s, p = parts[k]
        lines.append(f"  {k:3s} {vals.get(k,0):8.1f}  metricScore={s:.2f}  points={p:5.2f}/{CURVES[form][k][2]*100:.0f}  lost={CURVES[form][k][2]*100-p:5.2f}")
    return '\n'.join(lines)


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a:
        print(__doc__); sys.exit(0)
    cmd = a[0]
    if cmd == 'score':
        form = a[1]; f, l, t, s = map(float, a[2:6]); cls = float(a[6]) if len(a) > 6 else 0
        print(_fmt(form, {'FCP': f, 'LCP': l, 'TBT': t, 'SI': s, 'CLS': cls}))
    elif cmd == 'json':
        d = json.load(open(a[1])); A = d['audits']; form = d['configSettings']['formFactor']
        vals = {'FCP': A['first-contentful-paint']['numericValue'], 'LCP': A['largest-contentful-paint']['numericValue'],
                'TBT': A['total-blocking-time']['numericValue'], 'SI': A['speed-index']['numericValue'],
                'CLS': A['cumulative-layout-shift']['numericValue']}
        print(_fmt(form, vals)); print(f"  reported: {d['categories']['performance']['score']*100:.0f}")
    elif cmd == 'need':
        form = a[1]; target = int(a[2])
        fixed = {}
        if '--fix' in a:
            for kv in a[a.index('--fix') + 1].split(','):
                k, v = kv.split('='); fixed[k] = float(v)
        res = grid_targets(form, target, fixed)
        print(f"{len(res)} grid combos reach {target} ({form}); loosest per TBT:")
        best = {}
        for r in res:
            key = r[3]
            if key not in best or (r[1] + r[2] + r[4]) > (best[key][1] + best[key][2] + best[key][4]):
                best[key] = r
        for k in sorted(best):
            print('  score=%d FCP=%d LCP=%d TBT=%d SI=%d' % best[k])
    elif cmd == 'sens':
        form = a[1]; f, l, t, s = map(float, a[2:6])
        print(sensitivity(form, {'FCP': f, 'LCP': l, 'TBT': t, 'SI': s, 'CLS': 0}))
    elif cmd == 'si':
        form = a[1]; o, L, f = map(float, a[2:5]); print(lantern_si(form, o, L, f))
