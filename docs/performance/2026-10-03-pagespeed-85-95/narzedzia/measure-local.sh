#!/usr/bin/env bash
# Local Lighthouse measurement of the smoke artifact (.output) in a worktree.
#
# Usage: measure-local.sh <worktree-dir> <label> [runs=3] [url-path=/]
# Produces: <scratch>/lh/results/<label>-{mobile,desktop}-N.json + summary .txt
# Requires: built .output in <worktree-dir>, .env in <worktree-dir>.
set -euo pipefail
WT="${1:?worktree dir}"; LABEL="${2:?label}"; RUNS="${3:-3}"; URLPATH="${4:-/}"
SCRATCH="/private/tmp/claude-501/-Users-igormiasnikow-Documents-GitHub-neweustrategies-dc633fb5/4193afc7-12e8-408f-90bd-72423fed6163/scratchpad"
LH="$SCRATCH/lh/node_modules/lighthouse/cli/index.js"
OUT="$SCRATCH/lh/results"; mkdir -p "$OUT"
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Ports: hash the label so parallel measurements of different worktrees do not collide.
H=$(printf '%s' "$LABEL" | cksum | cut -d' ' -f1); UP=$((4300 + H % 300)); PX=$((UP + 1))

cd "$WT"
set -a; . ./.env; set +a
PORT=$UP HOST=127.0.0.1 NITRO_PORT=$UP NITRO_HOST=127.0.0.1 node .output/server/index.mjs > "$OUT/$LABEL-server.log" 2>&1 &
SRV=$!
node "$SCRATCH/lh/br-proxy.mjs" "$PX" "$UP" > "$OUT/$LABEL-proxy.log" 2>&1 &
PRX=$!
trap 'kill $SRV $PRX 2>/dev/null || true' EXIT
# wait for server
for i in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$UP$URLPATH" && break; sleep 1; done
# warm the document cache (HIT) twice, like production steady state
curl -s -o /dev/null -A "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36" "http://127.0.0.1:$PX$URLPATH"
sleep 1
curl -s -o /dev/null -A "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36" "http://127.0.0.1:$PX$URLPATH"
echo "server pid $SRV port $UP, proxy pid $PRX port $PX"
for form in mobile desktop; do
  for n in $(seq 1 "$RUNS"); do
    extra=""; [ "$form" = desktop ] && extra="--preset=desktop"
    node "$LH" "http://127.0.0.1:$PX$URLPATH" --output=json --output-path="$OUT/$LABEL-$form-$n.json" \
      --only-categories=performance --quiet $extra \
      --chrome-flags="--headless=new --no-sandbox --disable-gpu" >/dev/null 2>&1 || echo "run $form $n failed"
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
