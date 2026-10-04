#!/usr/bin/env bash
# P0.5: kampania 2 - więcej przebiegów bazy i wskazówek kompilacji (przeplot), pod .lh-lock.
S=/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad
P=$S/phase2/p05; W0=/home/user/neweustrategies-dc633fb5; OUT=$P/art2
g() { node $P/gather.mjs --out $OUT "$@" 2>&1 | grep -v "^$"; }
for r in 6 7 8 9; do
  while [ -d $S/.build-lock ]; do sleep 20; done
  echo "## runda $r $(date -u +%T) load=$(cut -d' ' -f1 /proc/loadavg)"
  g --root $W0 --label w0q --runs 1 --index-from $r
  g --root $P/exp-hints --label hints --runs 1 --index-from $r
  [ $r -le 7 ] && g --root $W0 --label nofade --runs 1 --index-from $r --transform $P/tx/nofade.mjs --forms mobile
done
echo "## koniec $(date -u +%T)"
