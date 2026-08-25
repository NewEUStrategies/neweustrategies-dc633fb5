#!/usr/bin/env bash
# PO CO TEN PLIK ISTNIEJE
# Stawia wlasny, jednorazowy klaster PostgreSQL, zaklada na nim ATRAPY
# powierzchni platformy (harness.sql), a potem REPLAYUJE wszystkie migracje
# modulu Wydarzen na czystej bazie i uruchamia asercje runtime.
#
# Bramki `check:sql-*` czytaja migracje jako TEKST. Nie zobacza bledu, ktory
# ujawnia sie dopiero przy WYKONANIU: kolizji sygnatur miedzy migracjami,
# funkcji odwolujacej sie do kolumny, ktorej nie ma, triggera, ktory nigdy nie
# odpala, ograniczenia EXCLUDE, ktore nic nie wyklucza, ani polityki RLS
# przepuszczajacej obcego najemce. Modul Wydarzen ma 30+ tabel, 140 funkcji,
# 52 polityki i 12 ograniczen EXCLUDE i do tej pory NIE BYL replayowany w CI
# przez ZADNA bramke - istniejaca `check:pg-harness` dobiera migracje po
# tresci `public.club_`/`public.admin_club_`, czego zadna migracja wydarzen
# nie zawiera.
#
# CZEGO TEN PLIK NIE SPRAWDZA
#   * nie sprawdza kodu frontu (src/) ani typow wygenerowanych - to inne bramki;
#   * nie sprawdza wydajnosci ani planow zapytan - baza jest pusta;
#   * nie odtwarza produkcyjnej bazy. Powierzchnia poza modulem jest ATRAPA
#     (patrz harness.sql), wiec zachowanie klubow, stron, reklam czy warstw
#     czlonkostwa NIE jest tu miarodajne;
#   * nie sprawdza migracji SPRZED modulu (20260713093000 i pozniejsze latki
#     na `events`) - one sa zastapione atrapa o dokladnie tym ksztalcie, jakiego
#     modul potrzebuje.
#
# UZYCIE
#   bash scripts/events-harness/run.sh              # migracje + testy runtime
#   bash scripts/events-harness/run.sh --keep       # zostaw baze do ogladania
#   bash scripts/events-harness/run.sh --only 10_   # tylko pliki asercji 10_*
#
# ROWNOLEGLOSC. Katalog i port sa nadpisywalne, bo kilka harnessow (klubowy
# 5433, rekrutacyjny 5434, programowy 5435) i kilka sesji agentow moga stac
# jednoczesnie. Domyslnie: /tmp/nesevents na porcie 5436.
#   EVENTS_HARNESS_DIR=/tmp/moj EVENTS_HARNESS_PORT=5499 bash scripts/events-harness/run.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PGDIR="${EVENTS_HARNESS_DIR:-/tmp/nesevents}"
PGPORT_HARNESS="${EVENTS_HARNESS_PORT:-5436}"
KEEP=0
ONLY=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --only) shift; ONLY="${1:-}" ;;
    *) echo "Nieznany argument: $1" >&2; exit 2 ;;
  esac
  shift
done

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
run_as "pg_ctl -D $PGDIR/data -o '-k $PGDIR/run -p $PGPORT_HARNESS -c listen_addresses=\"\"' -l $PGDIR/pg.log start" >/dev/null
sleep 2

