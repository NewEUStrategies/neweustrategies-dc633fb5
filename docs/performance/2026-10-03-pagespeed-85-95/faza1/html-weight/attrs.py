import re,sys,gzip,collections,html as H
h=open(sys.argv[1],encoding='utf8').read()
gz=lambda s: len(gzip.compress(s.encode(),9))
# strip scripts & styles
body=re.sub(r'<script\b.*?</script>','',h,flags=re.S)
body=re.sub(r'<style\b.*?</style>','',body,flags=re.S)
print('markup w/o script/style',len(body.encode()),'gz',gz(body))
attrs=collections.Counter(); vals=collections.defaultdict(collections.Counter)
for m in re.finditer(r'\s([a-zA-Z_:][-\w:.]*)(?:="([^"]*)")?',''.join(re.findall(r'<[a-zA-Z][^>]*>',body))):
  n=m.group(1); v=m.group(2) or ''
  attrs[n]+=len(m.group(0)); vals[n][v]+=1
for n,c in attrs.most_common(25): print(f'{n:28s}{c:7d}  distinct={len(vals[n])} count={sum(vals[n].values())}')
print('--- top repeated style values')
for v,c in vals['style'].most_common(15): print(c, len(v), v[:220])
print('--- top repeated class values')
for v,c in vals['class'].most_common(15): print(c, len(v), v[:200])
st=sum(len(v)*c for v,c in vals['style'].items()); print('style bytes',st)
