# Porównanie dwóch buildów po normalizacji hashy w nazwach plików (kod identyczny => mapy A pasują do B).
import os,re,sys,hashlib
A,B=sys.argv[1],sys.argv[2]
rx=re.compile(r'-[A-Za-z0-9_-]{8}(\.(?:js|css|woff2|svg|png|webp|json))')
def key(n): return rx.sub(r'\1',n)
def norm(p): return rx.sub(r'\1',open(p,encoding='utf8',errors='replace').read())
fa={key(n):n for n in os.listdir(A) if n.endswith('.js')}
fb={key(n):n for n in os.listdir(B) if n.endswith('.js')}
dup=[k for k in fa if list(map(key,os.listdir(A))).count(k)>1]
same=diff=0; out=[]
for k,nb in sorted(fb.items()):
    na=fa.get(k)
    if not na: out.append(('missing',nb)); continue
    if norm(os.path.join(A,na))==norm(os.path.join(B,nb)): same+=1
    else: diff+=1; out.append(('diff',nb,na))
print('same',same,'diff',diff,'missing',sum(1 for o in out if o[0]=='missing'))
for o in out[:15]: print(o)
