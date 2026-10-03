#!/usr/bin/env bash
# Lokalny pomiar Lighthouse artefaktu smoke (.output) w worktree - wersja dla sandboxa chmurowego.
# Backend: fixture first-visit (scripts/performance/replayFetch.mjs) - sandbox nie ma egressu do Supabase/CDN.
#
# Użycie: measure-local.sh <worktree-dir> <label> [runs=3] [url-path=/]
# Wynik: $SCRATCH/lh/results/<label>-{mobile,desktop}-N.json + .summary.txt + linie MEDIAN.
# Wymaga: zbudowanego .output w <worktree-dir>.
set -euo pipefail
WT="${1:?worktree dir}"; LABEL="${2:?label}"; RUNS="${3:-3}"; URLPATH="${4:-/}"
SCRATCH="/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad"
LH="$SCRATCH/tools/node_modules/lighthouse/cli/index.js"
OUT="$SCRATCH/lh/results"; mkdir -p "$OUT"
export CHROME_PATH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
# Porty: hash etykiety, żeby równoległe pomiary różnych worktree nie kolidowały.
H=$(printf '%s' "$LABEL" | cksum | cut -d' ' -f1); UP=$((4300 + H % 300)); PX=$((UP + 1))

cd "$WT"
export PORT=$UP HOST=127.0.0.1 NITRO_PORT=$UP NITRO_HOST=127.0.0.1
export SUPABASE_URL="http://127.0.0.1:4199" SUPABASE_PUBLISHABLE_KEY="performance-fixture" SUPABASE_SERVICE_ROLE_KEY="performance-fixture-admin"
export NES_PERFORMANCE_CASE="${NES_PERFORMANCE_CASE:-lighthouse-local}"
node --import "$WT/scripts/performance/replayFetch.mjs" .output/server/index.mjs > "$OUT/$LABEL-server.log" 2>&1 &
SRV=$!
node "$SCRATCH/lh/br-proxy.mjs" "$PX" "$UP" > "$OUT/$LABEL-proxy.log" 2>&1 &
PRX=$!
trap 'kill $SRV $PRX 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$UP$URLPATH" && break; sleep 1; done
# rozgrzanie cache dokumentu (HIT) jak w stanie ustalonym produkcji
UA="Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36"
curl -s -o /dev/null -A "$UA" "http://127.0.0.1:$PX$URLPATH"; sleep 1
curl -s -o /dev/null -A "$UA" "http://127.0.0.1:$PX$URLPATH"
curl -s -D - -o "$OUT/$LABEL-home.html" -A "$UA" -H 'Accept-Encoding: identity' "http://127.0.0.1:$PX$URLPATH" | grep -i "x-nes-cache\|server-timing\|content-length" > "$OUT/$LABEL-home.headers.txt" || true
echo "server pid $SRV port $UP, proxy pid $PRX port $PX; HTML raw $(wc -c < "$OUT/$LABEL-home.html") B, gzip $(gzip -6 -c "$OUT/$LABEL-home.html" | wc -c) B"
for form in mobile desktop; do
  for n in $(seq 1 "$RUNS"); do
    extra=""; [ "$form" = desktop ] && extra="--preset=desktop"
    node "$LH" "http://127.0.0.1:$PX$URLPATH" --output=json --output-path="$OUT/$LABEL-$form-$n.json" \
      --only-categories=performance --quiet $extra \
      --chrome-flags="--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage" >/dev/null 2>&1 || echo "run $form $n failed"
    python3 - "$OUT/$LABEL-$form-$n.json" <<'EOF'
import json,sys
d=json.load(open(sys.argv[1]));a=d['audits']
g=lambda k:a[k]['numericValue']
print(f"  {sys.argv[1].split('/')[-1]:40s} perf={round(d['categories']['performance']['score']*100):3d} FCP={g('first-contentful-paint')/1000:.2f}s LCP={g('largest-contentful-paint')/1000:.2f}s TBT={g('total-blocking-time'):.0f}ms SI={g('speed-index')/1000:.2f}s CLS={g('cumulative-layout-shift'):.3f} TTFB={g('server-response-time'):.0f}ms")
EOF
  done
done
python3 - "$OUT" "$LABEL" <<'EOF'
import json,sys,glob,statistics as st
out,label=sys.argv[1],sys.argv[2]
for form in ['mobile','desktop']:
    files=sorted(glob.glob(f"{out}/{label}-{form}-*.json"))
    rows=[]
    for f in files:
        d=json.load(open(f));a=d['audits']
        rows.append((d['categories']['performance']['score']*100,a['first-contentful-paint']['numericValue'],a['largest-contentful-paint']['numericValue'],a['total-blocking-time']['numericValue'],a['speed-index']['numericValue']))
    if not rows: continue
    med=lambda i: st.median(r[i] for r in rows)
    print(f"MEDIAN {label} {form}: perf={med(0):.0f} FCP={med(1)/1000:.2f}s LCP={med(2)/1000:.2f}s TBT={med(3):.0f}ms SI={med(4)/1000:.2f}s (n={len(rows)})")
EOF
python3 "$SCRATCH/lh/lh-summary.py" "$OUT/$LABEL-mobile-1.json" --top 40 > "$OUT/$LABEL-mobile-1.summary.txt" 2>&1 || true
python3 "$SCRATCH/lh/lh-summary.py" "$OUT/$LABEL-desktop-1.json" --top 40 > "$OUT/$LABEL-desktop-1.summary.txt" 2>&1 || true
echo "summaries: $OUT/$LABEL-{mobile,desktop}-1.summary.txt"
