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

# Wybor migracji po TRESCI, nie po nazwie pliku.
#
# Wczesniej harness bral wylacznie pliki *discussion_clubs*, co zostawialo
# martwe pole: migracja klubowa nazwana losowym UUID-em (tak nazywa je panel
# Lovable) nie byla aplikowana w ogole. Realnie sie to zemscilo - migracja
# 20260807172345 redefiniowala club_list, club_replies_list i
# admin_club_moderation_queue, a harness tego nie widzial, wiec kolizja
# sygnatur z pozniejszymi migracjami wyszla dopiero w CI.
#
# Sortowanie jest ISTOTNE: dokladnie w tej kolejnosci aplikuje pliki Supabase
# CLI, wiec tylko ona odtwarza realny stan koncowy.
# Dobor po TRESCI plus po nazwie modulu.
#
# Tresc (`public.club_`, `public.admin_club_`) lapie migracje klubowe nazwane
# UUID-em przez rownolegle sesje - glob po samej nazwie by je pominal.
#
# Nazwa (`discussion_clubs`) lapie migracje modulu, ktore ruszaja WYLACZNIE
# powierzchnie wspoldzielona. A16 jest wlasnie taka: naprawia sygnature
# `emit_domain_event`, zepsuta przez A12, i nie wymienia zadnej funkcji
# klubowej. Bez tego czlonu harness nie widzialby ani przyczyny, ani naprawy.
#
# Selektor po samym `emit_domain_event` bylby zly: nazwa siedzi w czterdziestu
# migracjach calej aplikacji, a harness celowo STUBUJE tamte schematy.
MIGRATIONS="$( { grep -lE 'public\.(club_|admin_club_)' "$REPO"/supabase/migrations/*.sql
                 ls "$REPO"/supabase/migrations/*discussion_clubs*.sql 2>/dev/null
               } | sort -u)"
echo "Migracje dotykajace modulu: $(echo "$MIGRATIONS" | grep -c .)"

# ---------------------------------------------------------------------------
# JAWNE POMINIECIE: znacznik `pg-harness: exclude` w tresci migracji.
#
# PO CO. Selektor dobiera po tresci, wiec lapie takze ZLEPEK - plik zbierajacy
# kilka niezaleznych migracji, ktorego jedna sekcja dotyka modulu, a reszta
# importuje warunki wstepne obcych modulow. Taki plik nie da sie zaaplikowac
# na atrapie modulu i wywraca CALY przebieg, nie wnoszac pokrycia.
#
# DLACZEGO POMINIECIE W PETLI, A NIE WYCIECIE Z SELEKTORA. Wyciecie
# (`| xargs grep -L`) daje ten sam skutek, ale NIEWIDOCZNIE: plik przestaje
# istniec dla przebiegu i nikt sie nie dowie, ze zestaw sie skurczyl.
# Niewidoczne wykluczenie jest dokladnie tym sposobem, w ktory pokrycie
# harnessu gnije po cichu. Tutaj pominiecie DRUKUJE SIE w logu CI z nazwa pliku
# i liczba na koncu, wiec jest widoczne przy kazdym przebiegu.
#
# STRAZNIK `applied > 0`. Znacznik wpisany za szeroko (albo literowka
# w warunku) moglby opróznic zestaw, a pusta petla konczy sie zerem - czyli
# bramka raportowalaby sukces, nie sprawdziwszy ani jednej migracji. To ten sam
# tryb awarii, ktory ten plik juz raz naprawil przy kodzie wyjscia psql
# w potoku.
# ---------------------------------------------------------------------------
fail=0
applied=0
skipped=0
for f in $MIGRATIONS; do
  name="$(basename "$f")"
  [ -n "$PREFIX" ] && case "$name" in "$PREFIX"*) ;; *) continue ;; esac
  if grep -q 'pg-harness: exclude' "$f"; then
    printf '  SKIP %s (znacznik pg-harness: exclude)\n' "$name"
    skipped=$((skipped + 1))
    continue
  fi
  src="$f"
  if [ "$STUB" -eq 1 ]; then
    src="$PGDIR/$(basename "$f")"
    sed -e 's/extensions\.vector(768)/extensions.vector/g' \
        -e 's/USING hnsw (embedding extensions.vector_cosine_ops)/(thread_id)/' "$f" > "$src"
  fi
  if out="$(psql -q -d nes -v ON_ERROR_STOP=1 -f "$src" 2>&1)"; then
    printf '  OK   %s\n' "$name"
    applied=$((applied + 1))
  else
    printf '  FAIL %s\n' "$name"
    echo "$out" | grep -E "ERROR|LINE [0-9]|DETAIL|HINT" | head -6 | sed 's/^/       /'
    fail=1
  fi
done
echo "Zaaplikowano: $applied, pominieto znacznikiem: $skipped."
[ "$fail" -eq 0 ] || { echo "Migracje nie przeszly."; exit 1; }
# Pusty zestaw to NIE sukces - patrz komentarz o strazniku wyzej.
[ "$applied" -gt 0 ] || {
  echo "Zero zaaplikowanych migracji - zestaw jest pusty albo znacznik wyciil wszystko."
  exit 1
}

echo
# Kod wyjscia psql musi przezyc potok. Bez tego niespelniona asercja tylko
# drukowala sie na ekranie, a skrypt konczyl sie zerem - czyli bramka
# raportowala sukces dokladnie wtedy, gdy powinna byc czerwona.
set +e
psql -d nes -q -f "$HERE/runtime_test.sql" > "$PGDIR/runtime.out" 2>&1
rc=$?
set -e
sed 's/psql:[^ ]* //;s/NOTICE:  //' "$PGDIR/runtime.out" \
  | grep -E "^==|  ok |ERROR|ASERCJA|====" || true

passed="$(grep -cE 'NOTICE: +ok +' "$PGDIR/runtime.out" || true)"
echo
if [ "$rc" -ne 0 ]; then
  echo "Testy runtime NIE przeszly (asercji zdanych przed bledem: $passed)."
  [ "$KEEP" -eq 1 ] && echo "Baza zostaje: PGHOST=$PGDIR/run PGPORT=5433 psql -d nes"
  exit 1
fi
echo "Testy runtime OK ($passed asercji)."
if [ "$KEEP" -eq 1 ]; then
  echo "Baza zostaje: PGHOST=$PGDIR/run PGPORT=5433 psql -d nes"
fi
exit 0
