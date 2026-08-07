#!/usr/bin/env bash
# Stawia lokalny PostgreSQL, wykonuje harness + migracje modulu + testy runtime.
# Patrz scripts/pg-harness/README.md - po co to istnieje i czego NIE sprawdza.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PGDIR="${PG_HARNESS_DIR:-/tmp/nespg}"
PREFIX="${1:-}"
KEEP=0
VECTOR_STUB=1
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --only) shift; PREFIX="${1:-}" ;;
    --no-vector-stub) VECTOR_STUB=0 ;;
  esac
done
[ "${PREFIX:-}" = "--keep" ] && PREFIX=""

PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
if [ -z "$PGBIN" ]; then echo "Brak PostgreSQL. Zainstaluj postgresql-16." >&2; exit 2; fi
export PATH="$PGBIN:$PATH"

# initdb odmawia pracy jako root - potrzebny osobny uzytkownik.
RUNAS="$(id -un)"
if [ "$RUNAS" = "root" ]; then
  id -un postgres >/dev/null 2>&1 || useradd -m -s /bin/bash postgres
  RUNAS=postgres
fi

pg_ctl -D "$PGDIR/data" stop >/dev/null 2>&1 || true
rm -rf "$PGDIR"; mkdir -p "$PGDIR/data" "$PGDIR/run"
[ "$(id -un)" = "root" ] && chown -R "$RUNAS" "$PGDIR"

run_as() { if [ "$(id -un)" = "root" ]; then su "$RUNAS" -c "PATH=$PGBIN:\$PATH $*"; else eval "$*"; fi; }
run_as "initdb -D $PGDIR/data -U postgres --auth=trust -E UTF8 --locale=C" >/dev/null
run_as "pg_ctl -D $PGDIR/data -o '-k $PGDIR/run -p 5433 -c listen_addresses=\"\"' -l $PGDIR/pg.log start" >/dev/null
sleep 2

export PGHOST="$PGDIR/run" PGPORT=5433 PGUSER=postgres
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

if [ "$VECTOR_STUB" -eq 1 ] && ! psql -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" -d nes | grep -q 1; then
  psql -q -d nes -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DROP DOMAIN IF EXISTS extensions.vector CASCADE;
CREATE DOMAIN extensions.vector AS double precision[];
CREATE OR REPLACE FUNCTION extensions.vec_dist(a extensions.vector, b extensions.vector)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $f$ SELECT 0.0::double precision $f$;
CREATE OPERATOR extensions.<=> (LEFTARG=extensions.vector, RIGHTARG=extensions.vector, FUNCTION=extensions.vec_dist);
SQL
  echo "pgvector niedostepny - uzyto atrapy typu (wyniki semantyczne NIE sa miarodajne)"
  STUB=1
else
  STUB=0
fi

fail=0
for f in "$REPO"/supabase/migrations/*discussion_clubs*.sql; do
  name="$(basename "$f")"
  [ -n "$PREFIX" ] && case "$name" in "$PREFIX"*) ;; *) continue ;; esac
  src="$f"
  if [ "$STUB" -eq 1 ]; then
    src="$PGDIR/$(basename "$f")"
    sed -e 's/extensions\.vector(768)/extensions.vector/g' \
        -e 's/USING hnsw (embedding extensions.vector_cosine_ops)/(thread_id)/' "$f" > "$src"
  fi
  if out="$(psql -q -d nes -v ON_ERROR_STOP=1 -f "$src" 2>&1)"; then
    printf '  OK   %s\n' "$name"
  else
    printf '  FAIL %s\n' "$name"
    echo "$out" | grep -E "ERROR|LINE [0-9]|DETAIL|HINT" | head -6 | sed 's/^/       /'
    fail=1
  fi
done
[ "$fail" -eq 0 ] || { echo "Migracje nie przeszly."; exit 1; }

echo
psql -d nes -q -f "$HERE/runtime_test.sql" 2>&1 | sed 's/psql:[^ ]* //;s/NOTICE:  //' | grep -E "^==|  ok |ERROR|ASERCJA|====" || true
psql -d nes -q -f /dev/null >/dev/null 2>&1
echo
[ "$KEEP" -eq 1 ] && echo "Baza zostaje: PGHOST=$PGDIR/run PGPORT=5433 psql -d nes"
