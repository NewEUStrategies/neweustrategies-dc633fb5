#!/usr/bin/env bash
# PO CO TEN PLIK ISTNIEJE
# Dowod na PRAWDZIWYM PostgreSQL, ze KOLEJNOSC, w jakiej produkcja dostaje
# migracje, daje ten sam stan koncowy, co odtworzenie w kolejnosci WERSJI
# (tak odtwarzaja baze CI, pgTAP i scripts/events-harness/run.sh).
#
# PRZYCZYNA. Lovable wdraza migracje migratorem drizzle: ten bierze NAJWIEKSZE
# created_at z drizzle.__drizzle_migrations i w jednej transakcji wykonuje kazdy
# wpis `drizzle/migrations/meta/_journal.json` o `when` wiekszym od niego -
# w kolejnosci dziennika, nie wersji supabase (docs/RUNBOOK_MIGRACJE_LOVABLE.md,
# sekcja 2). Od 2026-10-25 nowe wpisy generuje `bun run migrations:mirror`
# w kolejnosci wersji; starsze maja kolejnosc historyczna. 2026-09-27 przy
# wdrozeniu skanera offline (zapisy 0071/0072) migrator wykonal przy okazji
# 0067-0070 (braki cz. 3 z #407 i most CRM z imionami), czyli 20260926180000-
# 180002 i 20260927000900 PRZED fundamentem uczestnika z #406
# (20260926153100-153300), ktory w dzienniku nie stoi. Kolejnosc z notatki
# wdrozenia przestala byc prawda, a jej dalsze wykonanie nadpisaloby nowsze
# cialo `payments_apply_event_ticket_outcome` starszym. Ten skrypt pokazuje
# taki rozjazd, ZANIM trafi na produkcje.
#
# JAK DZIALA. Dwie swieze bazy z tymi samymi atrapami (harness wydarzen) i tymi
# samymi migracjami modulu (selektor czytany z scripts/events-harness/run.sh):
#   * `ref`  - wszystkie w kolejnosci wersji;
#   * `nes`  - migracje o wersji <= LINII w kolejnosci wersji, potem pliki
#              z pliku kolejnosci DOKLADNIE w podanej kolejnosci (wolno
#              powtorzyc plik - tak wyglada ponowne zastosowanie z panelu).
# Potem `pg_dump --schema-only` i `--data-only` (uuid/czas zamaskowane) obu baz
# i diff. Na bazie `nes` (kolejnosc produkcyjna) ida asercje runtime harnessu
# wydarzen - ten sam plik runtime_test.sql, co w run.sh.
#
# PLIK KOLEJNOSCI: jedna nazwa pliku z supabase/migrations/ w wierszu,
# `#` zaczyna komentarz. Pierwszy wiersz niekomentarza `LINIA <wersja>` ustala
# linie (domyslnie 20260926140000 - ostatnia migracja modulu zastosowana
# na produkcji w kolejnosci wersji). Kazda migracja modulu nowsza od linii musi
# wystapic w pliku co najmniej raz - brak konczy skrypt odmowa. Pliki spoza
# zestawu harnessu (np. 20260926153300, rodzaje powiadomien na atrapie) sa
# pomijane w OBU bazach i wypisywane.
#
# CZEGO TEN PLIK NIE SPRAWDZA
#   * migracji spoza modulu Wydarzen - reszta platformy to atrapa;
#   * stanu produkcji - to robi zapytanie weryfikujace z notatki wdrozenia
#     (tylko odczyt); ten skrypt dowodzi, ze PLAN jest poprawny.
#
# ZAPYTANIE WERYFIKUJACE (scripts/deploy-order/weryfikacja-po-wdrozeniu.sql)
# powstaje na koncu, z TRZECIEJ bazy: pelnego odtworzenia supabase/migrations
# w kolejnosci wersji (scripts/pgtap-local/run.sh migrate - ta sama baza, co
# pgTAP w CI). Zakres: obiekty migracji modulu nowszych od linii oraz plikow
# spoza selektora z scripts/deploy-order/weryfikacja.zakres.txt. Zapytanie
# nie zalezy od kolejnosci produkcyjnej - z pliku kolejnosci bierze tylko
# LINIE - wiec DEPLOY_PROOF_VERIFY_ONLY=1 generuje je bez dowodu kolejnosci,
# takze gdy plik kolejnosci nie wymienia jeszcze nowszych migracji modulu.
#
# UZYCIE
#   bash scripts/deploy-order-proof.sh scripts/deploy-order/produkcja.txt
#   DEPLOY_PROOF_DIR / DEPLOY_PROOF_PORT  klaster (domyslnie /tmp/nes-order-proof, 5482)
#   DEPLOY_PROOF_FULL_DIR / DEPLOY_PROOF_FULL_PORT
#                                         klaster pelnego odtworzenia (domyslnie
#                                         <DEPLOY_PROOF_DIR>-pelna, port klastra + 1)
#   DEPLOY_PROOF_SKIP_RUNTIME=1           bez asercji runtime
#   DEPLOY_PROOF_WRITE_VERIFY=<plik>      kopia zapytania weryfikujacego do <plik>
#   DEPLOY_PROOF_VERIFY_ONLY=1            tylko zapytanie weryfikujace (bez baz ref/nes)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
ORDER="${1:?Podaj plik kolejnosci (np. scripts/deploy-order/produkcja.txt)}"
PGDIR="${DEPLOY_PROOF_DIR:-/tmp/nes-order-proof}"
PGPORT_PROOF="${DEPLOY_PROOF_PORT:-5482}"
FULLDIR="${DEPLOY_PROOF_FULL_DIR:-$PGDIR-pelna}"
FULLPORT="${DEPLOY_PROOF_FULL_PORT:-$((PGPORT_PROOF + 1))}"
VERIFY_ONLY="${DEPLOY_PROOF_VERIFY_ONLY:-0}"
OUT="$PGDIR/out"
MIG="$REPO/supabase/migrations"
HARNESS="$REPO/scripts/events-harness"
SCOPE="$HERE/deploy-order/weryfikacja.zakres.txt"

