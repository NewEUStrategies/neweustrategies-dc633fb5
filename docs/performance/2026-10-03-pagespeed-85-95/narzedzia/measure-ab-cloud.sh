#!/usr/bin/env bash
# Pomiar A/B z przeplotem: dwa artefakty (.output) mierzone naprzemiennie w tej samej sesji,
# żeby obciążenie maszyny (inni agenci, build) rozkładało się po równo na A i B.
# Backend: fixture first-visit (replayFetch.mjs). Bez egressu.
#
# Użycie: measure-ab.sh <worktree-A> <worktree-B> <label> [runs=3] [url-path=/]
# Wynik: $SCRATCH/lh/results/<label>-{A,B}-{mobile,desktop}-N.json + linie MEDIAN A/B + DELTA.
set -euo pipefail
WA="${1:?worktree A (baseline)}"; WB="${2:?worktree B (candidate)}"; LABEL="${3:?label}"; RUNS="${4:-3}"; URLPATH="${5:-/}"
SCRATCH="/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad"
LH="$SCRATCH/tools/node_modules/lighthouse/cli/index.js"
OUT="$SCRATCH/lh/results"; mkdir -p "$OUT"
export CHROME_PATH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
# Chrome: bez proxy sandboxa (HTTPS_PROXY blokuje hosty spoza no_proxy), obrazy fixture.invalid -> lokalny serwer HTTPS,
# Accept-Language pl jak czytelnik z Polski (bez tego Chrome en-US dostaje redirect / -> /en).
IMG_PORT=8443
CHROME_FLAGS="--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --no-proxy-server --ignore-certificate-errors --host-resolver-rules='MAP fixture.invalid 127.0.0.1:$IMG_PORT'"
ACCEPT_LANGUAGE="${ACCEPT_LANGUAGE:-pl-PL,pl;q=0.9,en;q=0.5}"
EXTRA_HEADERS="{\"Accept-Language\":\"$ACCEPT_LANGUAGE\"}"
ensure_images() {
  curl -sk -o /dev/null "https://127.0.0.1:$IMG_PORT/image.svg" && return 0
  node "$SCRATCH/lh/fixture-images.mjs" "$IMG_PORT" > "$SCRATCH/lh/fixture-images.log" 2>&1 &
  for i in $(seq 1 20); do curl -sk -o /dev/null "https://127.0.0.1:$IMG_PORT/image.svg" && return 0; sleep 0.5; done
  echo "fixture image server failed to start" >&2; return 1
}
ensure_images
H=$(printf '%s' "$LABEL" | cksum | cut -d' ' -f1); PA=$((4600 + H % 200)); PB=$((PA + 2))
export HOST=127.0.0.1 NITRO_HOST=127.0.0.1
export SUPABASE_URL="http://127.0.0.1:4199" SUPABASE_PUBLISHABLE_KEY="performance-fixture" SUPABASE_SERVICE_ROLE_KEY="performance-fixture-admin"
export NES_PERFORMANCE_CASE="${NES_PERFORMANCE_CASE:-lighthouse-local}"
UA="Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36"; AL="Accept-Language: $ACCEPT_LANGUAGE"
PIDS=()
start() { # $1=dir $2=port $3=tag
  ( cd "$1" && PORT=$2 NITRO_PORT=$2 node --import "$1/scripts/performance/replayFetch.mjs" .output/server/index.mjs > "$OUT/$LABEL-$3-server.log" 2>&1 ) &
  PIDS+=($!)
  node "$SCRATCH/lh/br-proxy.mjs" "$(($2 + 1))" "$2" > "$OUT/$LABEL-$3-proxy.log" 2>&1 &
  PIDS+=($!)
  for i in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$2$URLPATH" && break; sleep 1; done
  curl -s -o /dev/null -A "$UA" -H "$AL" "http://127.0.0.1:$(($2 + 1))$URLPATH"; sleep 1
  curl -s -o "$OUT/$LABEL-$3-home.html" -A "$UA" -H "$AL" -H 'Accept-Encoding: identity' "http://127.0.0.1:$(($2 + 1))$URLPATH"
  echo "$3: $1 port $2 (proxy $(($2 + 1))) HTML raw $(wc -c < "$OUT/$LABEL-$3-home.html") B gzip $(gzip -6 -c "$OUT/$LABEL-$3-home.html" | wc -c) B"
}
trap 'kill "${PIDS[@]}" 2>/dev/null || true' EXIT
start "$WA" "$PA" A
start "$WB" "$PB" B
one() { # $1=tag $2=port $3=form $4=n
  local extra=""; [ "$3" = desktop ] && extra="--preset=desktop"
  node "$LH" "http://127.0.0.1:$(($2 + 1))$URLPATH" --output=json --output-path="$OUT/$LABEL-$1-$3-$4.json" \
    --only-categories=performance --quiet $extra \
    --chrome-flags="$CHROME_FLAGS" --extra-headers="$EXTRA_HEADERS" >/dev/null 2>&1 || { echo "run $1 $3 $4 failed"; return 0; }
  python3 - "$OUT/$LABEL-$1-$3-$4.json" <<'EOF'
import json,sys,re
d=json.load(open(sys.argv[1]));a=d['audits']
g=lambda k:a[k]['numericValue']
url=d.get('finalDisplayedUrl','?'); path='/'+url.split('/',3)[-1] if url.count('/')>=3 else url
sel=re.findall(r'"selector": ?"([^"]+)"', json.dumps(a.get('lcp-breakdown-insight',{}).get('details',{})))
lcp=sel[0].split('>')[-1].strip() if sel else '?'
print(f"  {sys.argv[1].split('/')[-1]:44s} perf={round(d['categories']['performance']['score']*100):3d} FCP={g('first-contentful-paint')/1000:.2f}s LCP={g('largest-contentful-paint')/1000:.2f}s TBT={g('total-blocking-time'):.0f}ms SI={g('speed-index')/1000:.2f}s CLS={g('cumulative-layout-shift'):.3f} TTFB={g('server-response-time'):.0f}ms url={path} lcp={lcp}")
EOF
}
for form in mobile desktop; do
  for n in $(seq 1 "$RUNS"); do
    if [ $((n % 2)) -eq 1 ]; then one A "$PA" "$form" "$n"; one B "$PB" "$form" "$n"; else one B "$PB" "$form" "$n"; one A "$PA" "$form" "$n"; fi
  done
