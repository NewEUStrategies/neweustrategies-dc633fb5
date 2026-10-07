#!/usr/bin/env bash
# Lokalny runner pgTAP na PELNYM schemacie: stawia PostgreSQL, aplikuje WSZYSTKIE
# migracje w kolejnosci Supabase CLI, uruchamia suite z supabase/tests.
#
# Po co: bramka `pgtap` w CI chodzi przez `supabase db start` (docker), ktorego
# w tym sandboxie nie ma. Bez lokalnego odtworzenia nie da sie naprawiac
# czerwonych testow z dowodem - tylko na wyczucie.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$HERE/../.." && pwd)}"
PGDIR="${PGTAP_DIR:-/tmp/nespgtap}"
MODE="${1:-all}"        # all | migrate | test <wzorzec>
PATTERN="${2:-}"

PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
[ -z "$PGBIN" ] && { echo "Brak PostgreSQL"; exit 2; }
export PATH="$PGBIN:$PATH"

RUNAS="$(id -un)"
if [ "$RUNAS" = "root" ]; then
  id -un postgres >/dev/null 2>&1 || useradd -m -s /bin/bash postgres
  RUNAS=postgres
fi
run_as() { if [ "$(id -un)" = "root" ]; then su "$RUNAS" -c "PATH=$PGBIN:\$PATH $*"; else eval "$*"; fi; }

export PGHOST="$PGDIR/run" PGPORT="${PGTAP_PORT:-5434}" PGUSER=postgres

# Osierocony serwer na tym samym porcie jest gorszy niz brak serwera: psql
# podlacza sie do BAZY Z POPRZEDNIEGO PRZEBIEGU, migracje leca po raz drugi
# i sypia setkami falszywych "already exists". Dlatego najpierw twarde
# sprzatanie, potem asercja gotowosci - bez niej caly wynik jest fikcja.
assert_up() {
  psql -d postgres -c 'SELECT 1' >/dev/null 2>&1 && return 0
  echo "BLAD: serwer nie odpowiada na $PGHOST:$PGPORT"
  [ -f "$PGDIR/pg.log" ] && tail -15 "$PGDIR/pg.log"
  exit 1
}

# Uruchamia polecenie bez odziedziczonych deskryptorow > 2. Postmaster jest
# demonem: przezywa run.sh (tryb `test` celowo z niego korzysta) i zabiera ze
# soba kazdy deskryptor otwarty w chwili startu. Pod `flock plik bash run.sh`
# (bez -o) jest wsrod nich deskryptor BLOKADY, a blokada flock(2) trwa, dopoki
# zyje ktorakolwiek jego kopia - serwer trzymal ja wiec az do zatrzymania i
# kazdy kolejny `flock` na tym pliku czekal w nieskonczonosc (zakleszczenie
# rownoleglych przebiegow pgTAP, widziane kilka razy). Ta sama klasa: demon
# trzymajacy koniec zapisu cudzego potoku nie pozwala czytelnikowi doczekac EOF.
#
# Zamykamy w PODPOWLOCE, nie w powloce glownej: ta czyta dalsza tresc skryptu
# z wysokiego deskryptora (255) i jego zamkniecie urwaloby wykonanie pliku.
# Podpowloka ma cialo juz sparsowane, a 255 i tak pomijamy (bash daje mu
# FD_CLOEXEC, wiec nie przechodzi przez exec). Lista z /proc/$BASHPID/fd - nie
# $$, to PID powloki glownej; zamkniecie numeru, ktory zniknal po drodze (np.
# deskryptor katalogu z samego globu), jest w bashu cichym no-opem. Bez /proc
# (inny uniks) zamykamy na slepo 3..254.
without_inherited_fds() {
  (
    fds=""
    if [ -d "/proc/$BASHPID/fd" ]; then
      for p in /proc/"$BASHPID"/fd/*; do fds="$fds ${p##*/}"; done
    else
      fds="$(seq 3 254)"
    fi
    for fd in $fds; do
      case "$fd" in 0|1|2|255) continue ;; esac
      exec {fd}>&-
    done
    "$@"
  )
}

# PGTAP_DIR musi byc osiagalny dla uzytkownika SERWERA, nie tylko dla roota,
# ktory go zaklada: initdb i postmaster pracuja jako $RUNAS i potrzebuja prawa
# przejscia (x) przez KAZDEGO przodka sciezki. Pod katalogiem root:root 0700
# (np. prywatnym katalogiem agenta /tmp/<agent>/...) root robi mkdir i chown
# bez bledu, a initdb pada na "Permission denied" - po cichu, bo jego wyjscie
# szlo do /dev/null, i jedynym objawem bylo mylace "serwer nie odpowiada".
# Sprawdzamy dokladnie to, czego potrzebuje initdb (zapis do $PGDIR/data jako
# $RUNAS), a przy porazce wskazujemy pierwszego przodka bez prawa przejscia.
assert_pgdir_access() {
  run_as "test -d $PGDIR/data -a -x $PGDIR/data -a -w $PGDIR/data" >/dev/null 2>&1 && return 0
  local d="$PGDIR/data" chain="" blocker=""
  while [ "$d" != "/" ] && [ "$d" != "." ]; do chain="$d $chain"; d="$(dirname "$d")"; done
  for d in / $chain; do
    if [ ! -e "$d" ]; then blocker="$d (nie istnieje - mkdir sie nie powiodl?)"; break; fi
    run_as "test -x $d" >/dev/null 2>&1 || { blocker="$(ls -ld "$d")"; break; }
  done
  echo "BLAD: PGTAP_DIR=$PGDIR jest niedostepny dla uzytkownika '$RUNAS'"
  echo "  (initdb i serwer pracuja jako on; potrzebuje prawa x na kazdym przodku i zapisu w $PGDIR/data)"
  echo "  pierwsza przeszkoda: ${blocker:-$PGDIR/data (brak prawa zapisu)}"
  echo "  Uzyj katalogu bezposrednio pod /tmp, np.: PGTAP_DIR=/tmp/$(basename "$PGDIR")"
  exit 1
}

