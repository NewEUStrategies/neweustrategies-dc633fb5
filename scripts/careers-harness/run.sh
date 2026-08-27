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

# TOLERANCJA, WIDOCZNA W LOGU I POLICZONA W PODSUMOWANIU.
#
# Czesc tabel w `harness.sql` stoi tam WYLACZNIE jako CELE POLITYK: migracja
# 20260824074231 przestawia polityki `*_staff_*` z `is_staff()` na nowe
# `is_admin_or_editor()` w czterech domenach naraz, a `ON_ERROR_STOP=1` przerywa
# plik na pierwszym brakujacym obiekcie - czyli PRZED sekcja rekrutacyjna, ktora
# stoi w wierszach 51-99. Bez tych atrap bramka albo swieci czerwono na obiekcie
# spoza modulu, albo (gdyby dostala SKIP) cicho przestaje pilnowac zaostrzenia,
# po ktore ta migracja powstala. Uzasadnienie w calosci: `harness.sql`, blok
# "ATRAPY-CELE POLITYK".
#
# Lista jest CZYTANA z `harness.sql`, nie wpisana tutaj - inaczej rozjechalaby
# sie z kodem przy pierwszej zmianie atrapy.
CELE_POLITYK="$(sed -nE 's/^-- ATRAPA-CEL-POLITYKI: ([a-z_]+) *$/\1/p' "$HERE/harness.sql")"
CELE_LICZBA="$(printf '%s\n' "$CELE_POLITYK" | grep -c . || true)"
echo "Atrapy-cele polityk: $CELE_LICZBA (harness NIC o nich nie twierdzi): $(echo $CELE_POLITYK | tr '\n' ' ')"

# Atrapa-cel polityki NIE odtwarza produkcyjnego ksztaltu tabeli, wiec asercja
# postawiona na niej mierzylaby fikcje - dokladnie ten blad, przed ktorym
# ostrzega README. Ten warunek jest po to, zeby "nic nie twierdzimy" bylo
# EGZEKWOWANE, a nie tylko obiecane w komentarzu.
for cel in $CELE_POLITYK; do
  if grep -qE "\b$cel\b" "$HERE/runtime_test.sql"; then
    echo "runtime_test.sql odwoluje sie do \"$cel\", a to atrapa-cel polityki -" >&2
    echo "ta tabela nie ma produkcyjnego ksztaltu, wiec asercja na niej mierzy fikcje." >&2
    echo "Albo odtworz jej ksztalt z migracji i zdejmij znacznik ATRAPA-CEL-POLITYKI," >&2
    echo "albo usun asercje." >&2
    exit 1
  fi
done

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
  echo "careers-harness: OK ($applied migracji, $CELE_LICZBA atrap-celow polityk, 0 pominietych migracji)"
else
  echo "careers-harness: testy runtime NIE przeszly."
  exit 1
fi
