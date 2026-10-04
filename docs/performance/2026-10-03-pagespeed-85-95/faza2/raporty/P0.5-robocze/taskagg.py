# Agregacja zdarzeń (X) głównego wątku wewnątrz zadań RunTask >= min ms: nazwa -> (liczba, ms), top N; dla zadań w [a,b].
import json,sys,collections
d=sys.argv[1]; a=float(sys.argv[2]); b=float(sys.argv[3]); mn=float(sys.argv[4]) if len(sys.argv)>4 else 25; top=int(sys.argv[5]) if len(sys.argv)>5 else 25
tr=json.load(open(d+'/trace.json')); ev=tr['traceEvents'] if isinstance(tr,dict) else tr
nav=next(e for e in ev if e.get('name')=='navigationStart' and e.get('args',{}).get('data',{}).get('isLoadingMainFrame'))
t0,pid,tid=nav['ts'],nav['pid'],nav['tid']
main=sorted([e for e in ev if e.get('pid')==pid and e.get('tid')==tid and e.get('ph')=='X'],key=lambda e:e['ts'])
tasks=[e for e in main if e['name']=='RunTask' and e.get('dur',0)>=mn*1000 and a<=(e['ts']-t0)/1000<=b]
for t in tasks:
  s,en=t['ts'],t['ts']+t['dur']
  agg=collections.defaultdict(lambda:[0,0.0])
  for e in main:
    if e['ts']<s: continue
    if e['ts']>=en: break
    if e is t: continue
    agg[e['name']][0]+=1; agg[e['name']][1]+=e.get('dur',0)/1000
  print(f"== {(s-t0)/1000:.1f} dur {t['dur']/1000:.1f}: "+' '.join(f"{k}x{v[0]}={v[1]:.1f}" for k,v in sorted(agg.items(),key=lambda kv:-kv[1][1])[:top]))
