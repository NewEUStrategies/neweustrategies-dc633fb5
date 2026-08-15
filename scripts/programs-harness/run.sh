#!/usr/bin/env bash
# Stawia lokalny PostgreSQL, odtwarza stan SPRZED scalenia tabel programów,
# wykonuje migracje scalajace (20260815110437 + 110844 + 111026) i sprawdza SKUTKI na danych.
#
# UWAGA HISTORYCZNA: harness powstal dla jednej recznej migracji
# 20260815100000_programs_single_table.sql, ktora zostala ZASTAPIONA lancuchem
# trzech migracji i usunieta z repo (commit 207fdd9). Harness zostal wtedy
# wskazujacy na nieistniejacy plik, wiec `check:programs-harness` byl czerwony,
# mimo ze samo scalenie w schemacie ZASZLO. Przepiety na faktyczne migracje.
#
# Po co: bramki `check:sql-*` czytają migracje jako TEKST. Nie zobaczą wiersza
# zgubionego przy scaleniu, klucza obcego wskazującego w próżnię ani polityki,
# która po zmianie kształtu tabeli przestała cokolwiek filtrować. Migracja
# scalająca dwie tabele z czterema tabelami-dziećmi to dokładnie ta klasa
# zmiany, w której „przeszło CI" nie znaczy „działa".
#
# Wzorzec (harness modułu + asercje runtime) przejęty z `scripts/pg-harness`
# i `scripts/careers-harness`.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PGDIR="${PROGRAMS_HARNESS_DIR:-/tmp/nespg-programs}"
MIGRATION_STATUS="$REPO/supabase/migrations/20260815110437_63bd9623-2115-49ac-b773-c394dc8e5759.sql"
MIGRATION="$REPO/supabase/migrations/20260815110844_54c27fbd-795e-4ad4-b4a4-e2ccc05135cc.sql"
MIGRATION_ANCHOR="$REPO/supabase/migrations/20260815111026_c9b91031-faf0-4283-9d84-50bbfc60f34c.sql"
KEEP=0
for arg in "$@"; do case "$arg" in --keep) KEEP=1 ;; esac; done

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
run_as "pg_ctl -D $PGDIR/data -o '-k $PGDIR/run -p 5435 -c listen_addresses=\"\"' -l $PGDIR/pg.log start" >/dev/null
sleep 2

export PGHOST="$PGDIR/run" PGPORT=5435 PGUSER=postgres
cleanup() { [ "$KEEP" -eq 1 ] || run_as "pg_ctl -D $PGDIR/data stop" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -q -d postgres -c "CREATE DATABASE nes;" >/dev/null

psql -q -d nes -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SQL

step() {
  local label="$1" file="$2"
  if out="$(psql -q -d nes -v ON_ERROR_STOP=1 -f "$file" 2>&1)"; then
    printf '  OK   %s\n' "$label"
    echo "$out" | grep -E "NOTICE" | sed 's/^/       /' || true
  else
    printf '  FAIL %s\n' "$label"
    echo "$out" | grep -E "ERROR|LINE [0-9]|DETAIL|HINT|ASSERT" | head -8 | sed 's/^/       /'
    exit 1
  fi
}

step "harness (stan sprzed scalenia)" "$HERE/harness.sql"
step "seed (kolizja + tylko slownik + tylko hub + drugi najemca)" "$HERE/seed.sql"
step "migracja 20260815110437 (kolumna status)" "$MIGRATION_STATUS"
step "migracja 20260815110844 (scalenie)" "$MIGRATION"
step "migracja 20260815111026 (etykieta kotwicy)" "$MIGRATION_ANCHOR"
step "asercje runtime" "$HERE/runtime_test.sql"

echo
echo "programs-harness: OK"
