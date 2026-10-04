#!/usr/bin/env python3
"""Readable summary of a Lighthouse JSON report (v12/v13).

Usage: python3 lh-summary.py report.json [--top N]
Prints: score + metrics, LCP element & phases, render-blocking, network
requests on the critical path (by priority/size), main-thread breakdown,
bootup-time per script, unused JS per script, long tasks, forced reflow,
third parties, DOM size, cache TTL offenders, non-composited animations.
"""
import json, sys

path = sys.argv[1]
top = 25
if "--top" in sys.argv:
    top = int(sys.argv[sys.argv.index("--top") + 1])
d = json.load(open(path))
a = d["audits"]
cfg = d.get("configSettings", {})
print(f"URL: {d.get('finalDisplayedUrl')}  formFactor={cfg.get('formFactor')}  throttling={cfg.get('throttlingMethod')}  LH {d.get('lighthouseVersion')}")
print(f"PERFORMANCE SCORE: {round(d['categories']['performance']['score']*100)}")
for k in ["first-contentful-paint","largest-contentful-paint","total-blocking-time","speed-index","cumulative-layout-shift","interactive","max-potential-fid","server-response-time"]:
    au = a.get(k)
    if au:
        print(f"  {k:32s} {str(au.get('displayValue')):>22s}  score={au.get('score')}")

def items(key):
    au = a.get(key) or {}
    det = au.get("details") or {}
    its = det.get("items") or []
    if isinstance(its, dict):
        its = [its]
    # insight audits nest tables under details.items[].items or details.chains
    return au, det, its

def node_label(v):
    if isinstance(v, dict):
        return v.get("snippet") or v.get("nodeLabel") or v.get("selector") or json.dumps(v)[:120]
    return v

print("\n== LCP element / phases")
au, det, its = items("largest-contentful-paint-element")
for it in its:
    if "items" in it:
        for x in it["items"]:
            print("   ", {k: node_label(v) for k, v in x.items()})
    else:
        print("   ", {k: node_label(v) for k, v in it.items()})
for key in ["lcp-discovery-insight", "lcp-breakdown-insight", "lcp-phases-insight"]:
    au, det, its = items(key)
    if au:
        print(f"  [{key}] score={au.get('score')} {au.get('displayValue') or ''}")
        for it in its[:8]:
            print("    ", json.dumps({k: node_label(v) for k, v in it.items()}, ensure_ascii=False)[:400])

print("\n== Render-blocking / document latency")
for key in ["render-blocking-insight", "render-blocking-resources", "document-latency-insight", "network-dependency-tree-insight"]:
    au, det, its = items(key)
    if au and au.get("score") is not None or its:
        print(f"  [{key}] score={au.get('score')} {au.get('displayValue') or ''} savings={det.get('overallSavingsMs')}")
        for it in its[:10]:
            print("    ", json.dumps({k: node_label(v) for k, v in it.items() if k != 'node'}, ensure_ascii=False)[:300])

print("\n== Network requests (sorted by transferSize)")
au, det, its = items("network-requests")
rows = []
for it in its:
    rows.append((it.get("transferSize") or 0, it.get("resourceSize") or 0, it.get("priority"), it.get("resourceType"), round(it.get("networkRequestTime") or 0), round(it.get("networkEndTime") or 0), it.get("url")))
tot_t = sum(r[0] for r in rows); tot_r = sum(r[1] for r in rows)
print(f"  requests={len(rows)} transfer={tot_t} resource={tot_r}")
by_type = {}
for r in rows:
    t = by_type.setdefault(r[3], [0, 0, 0]); t[0] += 1; t[1] += r[0]; t[2] += r[1]
for t, v in sorted(by_type.items(), key=lambda kv: -kv[1][1]):
    print(f"   {str(t):12s} n={v[0]:3d} transfer={v[1]:9d} resource={v[2]:9d}")
rows.sort(reverse=True)
print(f"  {'transfer':>9} {'resource':>9} {'prio':>8} {'type':>8} {'start':>6} {'end':>6}  url")
for r in rows[:top]:
    u = r[6]
    u = u.replace("https://neweuropeanstrategies.com", "")
    print(f"  {r[0]:>9} {r[1]:>9} {str(r[2]):>8} {str(r[3]):>8} {r[4]:>6} {r[5]:>6}  {u[:110]}")

