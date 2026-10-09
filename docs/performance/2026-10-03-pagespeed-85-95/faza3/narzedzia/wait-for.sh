#!/usr/bin/env bash
# Czeka do 9 min na plik (np. <log>.exit). Kod 124 = nadal trwa (wywołaj ponownie).
f="$1"; limit="${2:-540}"; t=0
while [ ! -s "$f" ]; do
  sleep 10; t=$((t+10))
  if [ "$t" -ge "$limit" ]; then
    echo "still waiting for $f; mutex: $(cat "$(dirname "$0")/.heavy-lock/what" 2>/dev/null || echo free)"; exit 124
  fi
done
echo "exit=$(cat "$f")"
