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
# SPROSTOWANIE UZASADNIENIA, KTORE STALO TU WCZESNIEJ (i nadal stoi w ci.yml
# przy kroku `Run pg-harness`).
#
# FALSZYWA PRZESLANKA. Komentarz selektora wyzej argumentuje, ze wybor po
# TRESCI (`public.club_` / `public.admin_club_`) trzyma zestaw przy migracjach
# MODULU, bo "selektor po samym `emit_domain_event` bylby zly: nazwa siedzi
# w czterdziestu migracjach calej aplikacji, a harness celowo STUBUJE tamte
# schematy". Na tej przeslance opieral sie wniosek zapisany w ci.yml: "Kod
# wyjscia 1 oznacza albo migracje, ktora sie nie wykonuje, albo niespelniona
# asercje" - czyli KAZDA czerwien to defekt modulu.
#
# JAK JEST NAPRAWDE. Selektor pyta o TRESC PLIKU, a panel Lovable emituje
# PACZKI: jeden plik migracji to zlepek kilku niezaleznych migracji zapisanych
# pod jedna nowa wersja. `20260822171037_bea8e790-...` jest zlepkiem SIEDMIU
# (`20260822090000` ... `20260822096000`) i tylko OSTATNIA sekcja jest klubowa.
# Szesc pierwszych rusza `public.content_access`, `public.member_resources`,
# `public.plan_ticket_claims` i katalog produktow - dokladnie te powierzchnie,
# ktorych atrapa CELOWO nie stawia. Jedno trafienie `public.club_events`
# w ostatniej sekcji wciaga caly zlepek. Wiec przeslanka "wybrane po tresci =
# migracja modulu" jest po prostu nieprawdziwa dla plikow-zlepkow, a czerwien
# 42P01 na `content_access` nie mowi o module NIC.
#
# DOWOD (przeliczalny, `grep` po 91 wybranych plikach):
#   * `content_access` i `member_resources` wystepuja w DOKLADNIE JEDNYM
#     wybranym pliku - w tym zlepku. Zadna prawdziwa migracja modulu ich nie
#     zna. Dlatego wlasciwa naprawa NIE jest dostawienie `content_access` do
#     `harness.sql`: bylo by to poszerzanie zasiegu atrapy pod artefakt panelu,
#     ktory z modulem nie ma zwiazku.
#   * klubowa sekcja zlepka jest juz wykonywana OSOBNO - plik
#     `20260822096000_club_events_tier_gate.sql` przechodzi OK i jest
#     NADZBIOREM tej sekcji (ma o jeden `GRANT EXECUTE ... club_event_upsert`
#     wiecej). Pominiecie zlepka nie odbiera bramce ani jednej linii SQL-a
#     modulu, ktorej by nie wykonala.
# ---------------------------------------------------------------------------
# ZASIEG ATRAPY, WYLICZANY - NIE WPISYWANY RECZNIE.
#
# Kryterium SKIP musi byc WASKIE i JAWNE, inaczej zamienia sie w "padlo, to
# pomijamy". Zasieg = zbior nazw relacji, ktore bramka ZNA:
#   (1) co stawia `harness.sql` - zadeklarowana powierzchnia styku;
#   (2) co tworza SAME wybrane migracje - obiekty modulu (`club_*`, `clubs`).
# Lista jest wyliczana z tekstu, a nie wpisana, zeby nie rozjechala sie
# z plikami: gdy ktos dostawi tabele do atrapy, ta tabela sama wroci do
# zasiegu i blad na niej znowu bedzie czerwony.
#
# Filtr slow kluczowych zdejmuje trafienia z KOMENTARZY (np. `-- "CREATE TABLE
# is not allowed..."` w a8_hardening). Falszywy wpis w zasiegu moze wywolac
# tylko FAIL, nigdy SKIP - wiec ten filtr celowo myli sie w strone czerwieni.
ZASIEG="$PGDIR/zasieg-relacji.txt"
grep -hoiE 'CREATE +(OR +REPLACE +)?(UNLOGGED +)?(MATERIALIZED +)?(FOREIGN +)?(TABLE|VIEW|SEQUENCE)( +IF +NOT +EXISTS)? +[A-Za-z0-9_."]+' \
  "$HERE/harness.sql" $MIGRATIONS \
  | sed -E 's/.*[[:space:]]//; s/"//g; s/.*\.//' \
  | tr 'A-Z' 'a-z' \
  | grep -vxE 'if|not|exists|table|view|sequence|or|replace|unlogged|materialized|foreign' \
  | sort -u > "$ZASIEG"
