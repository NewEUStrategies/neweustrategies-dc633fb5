#!/usr/bin/env bash
# P0.5 (domknięcie): what-if fal pod mutexem maszyny (audyty Lantern traktowane jak krok ciężki).
# Każda pozycja listy to osobny krok pod mutexem (mutex zwalniany między krokami).
# Użycie: batch.sh "mobile half W1" "mobile full W1" ...
L=/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/.heavy-lock
W=/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/w0fix/P0.5
for spec in "$@"; do
  until mkdir $L 2>/dev/null; do sleep 20; done
  trap 'rmdir $L 2>/dev/null' EXIT
  echo "=== $spec start $(date -u +%T) load $(cut -d' ' -f1-3 /proc/loadavg)"
  python3 $W/wave.py $spec > /dev/null 2>> $W/batch.err
  echo "=== $spec koniec $(date -u +%T)"
  rmdir $L
  trap - EXIT
done