fail() { echo "ODMOWA: $*" >&2; exit 2; }
[ -f "$ORDER" ] || fail "brak pliku kolejnosci $ORDER"

SEL="$(sed -nE "s/^MIGRATIONS=\"\\\$\(grep -lE '([^']+)'.*/\1/p" "$HARNESS/run.sh")"
[ -n "$SEL" ] || fail "nie znalazlem selektora migracji w $HARNESS/run.sh"

LINE="20260926140000"
LISTED=()
while IFS= read -r raw; do
  row="${raw%%#*}"; row="$(echo "$row" | tr -d '[:space:]')"
  [ -n "$row" ] || continue
  case "$row" in
    LINIA*) LINE="${row#LINIA}"; continue ;;
  esac
  [ -f "$MIG/$row" ] || fail "w pliku kolejnosci jest $row, ktorego nie ma w supabase/migrations"
  LISTED+=("$row")
done < "$ORDER"
# Tryb VERIFY_ONLY bierze z pliku kolejnosci tylko LINIE (naglowek).
[ "$VERIFY_ONLY" = "1" ] || [ "${#LISTED[@]}" -gt 0 ] || fail "plik kolejnosci nie wymienia zadnej migracji"
[[ "$LINE" =~ ^[0-9]{14}$ ]] || fail "LINIA musi byc wersja z 14 cyfr, jest '$LINE'"