echo "Zasieg atrapy: $(grep -c . "$ZASIEG") relacji (atrapa + obiekty tworzone przez wybrane migracje)"

# Zwraca 0 i wypisuje przyczyne, gdy porazka kwalifikuje sie na SKIP.
# Warunki sa KONIUNKCJA i wszystkie musza byc spelnione:
#   * kazda linia `ERROR:` z psql-a jest klasy 42P01 `relation "X" does not
#     exist` - kazdy INNY blad (skladnia, brak kolumny, brak funkcji,
#     dwuznaczna kolumna, kolizja sygnatur) to kandydat na regresje i zostaje
#     FAIL-em;
#   * kazde X lezy POZA wyliczonym zasiegiem atrapy. Jesli X jest w zasiegu -
#     czyli atrapa je stawia albo tworzy je jakas wybrana migracja - to znaczy,
#     ze obiekt POWINIEN istniec i jego brak JEST regresja. Wtedy FAIL.
poza_zasiegiem_atrapy() {
  local out="$1" errs line rel bare powody=""
  errs="$(printf '%s\n' "$out" | grep -E 'ERROR:' || true)"
  [ -n "$errs" ] || return 1
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      *'ERROR:  relation "'*'" does not exist'*) ;;
      *) return 1 ;;
    esac
    rel="$(printf '%s\n' "$line" | sed -E 's/.*relation "([^"]+)" does not exist.*/\1/')"
    bare="$(printf '%s' "${rel##*.}" | tr 'A-Z' 'a-z')"
    if grep -qxF "$bare" "$ZASIEG"; then return 1; fi
    powody="${powody:+$powody; }relacja \"$rel\" poza zasiegiem atrapy (nie stawia jej harness.sql ani zadna wybrana migracja)"
  done <<EOF
$errs
EOF
  printf '%s' "$powody"
  return 0
}

ok=0
skipped=0
failed=0
for f in $MIGRATIONS; do
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
    ok=$((ok + 1))
  elif powod="$(poza_zasiegiem_atrapy "$out")"; then
    # SKIP musi byc WIDOCZNY i uzasadniony w logu - cicha tolerancja jest
    # dokladnie tym, przed czym ostrzega historia bramek, ktore istnialy
    # i nie byly uruchamiane. Dlatego obok przyczyny leci surowa linia psql-a,
    # zeby dalo sie ja skonfrontowac z `harness.sql` bez odtwarzania przebiegu.
    printf '  SKIP %s - %s\n' "$name" "$powod"
    echo "$out" | grep -E "ERROR" | head -3 | sed 's/^/       /'
    skipped=$((skipped + 1))
  else
    printf '  FAIL %s\n' "$name"
    echo "$out" | grep -E "ERROR|LINE [0-9]|DETAIL|HINT" | head -6 | sed 's/^/       /'
    failed=$((failed + 1))
  fi
done
echo "Migracje: $ok OK, $skipped SKIP, $failed FAIL"

# CZEGO BRAMKA PRZEZ SKIP PRZESTAJE PILNOWAC - wprost.
# Plik z SKIP-em nie jest wykonany do konca: `ON_ERROR_STOP=1` przerywa go na
# pierwszym bledzie, wiec CALA jego dalsza tresc (w zlepku: szesc kolejnych
# sekcji, w tym klubowa) NIE zostaje sprawdzona przez wykonanie. Instrukcje
# PRZED bledem juz sie wykonaly - psql bez `-1` nie owija pliku w transakcje -
# wiec baza zostaje w stanie czesciowym. W dzisiejszym przypadku to nie ubytek:
# klubowa sekcja zlepka jest nadzbiorem pokrytym osobnym plikiem
# `20260822096000_club_events_tier_gate.sql` (patrz dowod wyzej). Gdyby
# kiedykolwiek zlepek przyniosl SQL modulu, ktorego nie ma w zadnym innym
# pliku, ten SQL przestanie byc wykonywany - i o tym mowi ta linia logu.
#
# Zielona bramka na zerowej liczbie wykonanych migracji byla by klamstwem -
# ten sam inwariant pilnuje scripts/events-harness/run.sh.
[ "$ok" -gt 0 ] || { echo "Zadna migracja nie zostala wykonana - selektor albo filtr --only jest zepsuty."; exit 1; }
[ "$failed" -eq 0 ] || { echo "Migracje nie przeszly."; exit 1; }

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