start_fresh() {
  pg_ctl -D "$PGDIR/data" stop -m immediate >/dev/null 2>&1 || true
  pkill -f "postgres.*-p $PGPORT" >/dev/null 2>&1 || true
  sleep 1
  rm -rf "$PGDIR"; mkdir -p "$PGDIR/data" "$PGDIR/run" "$PGDIR/mig"
  [ "$(id -un)" = "root" ] && chown -R "$RUNAS" "$PGDIR"
  assert_pgdir_access
  # locale: domyslnie C (szybkie i wszedzie dostepne), ale `lower()` zwija wtedy
  # tylko ASCII, wiec asercje na frazach z diakrytykami zachowuja sie inaczej niz
  # w CI (baza UTF-8). PGTAP_INITDB_LOCALE pozwala to wyrownac.
  # Wyjscie do pliku, nie do /dev/null: inna porazka initdb (np. locale, ktorego
  # system nie ma) tez ma byc nazwana wprost, a nie udawac martwy serwer.
  run_as "initdb -D $PGDIR/data -U postgres --auth=trust -E UTF8 --locale=${PGTAP_INITDB_LOCALE:-C}" >"$PGDIR/initdb.log" 2>&1 \
    || { echo "BLAD: initdb nie powiodl sie (pelny log: $PGDIR/initdb.log)"; tail -15 "$PGDIR/initdb.log"; exit 1; }
  without_inherited_fds run_as "pg_ctl -D $PGDIR/data -o '-k $PGDIR/run -p $PGPORT -c listen_addresses=\"\"' -l $PGDIR/pg.log start" >/dev/null 2>&1
  for _ in $(seq 1 30); do psql -d postgres -c 'SELECT 1' >/dev/null 2>&1 && break; sleep 0.5; done
  assert_up
  psql -d postgres -tAc "SELECT count(*) FROM pg_database WHERE datname='nes'" | grep -q '^0$' \
    || { echo "BLAD: baza nes juz istnieje - to nie jest swiezy serwer"; exit 1; }
  psql -q -d postgres -c "CREATE DATABASE nes" >/dev/null
  psql -q -d nes <<'SQL' >/dev/null 2>&1
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE supabase_auth_admin NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticator NOINHERIT LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
SQL
  # search_path z `extensions`, bo Supabase tak konfiguruje bazę: bez tego
  # niekwalifikowane klasy operatorów (gin_trgm_ops) i typy z rozszerzeń
  # nie rozwiązują się w migracjach, które ich nie kwalifikują.
  psql -q -d postgres -c "ALTER DATABASE nes SET search_path TO public, extensions" >/dev/null
  psql -q -d nes -v ON_ERROR_STOP=1 -f "$HERE/stub.sql" > "$PGDIR/stub.log" 2>&1 \
    || { echo "STUB FAIL:"; grep -E "ERROR|DETAIL" "$PGDIR/stub.log" | head; exit 1; }
  echo "baza + atrapa Supabase: OK"
}

