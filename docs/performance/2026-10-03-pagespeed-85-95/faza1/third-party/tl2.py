import json,sys
d=json.load(open(sys.argv[1]));a=d['audits']
print('==',sys.argv[1].split('/')[-1])
print('third-parties-insight:', json.dumps(a['third-parties-insight'].get('details'),indent=None)[:3000])
print('user-timings:', json.dumps(a['user-timings'])[:800])
# network: non-first-party and interesting first-party
reqs=a['network-requests']['details']['items']
print('n reqs',len(reqs))
def show(r):
    print(f"  {r.get('networkRequestTime',0):8.0f}->{r.get('networkEndTime',0):8.0f} {r.get('priority','')[:8]:8s} {r.get('resourceType',''):10s} tx={r.get('transferSize',0):7d} rs={r.get('resourceSize',0):7d} {r['url'][:130]}")
pat=['google','flock','~','supabase','realtime','sw.js','manifest','gtag','analytics','vitals','beacon','collect','sonner','Consent','IconPack','icons-','Auth','Toaster','radix','lucide','popup','Popup']
for r in sorted(reqs,key=lambda r:r.get('networkRequestTime',0)):
    if any(p in r['url'] for p in pat) or r.get('resourceType') in ('Fetch','XHR','Preflight','Other','WebSocket','Ping'):
        show(r)
print('-- main-thread-tasks (observed, >=30ms or after load)')
load=a['metrics']['details']['items'][0]['observedLoad']
for t in a['main-thread-tasks']['details']['items']:
    if t['duration']>=30 or t['startTime']>load:
        if t['duration']>=8: print(f"  start={t['startTime']:8.1f} dur={t['duration']:6.1f}")