done
python3 - "$OUT" "$LABEL" <<'EOF'
import json,sys,glob,statistics as st
out,label=sys.argv[1],sys.argv[2]
def med(tag,form):
    rows=[]
    for f in sorted(glob.glob(f"{out}/{label}-{tag}-{form}-*.json")):
        d=json.load(open(f));a=d['audits']
        rows.append((d['categories']['performance']['score']*100,a['first-contentful-paint']['numericValue'],a['largest-contentful-paint']['numericValue'],a['total-blocking-time']['numericValue'],a['speed-index']['numericValue']))
    if not rows: return None
    return [st.median(r[i] for r in rows) for i in range(5)]+[len(rows)]
for form in ['mobile','desktop']:
    A,B=med('A',form),med('B',form)
    for tag,m in (('A',A),('B',B)):
        if m: print(f"MEDIAN {label} {tag} {form}: perf={m[0]:.0f} FCP={m[1]/1000:.2f}s LCP={m[2]/1000:.2f}s TBT={m[3]:.0f}ms SI={m[4]/1000:.2f}s (n={m[5]})")
    if A and B: print(f"DELTA  {label} B-A {form}: perf={B[0]-A[0]:+.0f} FCP={(B[1]-A[1])/1000:+.2f}s LCP={(B[2]-A[2])/1000:+.2f}s TBT={B[3]-A[3]:+.0f}ms SI={(B[4]-A[4])/1000:+.2f}s")
EOF
