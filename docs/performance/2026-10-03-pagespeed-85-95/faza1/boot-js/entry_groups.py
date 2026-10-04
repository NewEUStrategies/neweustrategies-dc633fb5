import json,sys,collections,os
R='/private/tmp/claude-501/-Users-igormiasnikow-Documents-GitHub-neweustrategies-dc633fb5/4193afc7-12e8-408f-90bd-72423fed6163/scratchpad/perf-main/'
d=json.load(open(R+'reports/chunk-inventory.json'))
name=sys.argv[1] if len(sys.argv)>1 else 'index-Dmm1yFni'
c=[c for c in d['chunks'] if name in c['file']][0]
mods=[(m['id'].replace(R,''),m['bytes']) for m in c['modules']]
print(c['file'], 'modules',len(mods),'bytes',sum(b for _,b in mods))
print('imports',c['imports'])
print('n dyn',len(c['dynamicImports']))
g=collections.Counter()
for m,b in mods:
    p=m.split('/')
    if p[0]=='node_modules':
        k='/'.join(p[:3]) if p[1].startswith('@') else '/'.join(p[:2])
    elif p[0]=='src':
        k='/'.join(p[:3]) if len(p)>3 else '/'.join(p[:2])
    else: k=p[0]
    g[k]+=b
for k,v in g.most_common(80): print(f'{v/1000:8.1f} {k}')
json.dump(mods,open(os.path.dirname(__file__)+'/entry-mods.json','w'))
