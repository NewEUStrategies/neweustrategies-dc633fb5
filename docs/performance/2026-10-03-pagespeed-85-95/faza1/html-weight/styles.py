import re,sys,gzip,collections
h=open(sys.argv[1],encoding='utf8').read()
gz=lambda s: len(gzip.compress(s.encode(),9))
blocks=list(re.finditer(r'<style\b([^>]*)>(.*?)</style>',h,re.S))
hs=h.find('<header'); he=h.find('</header>')+9; fs=h.find('<footer'); fe=h.find('</footer>')+9; ms=h.find('<main'); me=h.find('</main>')+7
def region(p):
  if p<h.find('</head>'): return 'head'
  if hs<=p<he: return 'header'
  if fs<=p<fe: return 'footer'
  if ms<=p<me: return 'main'
  return 'body-other'
tot=0
rows=[]
for m in blocks:
  a,b=m.group(1),m.group(2); n=len(b.encode()); tot+=n
  rows.append((m.start(),region(m.start()),n,gz(b),a.strip()[:90],b[:120].replace('\n',' ')))
print('blocks',len(blocks),'total',tot,'gz-separately',sum(r[3] for r in rows))
print('all styles concatenated gz', gz(''.join(m.group(2) for m in blocks)))
for r in rows: print(f'{r[0]:7d} {r[1]:8s} {r[2]:6d} gz{r[3]:5d} [{r[4]}] {r[5]!r}')
reg=collections.Counter()
for r in rows: reg[r[1]]+=r[2]
print(reg)
print('!important', sum(m.group(2).count('!important') for m in blocks))
