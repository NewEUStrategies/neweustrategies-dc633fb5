#!/usr/bin/env bash
# Stawia lokalny PostgreSQL, tworzy atrape platformy (harness.sql), aplikuje
# PRAWDZIWA migracje izolacji tenantow z supabase/migrations i wykonuje asercje
# runtime RLS dla media_mentions / saved_searches / user_follows.
#
# Patrz scripts/tenant-isolation-harness/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PGDIR="${TENANT_HARNESS_DIR:-/tmp/nes-tenant-pg}"
KEEP=0
for arg in "$@"; do
  case "$arg" in --keep) KEEP=1 ;; esac
done

PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
# Fallback: initdb juz na PATH (obrazy bez /usr/lib/postgresql, lokalny sandbox).
if [ -z "$PGBIN" ] && command -v initdb >/dev/null 2>&1; then
  PGBIN="$(dirname "$(command -v initdb)")"
fi
if [ -z "$PGBIN" ]; then echo "Brak PostgreSQL. Zainstaluj postgresql-16." >&2; exit 2; fi
export PATH="$PGBIN:$PATH"

# initdb odmawia pracy jako root - potrzebny konto nieuprzywilejowane.
RUNAS="$(id -un)"
if [ "$RUNAS" = "root" ]; then
  if id -un postgres >/dev/null 2>&1; then
    RUNAS=postgres
  elif command -v useradd >/dev/null 2>&1; then
    useradd -m -s /bin/bash postgres
    RUNAS=postgres
  else
    RUNAS="$(awk -F: '$3>=1000 && $1!="nobody" {print $1; exit}' /etc/passwd)"
    [ -n "$RUNAS" ] || { echo "Brak konta nie-root do uruchomienia initdb." >&2; exit 2; }
  fi
fi

pg_ctl -D "$PGDIR/data" stop >/dev/null 2>&1 || true
rm -rf "$PGDIR"; mkdir -p "$PGDIR/data" "$PGDIR/run"
RUNAS_UID="$(id -u "$RUNAS")"
RUNAS_GID="$(id -g "$RUNAS")"
[ "$(id -un)" = "root" ] && chown -R "$RUNAS_UID:$RUNAS_GID" "$PGDIR"

run_as() {
  if [ "$(id -un)" != "root" ]; then eval "$*"; return; fi
  # `su`/`runuser` wymagaja PAM, ktorego czesc obrazow nie ma - `setpriv`
  # przelacza uid/gid bez niego i jest dostepny w util-linux.
  if command -v su >/dev/null 2>&1; then
    su "$RUNAS" -c "PATH=$PGBIN:\$PATH $*"
  else
    setpriv --reuid="$RUNAS_UID" --regid="$RUNAS_GID" --clear-groups \
      env PATH="$PGBIN:$PATH" HOME="$PGDIR" bash -c "$*"
  fi
}

run_as "initdb -D $PGDIR/data -U postgres --auth=trust -E UTF8 --locale=C" >/dev/null
run_as "pg_ctl -D $PGDIR/data -o '-k $PGDIR/run -p 5434 -c listen_addresses=\"\"' -l $PGDIR/pg.log start" >/dev/null
sleep 2

export PGHOST="$PGDIR/run" PGPORT=5434 PGUSER=postgres
cleanup() { [ "$KEEP" -eq 1 ] || run_as "pg_ctl -D $PGDIR/data stop" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -q -d postgres -c "CREATE DATABASE nes;" >/dev/null
psql -q -d nes -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SQL

psql -q -d nes -v ON_ERROR_STOP=1 -f "$HERE/harness.sql" >/dev/null
echo "harness: OK"

# Migracja izolacji tenantow - dobierana po TRESCI, nie po nazwie pliku (panel
# nadaje migracjom losowe UUID-y). Pusty zestaw to blad, nie sukces.
MIGRATIONS="$(grep -lE 'POLICY "(media_mentions owner|saved_searches owner|follows owner)' \
  "$REPO"/supabase/migrations/*.sql | sort -u)"
count="$(echo "$MIGRATIONS" | grep -c . || true)"
echo "Migracje dotykajace plaszczyzny wlasciciela: $count"
[ "$count" -gt 0 ] || { echo "Zero migracji w zestawie - selektor nie trafil."; exit 1; }

for f in $MIGRATIONS; do
  name="$(basename "$f")"
  # Aplikujemy WYLACZNIE instrukcje polityk/defaultow - pliki zalozycielskie
  # niosa tez CREATE TABLE calych modulow, ktorych atrapa nie ma.
  if out="$(psql -q -d nes -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    printf '  OK   %s\n' "$name"
  else
    printf '  SKIP %s (poza zakresem atrapy)\n' "$name"
  fi
done

echo
set +e
psql -d nes -q -f "$HERE/runtime_test.sql" > "$PGDIR/runtime.out" 2>&1
rc=$?
set -e
sed 's/psql:[^ ]* //;s/NOTICE:  //' "$PGDIR/runtime.out" \
  | grep -E "^==|  ok |ERROR|ASERCJA" || true

passed="$(grep -cE 'NOTICE: +ok +' "$PGDIR/runtime.out" || true)"
echo
if [ "$rc" -ne 0 ]; then
  echo "Testy RLS NIE przeszly (asercji zdanych przed bledem: $passed)."
  [ "$KEEP" -eq 1 ] && echo "Baza zostaje: PGHOST=$PGDIR/run PGPORT=5434 psql -d nes"
  exit 1
fi
[ "$passed" -gt 0 ] || { echo "Zero asercji - test nic nie sprawdzil."; exit 1; }
echo "Testy RLS OK ($passed asercji)."
exit 0
