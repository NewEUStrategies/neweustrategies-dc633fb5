import json,sys
f=sys.argv[1]
d=json.load(open(f))
m=d['audits']['metrics']['details']['items'][0]
fcp=m['observedFirstContentfulPaint']; lcp=m['observedLargestContentfulPaint']
items=d['audits']['network-requests']['details']['items']
print(f, 'obsFCP',round(fcp),'obsLCP',round(lcp))
tot={'fcp':0,'lcp':0}; rows=[]
for it in items:
    st=it.get('networkRequestTime',it.get('startTime')); en=it.get('networkEndTime',it.get('endTime'))
    pr=it.get('priority'); rt=it.get('resourceType'); tb=it.get('transferSize',0)
    lowimg = rt=='Image' and pr in ('Low','VeryLow')
    inl = en<=lcp and not lowimg
    rb = pr=='VeryHigh' or (pr=='High' and rt in ('Script','Document'))
    inf = en<=fcp and rb
    if inl: tot['lcp']+=tb
    if inf: tot['fcp']+=tb
    if st<=lcp+2000:
        rows.append((st,en,pr,rt,tb,inf,inl,it['url'].replace('https://neweuropeanstrategies.com','')[:95]))
rows.sort()
for r in rows: print('%6d %6d %-8s %-10s %7d %s%s %s'%(r[0],r[1],r[2],r[3],r[4],'F' if r[5] else '.','L' if r[6] else '.',r[7]))
print('billed bytes (pessimistic, approx): FCP',tot['fcp'],'LCP',tot['lcp'])