apply_migrations() {
  local fail=0 n=0
  : > "$PGDIR/failures.txt"
  for f in $(ls "$REPO"/supabase/migrations/*.sql | sort); do
    n=$((n+1))
    local name src out
    name="$(basename "$f")"
    src="$PGDIR/mig/$name"
    # Ta sama atrapa wymiaru wektora co w scripts/pg-harness/run.sh: bez pgvector
    # typ ma inna arnosc, a indeksy hnsw/ivfflat nie istnieja.
    #
    # Granica \b przed "vector" jest ISTOTNA: bez niej wzorzec lapie tez ogon
    # "tsvector(" i rozjezdza kazde uzycie to_tsvector, dajac blad skladni
    # w miejscu zupelnie niezwiazanym z wektorami.
    #
    # CREATE EXTENSION dla rozszerzen niedostepnych w tym obrazie (vector,
    # supabase_vault, pg_net, pg_cron) jest wycinane, bo ich powierzchnie
    # dostarcza stub.sql.
    sed -E -e 's/\bextensions\.vector\([0-9]+\)/extensions.vector/g' \
        -e 's/\bvector\([0-9]+\)/extensions.vector/g' \
        -e 's/USING (hnsw|ivfflat) \([^)]*\)([[:space:]]*WITH \([^)]*\))?/((true))/g' \
        -e 's/^([[:space:]]*)(CREATE EXTENSION[^;]*(vector|supabase_vault|pg_net|pg_cron|pgmq)[^;]*;)/\1-- [runner] wyciete: \2/I' "$f" > "$src"
    if out="$(psql -q -d nes -v ON_ERROR_STOP=1 -f "$src" 2>&1)"; then
      :
    else
      case "$out" in
        *"connection to server"*|*"server closed the connection"*)
          echo "BLAD: utrata polaczenia przy $name - przerywam, dalszy wynik bylby fikcja"
          [ -f "$PGDIR/pg.log" ] && tail -10 "$PGDIR/pg.log"
          exit 1 ;;
      esac
      fail=$((fail+1))
      { echo "=== $name"; echo "$out" | grep -E "^psql:.*ERROR|^ERROR" | head -3; } >> "$PGDIR/failures.txt"
    fi
  done
  echo "migracje: $n zaaplikowanych, $fail z bledem"

  # supabase/seed.sql - `supabase db start` w CI aplikuje go po migracjach, wiec
  # baza CI ma konta deweloperskie, wpisy i klub referencyjny. Bez tego runner
  # klamie w druga strone niz atrapy: fikstura testu moze kolidowac z danymi
  # seeda (unikalny slug, `LIMIT 1` trafiajacy w cudzy wiersz) i wtedy plik
  # przechodzi lokalnie, a pada w CI.
  if [ -f "$REPO/supabase/seed.sql" ]; then
    if out="$(psql -q -d nes -v ON_ERROR_STOP=1 -f "$REPO/supabase/seed.sql" 2>&1)"; then
      echo "seed.sql: OK"
    else
      echo "seed.sql: BLAD"
      echo "$out" | grep -E "^psql:.*ERROR|^ERROR" | head -5 | sed 's/^/     /'
    fi
  fi
  [ "$fail" -gt 0 ] && { echo "--- pierwsze bledy:"; head -60 "$PGDIR/failures.txt"; }
  return 0
}

run_tests() {
  local pat="${1:-}" files pass=0 fail=0
  # Kontrakt TypeScript <-> SQL nie lezy w repo - powstaje z biezacego kodu
  # (scripts/generate-ts-sql-contract.ts), tak jak w jobie `pgtap` w CI.
  if command -v bun >/dev/null 2>&1; then
    (cd "$REPO" && bun run scripts/generate-ts-sql-contract.ts) \
      || echo "UWAGA: generator kontraktu TS <-> SQL zawiodl - ts_sql_contract_test.sql moze byc nieaktualny"
  else
    echo "UWAGA: brak bun - kontrakt TS <-> SQL (ts_sql_contract_test.sql) nie zostal wygenerowany"
  fi
  files=$(ls "$REPO"/supabase/tests/*.sql | sort)
  [ -n "$pat" ] && files=$(echo "$files" | grep -- "$pat")
  : > "$PGDIR/test-failures.txt"
  for t in $files; do
    local name out planned ran failed
    name="$(basename "$t")"
    # -A -t: surowy TAP. Bez tego psql owija plan i asercje w ramke tabeli
    # (" 1..22"), a kazdy parser TAP-a zakotwiczony na poczatku linii widzi zero
    # testow - wlasnie na to nabral sie pierwszy przebieg tego runnera.
    out="$(psql -q -X -A -t -d nes -f "$t" 2>&1)"
    case "$out" in *"connection to server"*)
      echo "BLAD: serwer padl w trakcie testow ($name)"; exit 1 ;; esac
    planned="$(echo "$out" | grep -oE '^1\.\.[0-9]+' | head -1 | cut -d. -f3)"
    ran="$(echo "$out" | grep -cE '^(ok|not ok) [0-9]+')"
    failed="$(echo "$out" | grep -cE '^not ok [0-9]+')"
    if [ -n "$planned" ] && [ "$ran" = "$planned" ] && [ "$failed" = "0" ]; then
      pass=$((pass+1)); printf '  ok   %-58s %s testow\n' "$name" "$ran"
    else
      fail=$((fail+1))
      printf '  FAIL %-58s plan=%s ran=%s failed=%s\n' "$name" "${planned:-?}" "$ran" "$failed"
      {
        echo "=== $name (plan=${planned:-?} ran=$ran failed=$failed)"
        echo "$out" | grep -E '^not ok|ERROR|^psql:' | head -8
        echo
      } >> "$PGDIR/test-failures.txt"
    fi
  done
  echo
  echo "pgTAP: $pass plikow OK, $fail plikow z bledem  (szczegoly: $PGDIR/test-failures.txt)"
}

case "$MODE" in
  all)     start_fresh; apply_migrations; run_tests "$PATTERN" ;;
  migrate) start_fresh; apply_migrations ;;
  test)    run_tests "$PATTERN" ;;
  *)       echo "uzycie: run.sh [all|migrate|test] [wzorzec]"; exit 2 ;;
esac
