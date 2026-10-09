#!/usr/bin/env bash
# Krok ciężki w tle przez mutex. Użycie: heavy-bg.sh <log> <polecenie...>
# Wraca od razu; kod wyjścia trafia do <log>.exit (sprawdzaj wait-for.sh <log>.exit).
S="$(cd "$(dirname "$0")" && pwd)"
log="$1"; shift
mkdir -p "$(dirname "$log")"
rm -f "$log.exit"
setsid nohup bash -c '"$0" "$@" > "'"$log"'" 2>&1; echo $? > "'"$log"'.exit"' "$S/heavy.sh" "$@" < /dev/null > /dev/null 2>&1 &
echo "started pid=$! log=$log (exit code -> $log.exit)"
