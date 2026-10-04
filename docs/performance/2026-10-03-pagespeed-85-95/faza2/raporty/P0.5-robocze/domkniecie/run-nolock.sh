#!/usr/bin/env bash
# P0.5 (domknięcie): what-if fal BEZ mutexu (audyty Lantern na zapisanych artefaktach są deterministyczne i nie
# zależą od obciążenia - korekta zasady orkiestratora 2026-10-04 ok. 13:00), z nice -n 10, kroki po kolei.
# Użycie: run-nolock.sh <log> "desktop half W2" "desktop full W2" ...
W=/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/w0fix/P0.5
LOG=$1; shift
for spec in "$@"; do
  echo "=== $spec start $(date -u +%T) load $(cut -d" " -f1-3 /proc/loadavg)" >> $LOG
  nice -n 10 python3 $W/wave.py $spec > /dev/null 2>> $W/batch.err
  echo "=== $spec koniec $(date -u +%T) kod $?" >> $LOG
done
