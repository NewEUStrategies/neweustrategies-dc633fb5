#!/usr/bin/env bash
# P0.5: kampania zbierania artefaktów LH (pod .lh-lock, bez .build-lock), przeplot konfiguracji w rundach.
S=/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad
P=$S/phase2/p05; W0=/home/user/neweustrategies-dc633fb5; OUT=$P/art2
mkdir -p $OUT
g() { node $P/gather.mjs --out $OUT "$@" 2>&1 | grep -v "^$"; }
for r in 1 2 3 4 5; do
  while [ -d $S/.build-lock ]; do sleep 20; done
  echo "## runda $r $(date -u +%T) load=$(cut -d' ' -f1 /proc/loadavg)"
  g --root $W0 --label w0q --runs 1 --index-from $r
  if [ $r -le 3 ]; then
    g --root $W0 --label noanim --runs 1 --index-from $r --transform $P/tx/noanim.mjs
    g --root $W0 --label nofade --runs 1 --index-from $r --transform $P/tx/nofade.mjs --forms mobile
    g --root $P/exp-hints --label hints --runs 1 --index-from $r
  fi
done
while [ -d $S/.build-lock ]; do sleep 20; done
echo "## profiler $(date -u +%T)"
g --root $W0 --label w0p --runs 3 --forms mobile --profiler
g --root $W0 --label w0p --runs 2 --forms desktop --profiler
echo "## invalidation $(date -u +%T)"
g --root $W0 --label w0i --runs 2 --forms mobile --cats disabled-by-default-devtools.timeline.invalidationTracking
g --root $W0 --label w0i --runs 1 --forms desktop --cats disabled-by-default-devtools.timeline.invalidationTracking
echo "## profilujący React $(date -u +%T)"
g --root $P/build-prof --label prof --runs 2 --forms mobile --profiler
g --root $P/build-prof --label prof --runs 1 --forms desktop --profiler
echo "## warstwy $(date -u +%T)"
node $P/layers.mjs --root $W0 --form mobile --out $OUT/layers-mobile.json > $OUT/layers-mobile.txt 2>&1
node $P/layers.mjs --root $W0 --form desktop --out $OUT/layers-desktop.json > $OUT/layers-desktop.txt 2>&1
echo "## koniec $(date -u +%T)"