ALL=()
while IFS= read -r f; do ALL+=("$(basename "$f")"); done < <(grep -lE "$SEL" "$MIG"/*.sql | sort -u)
in_set() { local x; for x in "${ALL[@]}"; do [ "$x" = "$1" ] && return 0; done; return 1; }
listed() { local x; for x in ${LISTED[@]+"${LISTED[@]}"}; do [ "$x" = "$1" ] && return 0; done; return 1; }

BASE=()
for b in "${ALL[@]}"; do
  if [[ "${b%%_*}" > "$LINE" ]]; then
    [ "$VERIFY_ONLY" = "1" ] || listed "$b" || fail "$b (nowsza od linii $LINE) nie wystepuje w pliku kolejnosci"
  else
    BASE+=("$b")
  fi
done
PLAN=(); SKIPPED=()
for b in ${LISTED[@]+"${LISTED[@]}"}; do
  if in_set "$b"; then PLAN+=("$b"); else SKIPPED+=("$b"); fi
done

# Zakres zapytania weryfikujacego PONAD selektor modulu: pliki, ktore selektor
# harnessu pomija (SMS, wypis z maili, DLQ poczty, konta od administratora),
# a ktorych obiekty sa czescia wdrozenia modulu. Plik lapany przez selektor
# jest w zakresie bez wpisu, wiec wpis o nim to pomylka - odmowa.
EXTRA=()
if [ -f "$SCOPE" ]; then
  while IFS= read -r raw; do
    row="${raw%%#*}"; row="$(echo "$row" | tr -d '[:space:]')"
    [ -n "$row" ] || continue
    [ -f "$MIG/$row" ] || fail "w $SCOPE jest $row, ktorego nie ma w supabase/migrations"
    in_set "$row" && fail "$row z $SCOPE lapie juz selektor modulu - usun wpis"
    EXTRA+=("$row")
  done < "$SCOPE"
fi

PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
[ -n "$PGBIN" ] || fail "brak PostgreSQL (postgresql-16)"
export PATH="$PGBIN:$PATH"
RUNAS="$(id -un)"
if [ "$RUNAS" = "root" ]; then
  id -un postgres >/dev/null 2>&1 || useradd -m -s /bin/bash postgres
  RUNAS=postgres
fi
run_as() { if [ "$(id -un)" = "root" ]; then su "$RUNAS" -c "PATH=$PGBIN:\$PATH $*"; else eval "$*"; fi; }
# Kazdy klaster, ktory skrypt postawil, schodzi przy wyjsciu - takze po odmowie
# i po bledzie. Pelne odtworzenie (scripts/pgtap-local/run.sh) zostawia serwer
# wlaczony celowo (tryb `test`), wiec tu bez tej listy przezylby skrypt.
CLUSTERS=()
stop_clusters() {
  local d
  for d in ${CLUSTERS[@]+"${CLUSTERS[@]}"}; do run_as "pg_ctl -D $d stop" >/dev/null 2>&1 || true; done
}
trap stop_clusters EXIT
run_as "pg_ctl -D $PGDIR/data stop" >/dev/null 2>&1 || true
rm -rf "$PGDIR"; mkdir -p "$PGDIR/data" "$PGDIR/run" "$OUT"
[ "$(id -un)" = "root" ] && chown -R "$RUNAS" "$PGDIR"
: > "$OUT/summary.txt"
say() { echo "$*" | tee -a "$OUT/summary.txt"; }

# ZAPYTANIE WERYFIKUJACE PO WDROZENIU (tylko odczyt, na produkcje).
# Stan oczekiwany = PELNE odtworzenie supabase/migrations w kolejnosci wersji
# (scripts/pgtap-local/run.sh migrate, baza jak w pgTAP CI), nie `ref`: `ref`
# ma tylko migracje modulu na atrapie, wiec brakuje w nim obiektow z plikow
# spoza selektora (weryfikacja.zakres.txt - ich tabele platformy atrapa nie
# zna), a funkcja modulu nadpisana kiedys przez migracje spoza selektora
# mialaby w nim stara tresc. Zakres = obiekty zakladane przez migracje modulu
# nowsze od linii + pliki z weryfikacja.zakres.txt
# (generator: scripts/deploy-order/weryfikacja.generator.sql).
#
# Wolana w `verify_query || ...`, czyli BEZ `set -e` (bash wylacza go w ciele
# funkcji z listy ||) - kazdy krok, ktory moze sie nie udac, sprawdza kod sam.
verify_query() {
  local files=() b bad=()
  for b in "${ALL[@]}"; do [[ "${b%%_*}" > "$LINE" ]] && files+=("$b"); done
  files+=(${EXTRA[@]+"${EXTRA[@]}"})
  ( cd "$MIG" && sed 's/--.*//' "${files[@]}" ) | tr 'A-Z' 'a-z' > "$OUT/newer.sql" \
    || { say "FAIL odczyt migracji z zakresu"; return 1; }
  # Nazwy jako tablica tekstowa PostgreSQL: {a,b,c}.
  names_of() {
    { grep -oE "$1" "$OUT/newer.sql" || true; } | awk '{print $NF}' \
      | sed -E 's/^public\.//' | sort -u | paste -sd, - | sed 's/^/{/; s/$/}/'
  }
  CLUSTERS+=("$FULLDIR/data")
  if ! PGTAP_DIR="$FULLDIR" PGTAP_PORT="$FULLPORT" REPO="$REPO" \
       bash "$REPO/scripts/pgtap-local/run.sh" migrate > "$OUT/pelna.log" 2>&1; then
    say "FAIL pelne odtworzenie ($OUT/pelna.log)"; tail -5 "$OUT/pelna.log"; return 1
  fi
  # Blad pliku z zakresu = zly stan oczekiwany. Bledy poza zakresem (atrapa
  # Supabase nie ma np. supabase_migrations) nie dotycza tych obiektow.
  for b in "${files[@]}"; do grep -qxF "=== $b" "$FULLDIR/failures.txt" && bad+=("$b"); done
  if [ "${#bad[@]}" -gt 0 ]; then
    say "FAIL pelne odtworzenie: migracje z zakresu z bledem: ${bad[*]} ($FULLDIR/failures.txt)"
    return 1
  fi
  say "pelne odtworzenie: $(grep -m1 '^migracje:' "$OUT/pelna.log") (poza zakresem: $(grep -c '^=== ' "$FULLDIR/failures.txt" || true))"
  if ! psql -X -h "$FULLDIR/run" -p "$FULLPORT" -U postgres -d nes -q -v ON_ERROR_STOP=1 \
    -v fns="$(names_of 'create +(or +replace +)?function +(public\.)?[a-z_0-9]+')" \
    -v tabs="$(names_of 'create +table +(if +not +exists +)?(public\.)?[a-z_0-9]+')" \
    -v alts="$(names_of 'alter +table +(if +exists +)?(only +)?(public\.)?[a-z_0-9]+')" \
    -v cols="$(names_of 'add +column +(if +not +exists +)?[a-z_0-9]+')" \
    -v trgs="$(names_of 'create +trigger +[a-z_0-9]+')" \
    -v src="$(basename "$ORDER"), linia $LINE" \
    -v ext="{$(IFS=,; echo "${EXTRA[*]-}")}" \
    -f "$HERE/deploy-order/weryfikacja.generator.sql" > "$OUT/weryfikacja.sql" 2> "$OUT/generator.err"; then
    say "FAIL generator zapytania weryfikujacego:"; head -5 "$OUT/generator.err"; return 1
  fi
  run_as "pg_ctl -D $FULLDIR/data stop" >/dev/null 2>&1 || true
  say "zapytanie weryfikujace: $OUT/weryfikacja.sql ($(wc -c < "$OUT/weryfikacja.sql") B," \
      "$((${#files[@]} - ${#EXTRA[@]})) migracji modulu od linii + ${#EXTRA[@]} z $(basename "$SCOPE"))"
  if [ -n "${DEPLOY_PROOF_WRITE_VERIFY:-}" ]; then
    cp "$OUT/weryfikacja.sql" "$DEPLOY_PROOF_WRITE_VERIFY" || { say "FAIL zapis $DEPLOY_PROOF_WRITE_VERIFY"; return 1; }
    say "  zapisane do $DEPLOY_PROOF_WRITE_VERIFY"
  fi
}

