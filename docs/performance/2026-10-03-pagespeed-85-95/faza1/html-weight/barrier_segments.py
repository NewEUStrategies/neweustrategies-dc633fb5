import re,sys,gzip,json
b=open(sys.argv[1],encoding='utf8').read()
bb=lambda s: len(s.encode())
gz=lambda s: len(gzip.compress(s.encode(),9))
marks=[(m.start(),'query') for m in re.finditer(r'\$R\[\d+\]=\{dehydratedAt:',b)]
keys=[]
for st,_ in marks:
  seg=b[st:]
  m=re.search(r'queryHash:"((?:[^"\\]|\\.)*)"',seg)
  keys.append(m.group(1)[:90] if m else '?')
pre_marks=[('head(manifest/matches)',0)]
i_loader=b.find('l:$R[15]=')
i_dd=b.find('dehydratedData:')
segs=[('manifest+root match',0,i_loader),('loader / page match (seoSettings,homePage,coverPreload)',i_loader,i_dd)]
starts=[s for s,_ in marks]
segs.append(('dehydratedData head',i_dd,starts[0]))
for k,(s,key) in enumerate(zip(starts,keys)):
  e=starts[k+1] if k+1<len(starts) else len(b)
  segs.append((key,s,e))
tot=bb(b); print('total',tot,'gzip',gz(b))
for name,s,e in segs:
  t=b[s:e]; print(f'{bb(t):7d} {gz(t):6d}  {name}')
