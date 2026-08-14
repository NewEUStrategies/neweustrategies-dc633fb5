#!/usr/bin/env bash
# Stawia lokalny PostgreSQL, aplikuje migracje modulu REKRUTACJA i uruchamia
# testy runtime. Ten sam wzorzec i te same powody, co scripts/pg-harness -
# patrz jego README: bramki check:sql-* czytaja migracje jako TEKST, wiec nie
# lapia bledow, ktore ujawniaja sie dopiero przy WYKONANIU (ROW_COUNT bez GET
# DIAGNOSTICS, kolizja parametru OUT z nazwa kolumny, trigger, ktory nigdy nie
# odpala, polityka RLS przepuszczajaca obcego najemce).
#
# Uzycie:
#   bash scripts/careers-harness/run.sh          # migracje + testy
#   bash scripts/careers-harness/run.sh --keep   # zostaw baze do ogladania
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SHARED="$REPO/scripts/pg-harness"
PGDIR="${CAREERS_HARNESS_DIR:-/tmp/nescareers}"
KEEP=0
for arg in "$@"; do
  case "$arg" in --keep) KEEP=1 ;; esac
done

PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
if [ -z "$PGBIN" ]; then echo "Brak PostgreSQL. Zainstaluj postgresql-16." >&2; exit 2; fi
export PATH="$PGBIN:$PATH"

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

# Wspolna powierzchnia platformy (tenanty, role, auth.uid, storage, crm_leads).
psql -q -d nes -v ON_ERROR_STOP=1 -f "$SHARED/harness.sql" >/dev/null
# Powierzchnia specyficzna dla rekrutacji (contact_messages, kolumny bucketu).
psql -q -d nes -v ON_ERROR_STOP=1 -f "$HERE/harness.sql" >/dev/null
echo "harness: OK"

# Dobor po TRESCI, nie po nazwie pliku - migracja nazwana UUID-em przez panel
# Lovable tez musi wejsc. Sortowanie jest ISTOTNE: dokladnie w tej kolejnosci
# aplikuje pliki Supabase CLI, wiec tylko ona odtwarza realny stan koncowy.
MIGRATIONS="$(grep -lE "public\.(career_|contact_messages)|'career-cv'" \
                "$REPO"/supabase/migrations/*.sql | sort -u)"

fail=0
applied=0
for f in $MIGRATIONS; do
  name="$(basename "$f")"
  # Migracje SPRZED wprowadzenia modulu careers dotykaja powierzchni, ktorej ten
  # harness celowo nie odtwarza (redirects, polityki formularza kontaktowego,
  # newsletter). Interesuje nas modul: tabele career_* i bucket CV.
  if ! grep -qE "public\.career_|'career-cv'" "$f"; then continue; fi
  if out="$(psql -q -d nes -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    printf '  OK   %s\n' "$name"
    applied=$((applied + 1))
  else
    printf '  FAIL %s\n' "$name"
    echo "$out" | grep -E "ERROR|LINE [0-9]|DETAIL|HINT" | head -8 | sed 's/^/       /'
    fail=1
  fi
done
[ "$applied" -gt 0 ] || { echo "Zadna migracja nie zostala wybrana - selektor jest zepsuty."; exit 1; }
[ "$fail" -eq 0 ] || { echo "Migracje nie przeszly."; exit 1; }

echo
echo "== testy runtime =="
if psql -d nes -v ON_ERROR_STOP=1 -f "$HERE/runtime_test.sql" 2>&1 | grep -vE '^(SET|INSERT|UPDATE|DELETE|SELECT|CREATE|DROP|BEGIN|COMMIT|ROLLBACK|DO|RESET|ALTER)' ; then
  echo
  echo "careers-harness: OK ($applied migracji)"
else
  echo "careers-harness: testy runtime NIE przeszly."
  exit 1
fi