if [ "$VERIFY_ONLY" = "1" ]; then
  say "tryb VERIFY_ONLY: bez dowodu kolejnosci; z $(basename "$ORDER") tylko linia $LINE"
  verify_query || { say "ZAPYTANIE WERYFIKUJACE: CZERWONE"; exit 1; }
  say "ZAPYTANIE WERYFIKUJACE: OK"
  exit 0
fi

CLUSTERS+=("$PGDIR/data")
run_as "initdb -D $PGDIR/data -U postgres --auth=trust -E UTF8 --locale=C" >/dev/null
run_as "pg_ctl -D $PGDIR/data -o '-k $PGDIR/run -p $PGPORT_PROOF -c listen_addresses=\"\"' -l $PGDIR/pg.log start" >/dev/null
sleep 2
export PGHOST="$PGDIR/run" PGPORT="$PGPORT_PROOF" PGUSER=postgres

psql -q -d postgres -c "CREATE DATABASE stub;" >/dev/null
psql -q -d stub -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SQL
psql -q -d stub -v ON_ERROR_STOP=1 -f "$HARNESS/harness.sql" >/dev/null
psql -q -d postgres -c "CREATE DATABASE ref TEMPLATE stub;" -c "CREATE DATABASE nes TEMPLATE stub;" >/dev/null

