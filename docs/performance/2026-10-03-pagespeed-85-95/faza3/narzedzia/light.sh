#!/usr/bin/env bash
# Kroki lekkie zauważalne dla CPU (vitest plików, eslint, verify:static): poza mutexem,
# ale czekają, dopóki mutex trzyma pomiar (Lighthouse/Playwright/e2e). Kod 75 = pomiar nadal trwa.
S="$(cd "$(dirname "$0")" && pwd)"
LOCK="$S/.heavy-lock"; t=0
is_measure() { grep -qiE 'lighthouse|playwright|e2e|test:e2e|run-first-visit' "$LOCK/what" 2>/dev/null; }
while [ -d "$LOCK" ] && is_measure; do
  pid=$(cat "$LOCK/pid" 2>/dev/null)
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then break; fi
  sleep 15; t=$((t+15))
  if [ "$t" -ge 480 ]; then echo "measurement still running: $(cat "$LOCK/what")"; exit 75; fi
done
exec "$@"
