import json,sys
d=json.load(open(sys.argv[1]));a=d['audits']
print('==',sys.argv[1].split('/')[-1], d['configSettings'].get('formFactor'), d['configSettings'].get('throttling'))
m=a['metrics']['details']['items'][0]
for k in ['firstContentfulPaint','largestContentfulPaint','interactive','totalBlockingTime','observedFirstContentfulPaint','observedLargestContentfulPaint','observedDomContentLoaded','observedLoad','observedTraceEnd','observedLastVisualChange','observedNavigationStart','observedTimeOrigin']:
    print(f"  {k:35s} {m.get(k)}")
print('-- long-tasks')
for it in a['long-tasks']['details']['items']:
    print(f"  start={it['startTime']:8.0f} dur={it['duration']:5.0f} {it['url'][:110]}")
print('-- TBT attribution guess: tasks within [FCP,TTI], blocking = dur-50')
fcp=m['firstContentfulPaint'];tti=m['interactive']
tot=0;by={}
for it in a['long-tasks']['details']['items']:
    s=it['startTime'];e=s+it['duration']
    if e<fcp or s>tti: continue
    b=max(0,it['duration']-50); tot+=b; by[it['url'][:80]]=by.get(it['url'][:80],0)+b
print('  sum',tot,'(reported TBT',a['total-blocking-time']['numericValue'],')')
for k,v in sorted(by.items(),key=lambda x:-x[1]): print(f"   {v:6.0f} {k}")
print('-- third-party-summary')
tp=a.get('third-party-summary',{}).get('details') or {}
for it in tp.get('items',[]):
    print('  ',json.dumps({k:it.get(k) for k in ['entity','transferSize','mainThreadTime','blockingTime']}))
print('-- bootup-time (top)')
for it in a['bootup-time']['details']['items'][:12]:
    print(f"  total={it['total']:7.0f} script={it['scripting']:6.0f} parse={it['scriptParseCompile']:5.0f} {it['url'][:110]}")
print('-- user-timings')
ut=a.get('user-timings',{})
print('  ',ut.get('displayValue'), ut.get('score'))
items=(ut.get('details') or {}).get('items',[])
print('   n=',len(items))
for it in items[:120]:
    print(f"   {it.get('timingType'):8s} start={it.get('startTime',0):8.1f} dur={it.get('duration') or 0:6.1f} {it.get('name')}")
