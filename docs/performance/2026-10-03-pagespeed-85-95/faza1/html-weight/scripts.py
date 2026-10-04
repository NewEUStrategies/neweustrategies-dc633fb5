import re,sys,gzip
h=open(sys.argv[1],encoding='utf8').read()
gz=lambda s: len(gzip.compress(s.encode(),9))
print('doc',len(h.encode()),'gz',gz(h))
for m in re.finditer(r'<script\b([^>]*)>(.*?)</script>',h,re.S):
  a,body=m.group(1),m.group(2)
  print(f'{m.start():7d} {len(body.encode()):7d} gz{gz(body):6d} attrs={a[:80]!r} body={body[:110]!r}')