print("\n== Main thread breakdown")
au, det, its = items("mainthread-work-breakdown")
print(f"  total {au.get('displayValue')}")
for it in its:
    print(f"   {it.get('groupLabel'):36s} {round(it.get('duration') or 0):6d} ms")

print("\n== Bootup time per script (top)")
au, det, its = items("bootup-time")
print(f"  total {au.get('displayValue')}")
for it in sorted(its, key=lambda x: -(x.get('total') or 0))[:top]:
    print(f"   total={round(it.get('total') or 0):5d} script={round(it.get('scripting') or 0):5d} parse={round(it.get('scriptParseCompile') or 0):5d}  {str(it.get('url')).replace('https://neweuropeanstrategies.com','')[:100]}")

print("\n== Unused JavaScript (top)")
au, det, its = items("unused-javascript")
print(f"  {au.get('displayValue')} savingsBytes={det.get('overallSavingsBytes')}")
for it in sorted(its, key=lambda x: -(x.get('wastedBytes') or 0))[:top]:
    print(f"   wasted={it.get('wastedBytes'):7d} of total={it.get('totalBytes'):7d} ({it.get('wastedPercent') and round(it.get('wastedPercent'))}%)  {str(it.get('url')).replace('https://neweuropeanstrategies.com','')[:100]}")

print("\n== Unused CSS")
au, det, its = items("unused-css-rules")
for it in its[:5]:
    print(f"   wasted={it.get('wastedBytes')} total={it.get('totalBytes')} {str(it.get('url'))[:100]}")

print("\n== Long tasks")
au, det, its = items("long-tasks")
print(f"  {au.get('displayValue')}")
for it in its[:top]:
    print(f"   start={round(it.get('startTime') or 0):6d} dur={round(it.get('duration') or 0):5d}  {str(it.get('url')).replace('https://neweuropeanstrategies.com','')[:100]}")

print("\n== Forced reflow")
au, det, its = items("forced-reflow-insight")
print(f"  score={au.get('score')} {au.get('displayValue') or ''}")
for it in its[:10]:
    print("    ", json.dumps(it, ensure_ascii=False)[:500])

print("\n== Non-composited animations")
au, det, its = items("non-composited-animations")
for it in its[:10]:
    print("    ", json.dumps({k: node_label(v) for k, v in it.items()}, ensure_ascii=False)[:400])

print("\n== Third parties")
au, det, its = items("third-party-summary")
for it in its[:10]:
    print("    ", json.dumps({k: node_label(v) for k, v in it.items()}, ensure_ascii=False)[:300])

print("\n== DOM size")
au, det, its = items("dom-size")
print(f"  {au.get('displayValue')}")
for it in its:
    print("    ", json.dumps({k: node_label(v) for k, v in it.items()}, ensure_ascii=False)[:300])

print("\n== Cache TTL offenders")
au, det, its = items("uses-long-cache-ttl")
for it in its[:15]:
    print(f"   ttl={it.get('cacheLifetimeMs')} wasted={it.get('wastedBytes')} {str(it.get('url'))[:120]}")

print("\n== Image delivery")
for key in ["image-delivery-insight", "modern-image-formats", "uses-responsive-images", "uses-optimized-images", "offscreen-images"]:
    au, det, its = items(key)
    if its:
        print(f"  [{key}] {au.get('displayValue') or ''}")
        for it in its[:8]:
            print("    ", json.dumps({k: node_label(v) for k, v in it.items() if k not in ('node',)}, ensure_ascii=False)[:300])

print("\n== Other insights")
for key in ["duplicated-javascript-insight", "legacy-javascript-insight", "font-display-insight", "viewport-insight", "cache-insight", "third-parties-insight", "dom-size-insight", "modern-http-insight", "network-dependency-tree-insight", "inp-breakdown-insight", "cls-culprits-insight"]:
    au = a.get(key)
    if au and (au.get("score") is not None and au.get("score") < 1 or au.get("displayValue")):
        print(f"  [{key}] score={au.get('score')} {au.get('displayValue') or ''}")

print("\n== User timing marks/measures count")
au, det, its = items("user-timings")
print(f"  {au.get('displayValue')}  n={len(its)}")
from collections import Counter
c = Counter((it.get('name') or '').split(':')[0] for it in its)
print("   ", c.most_common(15))
