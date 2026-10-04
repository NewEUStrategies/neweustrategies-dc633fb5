#!/usr/bin/env bash
# P0.5: kampania 3 - build profilujący z hakiem DevTools (ścieżka Components ⚛) + kontrola konsoli. Pod .lh-lock.
S=/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad
P=$S/phase2/p05; W0=/home/user/neweustrategies-dc633fb5; OUT=$P/art2
g() { node $P/gather.mjs --out $OUT "$@" 2>&1 | grep -v "^$"; }
while [ -d $S/.build-lock ]; do sleep 20; done
echo "## prof+hook $(date -u +%T) load=$(cut -d' ' -f1 /proc/loadavg)"
g --root $P/build-prof --label profhook --runs 2 --forms mobile --profiler --transform $P/tx/devtoolshook.mjs
g --root $P/build-prof --label profhook --runs 1 --forms desktop --profiler --transform $P/tx/devtoolshook.mjs
echo "## konsola W0 $(date -u +%T)"
timeout 180 node $P/consolecheck.mjs $W0 > $OUT/console-w0.txt 2>&1; cat $OUT/console-w0.txt | head -20
echo "## konsola build-prof $(date -u +%T)"
timeout 180 node $P/consolecheck.mjs $P/build-prof > $OUT/console-prof.txt 2>&1; cat $OUT/console-prof.txt | head -20
echo "## koniec $(date -u +%T)"