apply() { # baza, plik
  if ! psql -q -d "$1" -v ON_ERROR_STOP=1 -f "$MIG/$2" >> "$OUT/apply-$1.log" 2>&1; then
    say "FAIL $1: $2"
    { grep -E "ERROR|LINE [0-9]|DETAIL|HINT" "$OUT/apply-$1.log" || true; } | tail -6 | sed 's/^/       /' | tee -a "$OUT/summary.txt"
    exit 1
  fi
}
for b in "${ALL[@]}"; do apply ref "$b"; done
say "ref: ${#ALL[@]} migracji modulu w kolejnosci wersji OK"
for b in "${BASE[@]}"; do apply nes "$b"; done
for b in "${PLAN[@]}"; do apply nes "$b"; done
say "nes: ${#BASE[@]} migracji do linii $LINE + ${#PLAN[@]} z pliku kolejnosci OK"
[ "${#SKIPPED[@]}" -eq 0 ] || say "poza harnessem (pominiete w obu bazach): ${SKIPPED[*]}"

RK=""
PGDUMP_HELP="$(pg_dump --help)"
[[ "$PGDUMP_HELP" == *--restrict-key* ]] && RK="--restrict-key=orderproof"
# Kanon zrzutu: pozycje pg_dump (`-- Name: ...`) posortowane, a kolumny w CREATE
# TABLE bez przecinkow i posortowane. Kolumna dodana przez migracje zastosowana
# WCZESNIEJ niz w kolejnosci wersji dostaje inna pozycje fizyczna (attnum) -
# tego sie nie cofnie i nie zmienia to zachowania, wiec porownujemy ZBIOR
# obiektow i kolumn; roznice samej kolejnosci kolumn skrypt wypisuje osobno.
canon() {
  python3 - "$1" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
parts = re.split(r"(?m)^--\n-- (?=Name: )", src)
out = []
for part in parts[1:]:
    def cols(m):
        body = m.group(2).split("\n")
        c = sorted(l.rstrip(",") for l in body if l.startswith("    ") and not l.lstrip().startswith("CONSTRAINT"))
        k = sorted(l.rstrip(",") for l in body if l.lstrip().startswith("CONSTRAINT"))
        return m.group(1) + "\n".join(c + k) + "\n" + m.group(3)
    out.append(re.sub(r"(CREATE TABLE [^\n]+ \(\n)(.*?)\n(\);)", cols, part, flags=re.S))
print("\n".join(sorted(out)))
PY
}
# Ten sam kanon dla danych: kolumny bloku COPY alfabetycznie, wiersze posortowane.
canon_data() {
  python3 - "$1" <<'PY'
import re, sys
lines = open(sys.argv[1]).read().split("\n")
out, i = [], 0
while i < len(lines):
    m = re.match(r"COPY (\S+) \((.*)\) FROM stdin;$", lines[i])
    if not m:
        out.append(lines[i]); i += 1; continue
    cols = m.group(2).split(", ")
    order = sorted(range(len(cols)), key=lambda k: cols[k])
    rows, i = [], i + 1
    while i < len(lines) and lines[i] != "\\.":
        f = lines[i].split("\t")
        rows.append("\t".join(f[k] for k in order) if len(f) == len(cols) else lines[i]); i += 1
    out.append("COPY %s (%s) FROM stdin;" % (m.group(1), ", ".join(cols[k] for k in order)))
    out.extend(sorted(rows)); out.append("\\."); i += 1
print("\n".join(out))
PY
}
for db in ref nes; do
  pg_dump --schema-only $RK -d "$db" > "$OUT/schema-$db.raw.sql"
  canon "$OUT/schema-$db.raw.sql" > "$OUT/schema-$db.sql"
  pg_dump --data-only $RK -d "$db" 2>/dev/null \
    | sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<uuid>/g; s/[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?\+00/<ts>/g' \
    > "$OUT/data-$db.raw.sql"
  canon_data "$OUT/data-$db.raw.sql" > "$OUT/data-$db.sql"
done
verdict=0
if diff -u "$OUT/schema-ref.sql" "$OUT/schema-nes.sql" > "$OUT/schema.diff"; then
  say "pg_dump --schema-only (kanon): IDENTYCZNE ($(wc -l < "$OUT/schema-ref.sql") linii, sha256 $(sha256sum < "$OUT/schema-ref.sql" | cut -c1-16))"
  if ! diff -q "$OUT/schema-ref.raw.sql" "$OUT/schema-nes.raw.sql" >/dev/null; then
    say "  (surowe zrzuty roznia sie wylacznie kolejnoscia fizyczna kolumn/pozycji - $OUT/schema-ref.raw.sql)"
  fi
else
  say "pg_dump --schema-only (kanon): ROZNE ($(grep -cE '^[-+][^-+]' "$OUT/schema.diff" || true) linii roznicy, $OUT/schema.diff)"
  { grep -E '^[-+](CREATE|ALTER|Name:)' "$OUT/schema.diff" || true; } | head -10 | tee -a "$OUT/summary.txt"
  verdict=1
fi
if diff -u "$OUT/data-ref.sql" "$OUT/data-nes.sql" > "$OUT/data.diff"; then
  say "pg_dump --data-only (kanon, uuid/czas zamaskowane): IDENTYCZNE ($(grep -c '^COPY ' "$OUT/data-ref.sql" || true) tabel)"
else
  say "pg_dump --data-only: ROZNE ($OUT/data.diff)"
  verdict=1
fi

if [ "${DEPLOY_PROOF_SKIP_RUNTIME:-0}" != "1" ]; then
  MANIFEST="$PGDIR/runtime_manifest.sql"; : > "$MANIFEST"
  for f in $(ls "$HARNESS/runtime_test.d"/*.sql | sort); do
    printf '%s\n' "\\echo '-- plik $(basename "$f")'" "\\i $f" >> "$MANIFEST"
  done
  set +e
  psql -d nes -q -v ON_ERROR_STOP=1 -v manifest="$MANIFEST" \
       -f "$HARNESS/runtime_test.sql" > "$OUT/runtime.out" 2>&1
  rc=$?
  set -e
  passed="$(grep -cE 'NOTICE: +ok +' "$OUT/runtime.out" || true)"
  if [ "$rc" -eq 0 ]; then
    say "asercje runtime na kolejnosci produkcyjnej: OK ($passed)"
  else
    say "asercje runtime na kolejnosci produkcyjnej: CZERWONE (zdanych przed bledem: $passed, $OUT/runtime.out)"
    { grep -E "ERROR|ASERCJA" "$OUT/runtime.out" || true; } | head -5 | tee -a "$OUT/summary.txt"
    verdict=1
  fi
fi
# Zapytanie weryfikujace tylko po zielonym dowodzie (funkcja verify_query wyzej).
# Klaster dowodu nie jest juz potrzebny - schodzi przed pelnym odtworzeniem.
if [ "$verdict" -eq 0 ]; then
  run_as "pg_ctl -D $PGDIR/data stop" >/dev/null 2>&1 || true
  verify_query || verdict=1
fi
if [ "$verdict" -eq 0 ]; then say "DOWOD KOLEJNOSCI: OK ($ORDER)"; else say "DOWOD KOLEJNOSCI: CZERWONY ($ORDER)"; fi
exit "$verdict"
