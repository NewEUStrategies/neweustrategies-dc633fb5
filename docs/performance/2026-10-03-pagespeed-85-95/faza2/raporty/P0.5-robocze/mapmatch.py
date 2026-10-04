# Dopasowanie plików W0 (B) do buildu z mapami (A) po treści znormalizowanej z hashy nazw.
# Wynik: JSON {plikW0: plikA} dla plików o identycznym kodzie -> mapa A/<plik>.map stosuje się do śladów W0.
import os,re,sys,json,hashlib
A,B,out=sys.argv[1],sys.argv[2],sys.argv[3]
rx=re.compile(r'-[A-Za-z0-9_-]{8}(\.(?:js|css|woff2|svg|png|webp|json))')
def h(p): return hashlib.sha1(rx.sub(r'\1',open(p,encoding='utf8',errors='replace').read()).encode()).hexdigest()
ha={}
for n in os.listdir(A):
    if n.endswith('.js'): ha.setdefault(h(os.path.join(A,n)),[]).append(n)
m={}; miss=[]
for n in os.listdir(B):
    if not n.endswith('.js'): continue
    c=ha.get(h(os.path.join(B,n)))
    if c: m[n]=c[0]
    else: miss.append(n)
json.dump(m,open(out,'w'),indent=0)
print('matched',len(m),'unmatched',len(miss)); print(miss[:30])