export PGHOST="$PGDIR/run" PGPORT="$PGPORT_HARNESS" PGUSER=postgres
cleanup() { [ "$KEEP" -eq 1 ] || run_as "pg_ctl -D $PGDIR/data stop" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -q -d postgres -c "CREATE DATABASE nes;" >/dev/null

# Role Supabase. Migracje modulu robia GRANT-y na `anon`, `authenticated`
# i `service_role`, wiec bez nich replay przewraca sie na pierwszym GRANT-cie.
psql -q -d nes -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SQL

psql -q -d nes -v ON_ERROR_STOP=1 -f "$HERE/harness.sql" >/dev/null
echo "harness (atrapy): OK"

# ---------------------------------------------------------------------------
# DOBOR MIGRACJI PO TRESCI, NIE PO GLOBIE NAZWY
#
# Powod jest ten sam, co opisany w scripts/pg-harness/run.sh: migracja nazwana
# losowym UUID-em przez panel Lovable nie zostanie zlapana globem
# `*event_builder*`, a moze redefiniowac funkcje modulu - i wtedy kolizja
# sygnatur wychodzi dopiero na produkcji. Selektor musi wiec pytac o TRESC.
#
# Selektor jest ALTERNATYWA dwoch wzorcow, bo zaden pojedynczy nie lapie
# calego modulu:
#   * `public.admin_event_` - powierzchnia panelu administracyjnego; lapie
#     8 z 10 migracji, ale NIE lapie 20260823135000 (dodaje tylko ograniczenie
#     unikalnosci na `events`) ani 20260823170000 (zaczep frontu, ktory zamiast
#     RPC panelu wystawia widoki publiczne);
#   * `events_tenant_id_key` - nazwa ograniczenia `UNIQUE (tenant_id, id)`
#     z 20260823135000, na ktore powoluja sie zlozone klucze obce
#     `(tenant_id, event_id)` wszystkich tabel potomnych; to domyka te dwie.
#
# Weryfikacja (grep po CALYM katalogu migracji): 10 trafien, dokladnie dziesiec
# migracji modulu Wydarzen, ani jednego pliku poza modulem. W szczegolnosci NIE
# lapie 20260713093000_events_module.sql ani pozniejszych latek na `events` -
# te powierzchnie harness stawia jako atrape.
#
# Sortowanie po nazwie pliku jest ISTOTNE: tylko ono odtwarza kolejnosc,
# w ktorej pliki aplikuje Supabase CLI, a wiec realny stan koncowy.
# ---------------------------------------------------------------------------
# TRZECI CZLON SELEKTORA: JAWNY ZNACZNIK `events-harness: include`.
# Selektor po tresci lapie migracje, ktore definiuja RPC panelu albo klucz
# tozsamosci najemcy. Nie zlapie migracji, ktora rusza WYLACZNIE polityki RLS
# modulu - a taka jest `20260825170000_event_rls_admin_only.sql`. Rozszerzenie
# wzorca o `ON public.event_` wciagneloby 37 obcych plikow (hub ekspertow,
# scoring CRM, profile) i `20260713093000_events_module.sql`, ktorego
# powierzchnie harness stawia jako ATRAPE - wiec zamiast luzniejszej
# heurystyki migracja dopisuje sie do zestawu SAMA, jedna linia komentarza.
MIGRATIONS="$(grep -lE 'public\.admin_event_|events_tenant_id_key|events-harness: include' \
                "$REPO"/supabase/migrations/*.sql | sort -u)"
echo "Migracje modulu Wydarzen: $(echo "$MIGRATIONS" | grep -c .)"

fail=0
applied=0
for f in $MIGRATIONS; do
  name="$(basename "$f")"
  if out="$(psql -q -d nes -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    printf '  OK   %s\n' "$name"
    applied=$((applied + 1))
  else
    printf '  FAIL %s\n' "$name"
    echo "$out" | grep -E "ERROR|LINE [0-9]|DETAIL|HINT" | head -8 | sed 's/^/       /'
    fail=1
  fi
done
# Selektor po tresci moze przestac lapac cokolwiek po zmianie nazw funkcji.
# Zielona bramka na zerze aplikacji byla by klamstwem, wiec to jest blad.
[ "$applied" -gt 0 ] || { echo "Zadna migracja nie zostala wybrana - selektor jest zepsuty."; exit 1; }
[ "$fail" -eq 0 ] || { echo "Migracje nie przeszly."; exit 1; }

echo
echo "== asercje runtime =="

# ---------------------------------------------------------------------------
# KOD WYJSCIA PSQL MUSI PRZEZYC POTOK.
#
# To jest najwazniejsza lekcja scripts/pg-harness/run.sh i nie wolno jej
# powtorzyc jako bledu. Konstrukcja `if psql ... | grep ...` bierze kod
# wyjscia GREP-a, nie psql-a - czyli niespelniona asercja tylko DRUKOWALA sie
# na ekranie, a bramka raportowala sukces dokladnie wtedy, gdy powinna byc
# czerwona. Dlatego: psql pisze do pliku, kod wyjscia lapiemy do `rc` przy
# wylaczonym `set -e`, a filtrowanie wyjscia robimy DOPIERO POTEM, na pliku.
# ---------------------------------------------------------------------------
# Manifest petli runtime_test.d. Lista jest generowana, a nie wpisana
# w runtime_test.sql - inaczej kazdy agent dopisujacy plik asercji musialby
# edytowac ten sam wiersz i szescioro rownoleglych autorow by na nim
# kolidowalo. Sortowanie po nazwie: numer w nazwie (00 dym, 10 sesje,
# 20 zapisy, 30 sponsorzy, 40 front, 50 obsluga na miejscu, 60 spotkania) jest
# jedynym porzadkiem, na ktory moga sie umowic.
MANIFEST="$PGDIR/runtime_manifest.sql"
: > "$MANIFEST"
count=0
for f in $(ls "$HERE/runtime_test.d"/*.sql 2>/dev/null | sort); do
  base="$(basename "$f")"
  [ -n "$ONLY" ] && case "$base" in "$ONLY"*) ;; *) continue ;; esac
  # printf zjada `\e` jako znak steru, wiec format jest '%s' a backslash
  # wchodzi w argumencie - inaczej manifest niesie `cho` zamiast `\echo`.
  printf '%s\n' "\\echo '-- plik $base'" "\\i $f" >> "$MANIFEST"
  count=$((count + 1))
done
if [ "$count" -eq 0 ]; then
  echo "Zaden plik asercji nie zostal wybrany z runtime_test.d (--only '$ONLY')."
  exit 1
fi
echo "Plikow asercji: $count"

set +e
psql -d nes -q -v ON_ERROR_STOP=1 -v manifest="$MANIFEST" \
     -f "$HERE/runtime_test.sql" > "$PGDIR/runtime.out" 2>&1
rc=$?
set -e
sed 's/psql:[^ ]* //;s/NOTICE:  //' "$PGDIR/runtime.out" \
  | grep -E "^==|^  ok |ERROR|ASERCJA|^-- plik|^ ASERCJE|^ WSZYSTKIE" || true

passed="$(grep -cE 'NOTICE: +ok +' "$PGDIR/runtime.out" || true)"
echo
if [ "$rc" -ne 0 ]; then
  echo "Asercje runtime NIE przeszly (zdanych przed bledem: $passed)."
  [ "$KEEP" -eq 1 ] && echo "Baza zostaje: PGHOST=$PGDIR/run PGPORT=$PGPORT_HARNESS psql -d nes"
  exit 1
fi
echo "events-harness: OK ($applied migracji, $passed asercji)."
if [ "$KEEP" -eq 1 ]; then
  echo "Baza zostaje: PGHOST=$PGDIR/run PGPORT=$PGPORT_HARNESS psql -d nes"
fi
exit 0
