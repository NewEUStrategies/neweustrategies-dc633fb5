# Zrzut zdarzeń głównego wątku w oknie [a,b] ms od navigationStart (nazwy filtrowane), ze stosami.
import json,sys
d,a,b=sys.argv[1],float(sys.argv[2]),float(sys.argv[3])
names=set(sys.argv[4].split(',')) if len(sys.argv)>4 else None
tr=json.load(open(d+'/trace.json')); ev=tr['traceEvents'] if isinstance(tr,dict) else tr
nav=next(e for e in ev if e.get('name')=='navigationStart' and e.get('args',{}).get('data',{}).get('isLoadingMainFrame'))
t0,pid,tid=nav['ts'],nav['pid'],nav['tid']
def fr(f): return f"{f.get('functionName') or '(anon)'}@{(f.get('url') or '').split('/')[-1][:28]}:{f.get('lineNumber')}:{f.get('columnNumber')}"
for e in sorted([e for e in ev if e.get('pid')==pid and e.get('tid')==tid and t0+a*1000<=e.get('ts',0)<=t0+b*1000],key=lambda e:e['ts']):
  if names and e['name'] not in names: continue
  ar=e.get('args',{}); bd=ar.get('beginData') or ar.get('data') or {}
  st=bd.get('stackTrace') or []
  extra={k:v for k,v in (bd.items() if isinstance(bd,dict) else []) if k in ('dirtyObjects','totalObjects','elementCount','partialLayout','url','functionName','lineNumber','columnNumber','startLine','type','reason','nodeName','changedClass','changedAttribute','changedPseudo','selectors','invalidationSet','invalidatedSelectorId','extraData','name','message','track','start','end')}
  ed=ar.get('endData') or {}
  if 'elementCount' in ar: extra['elementCount']=ar['elementCount']
  if ed: extra.update({('end.'+k):v for k,v in ed.items() if k in ('endLine','elementCount')})
  print(f"{(e['ts']-t0)/1000:9.2f} {e.get('dur',0)/1000:7.2f} {e['ph']} {e['name'][:40]:40s} {json.dumps(extra,ensure_ascii=False)[:200]} {' < '.join(fr(f) for f in st[:5])}")
