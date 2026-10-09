#!/usr/bin/env bash
# Mutex maszyny dla kroków ciężkich (typecheck, build, Lighthouse, Playwright).
# Użycie: heavy.sh <polecenie...>   (czeka na blokadę, wykonuje, zwalnia; kod wyjścia polecenia)
S="$(cd "$(dirname "$0")" && pwd)"
LOCK="$S/.heavy-lock"
desc="$*"
while ! mkdir "$LOCK" 2>/dev/null; do
  pid=$(cat "$LOCK/pid" 2>/dev/null)
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    echo "[heavy] usuwam przeterminowaną blokadę po PID $pid ($(cat "$LOCK/what" 2>/dev/null))" >&2
    rm -rf "$LOCK"; continue
  fi
  if [ -z "$pid" ] && [ -d "$LOCK" ]; then
    # blokada bez pid starsza niż 60 s = osierocona
    age=$(( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || date +%s) ))
    if [ "$age" -gt 60 ]; then rm -rf "$LOCK"; continue; fi
  fi
  sleep 15
done
echo $$ > "$LOCK/pid"
printf '%s | %s | %s\n' "$(date -u +%H:%M:%S)" "$PWD" "$desc" > "$LOCK/what"
trap 'rm -rf "$LOCK"' EXIT INT TERM HUP
"$@"
