# Przyczyny przeliczeń stylu: dla każdego UpdateLayoutTree >= min ms zbiera zdarzenia *InvalidationTracking
# od poprzedniego UpdateLayoutTree (powód, węzeł, selektory), plus stos ScheduleStyleRecalculation.
import json,sys,collections
d=sys.argv[1]; mn=float(sys.argv[2]) if len(sys.argv)>2 else 10
tr=json.load(open(d+'/trace.json')); ev=tr['traceEvents'] if isinstance(tr,dict) else tr
nav=next(e for e in ev if e.get('name')=='navigationStart' and e.get('args',{}).get('data',{}).get('isLoadingMainFrame'))
t0,pid,tid=nav['ts'],nav['pid'],nav['tid']
main=sorted([e for e in ev if e.get('pid')==pid and e.get('tid')==tid],key=lambda e:e['ts'])
ult=[e for e in main if e.get('name')=='UpdateLayoutTree' and e.get('ph')=='X']
inv=[e for e in main if 'InvalidationTracking' in e.get('name','') or e.get('name') in ('ScheduleStyleInvalidationTracking','StyleRecalcInvalidationTracking','StyleInvalidatorInvalidationTracking','LayoutInvalidationTracking')]
prev=t0
for u in ult:
  if u['dur']>=mn*1000:
    win=[e for e in inv if prev<=e['ts']<=u['ts']]
    c=collections.Counter(); nodes=collections.Counter(); sel=collections.Counter(); st=collections.Counter()
    for e in win:
      dd=e.get('args',{}).get('data',{})
      c[(e['name'].replace('InvalidationTracking',''),dd.get('reason') or dd.get('changedAttribute') or dd.get('changedClass') or dd.get('changedPseudo') or dd.get('changedId') or '')]+=1
      nodes[(dd.get('nodeName') or '')[:70]]+=1
      for s in (dd.get('selectors') or [])[:3]: sel[str(s.get('selector') if isinstance(s,dict) else s)[:60]]+=1
      for f in (dd.get('stackTrace') or [])[:1]: st[f"{f.get('functionName')}@{f.get('url','').split('/')[-1][:30]}:{f.get('lineNumber')}:{f.get('columnNumber')}"]+=1
    el=u.get('args',{}).get('elementCount')
    print(f"\n== ULT {(u['ts']-t0)/1000:.0f} {u['dur']/1000:.1f} ms el={el} (inwalidacji {len(win)} od {(prev-t0)/1000:.0f})")
    print('  powody:', c.most_common(8)); print('  węzły:', nodes.most_common(6)); print('  selektory:', sel.most_common(5)); print('  stosy:', st.most_common(5))
  prev=u['ts']+u.get('dur',0)
