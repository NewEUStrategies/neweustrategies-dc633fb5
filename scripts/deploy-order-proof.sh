#!/usr/bin/env bash
# PO CO TEN PLIK ISTNIEJE
# Dowod na PRAWDZIWYM PostgreSQL, ze KOLEJNOSC, w jakiej produkcja dostaje
# migracje, daje ten sam stan koncowy, co odtworzenie w kolejnosci WERSJI
# (tak odtwarzaja baze CI, pgTAP i scripts/events-harness/run.sh).
#
# PRZYCZYNA. Lovable wdraza migracje przez migrator drizzle, a ten wykonuje
# KAZDY wpis `drizzle/migrations/meta/_journal.json`, ktorego baza jeszcze nie
# zapisala - w kolejnosci dziennika, nie wersji supabase. 2026-09-27 przy
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
# UZYCIE
#   bash scripts/deploy-order-proof.sh scripts/deploy-order/produkcja.txt
#   DEPLOY_PROOF_DIR / DEPLOY_PROOF_PORT  klaster (domyslnie /tmp/nes-order-proof, 5482)
#   DEPLOY_PROOF_SKIP_RUNTIME=1           bez asercji runtime
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
ORDER="${1:?Podaj plik kolejnosci (np. scripts/deploy-order/produkcja.txt)}"
PGDIR="${DEPLOY_PROOF_DIR:-/tmp/nes-order-proof}"
PGPORT_PROOF="${DEPLOY_PROOF_PORT:-5482}"
OUT="$PGDIR/out"
MIG="$REPO/supabase/migrations"
HARNESS="$REPO/scripts/events-harness"

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
[ "${#LISTED[@]}" -gt 0 ] || fail "plik kolejnosci nie wymienia zadnej migracji"
[[ "$LINE" =~ ^[0-9]{14}$ ]] || fail "LINIA musi byc wersja z 14 cyfr, jest '$LINE'"

ALL=()
while IFS= read -r f; do ALL+=("$(basename "$f")"); done < <(grep -lE "$SEL" "$MIG"/*.sql | sort -u)
in_set() { local x; for x in "${ALL[@]}"; do [ "$x" = "$1" ] && return 0; done; return 1; }
listed() { local x; for x in "${LISTED[@]}"; do [ "$x" = "$1" ] && return 0; done; return 1; }

BASE=()
for b in "${ALL[@]}"; do
  if [[ "${b%%_*}" > "$LINE" ]]; then
    listed "$b" || fail "$b (nowsza od linii $LINE) nie wystepuje w pliku kolejnosci"
  else
    BASE+=("$b")
  fi
done
PLAN=(); SKIPPED=()
for b in "${LISTED[@]}"; do
  if in_set "$b"; then PLAN+=("$b"); else SKIPPED+=("$b"); fi
done

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
run_as "pg_ctl -D $PGDIR/data stop" >/dev/null 2>&1 || true
rm -rf "$PGDIR"; mkdir -p "$PGDIR/data" "$PGDIR/run" "$OUT"
[ "$(id -un)" = "root" ] && chown -R "$RUNAS" "$PGDIR"
run_as "initdb -D $PGDIR/data -U postgres --auth=trust -E UTF8 --locale=C" >/dev/null
run_as "pg_ctl -D $PGDIR/data -o '-k $PGDIR/run -p $PGPORT_PROOF -c listen_addresses=\"\"' -l $PGDIR/pg.log start" >/dev/null
sleep 2
export PGHOST="$PGDIR/run" PGPORT="$PGPORT_PROOF" PGUSER=postgres
trap 'run_as "pg_ctl -D $PGDIR/data stop" >/dev/null 2>&1 || true' EXIT

psql -q -d postgres -c "CREATE DATABASE stub;" >/dev/null
psql -q -d stub -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SQL
psql -q -d stub -v ON_ERROR_STOP=1 -f "$HARNESS/harness.sql" >/dev/null
psql -q -d postgres -c "CREATE DATABASE ref TEMPLATE stub;" -c "CREATE DATABASE nes TEMPLATE stub;" >/dev/null

: > "$OUT/summary.txt"
say() { echo "$*" | tee -a "$OUT/summary.txt"; }
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
# ZAPYTANIE WERYFIKUJACE PO WDROZENIU (tylko odczyt, na produkcje). Stan
# oczekiwany = baza `ref`, zakres = obiekty zakladane przez pliki nowsze od
# linii (generator: scripts/deploy-order/weryfikacja.generator.sql).
if [ "$verdict" -eq 0 ]; then
  NEWER=()
  for b in "${ALL[@]}"; do [[ "${b%%_*}" > "$LINE" ]] && NEWER+=("$MIG/$b"); done
  sed 's/--.*//' "${NEWER[@]}" | tr 'A-Z' 'a-z' > "$OUT/newer.sql"
  # Nazwy jako tablica tekstowa PostgreSQL: {a,b,c}.
  names_of() {
    { grep -oE "$1" "$OUT/newer.sql" || true; } | awk '{print $NF}' \
      | sed -E 's/^public\.//' | sort -u | paste -sd, - | sed 's/^/{/; s/$/}/'
  }
  psql -d ref -q -v ON_ERROR_STOP=1 \
    -v fns="$(names_of 'create +(or +replace +)?function +(public\.)?[a-z_0-9]+')" \
    -v tabs="$(names_of 'create +table +(if +not +exists +)?(public\.)?[a-z_0-9]+')" \
    -v alts="$(names_of 'alter +table +(if +exists +)?(only +)?(public\.)?[a-z_0-9]+')" \
    -v cols="$(names_of 'add +column +(if +not +exists +)?[a-z_0-9]+')" \
    -v trgs="$(names_of 'create +trigger +[a-z_0-9]+')" \
    -v src="$(basename "$ORDER"), linia $LINE" \
    -f "$HERE/deploy-order/weryfikacja.generator.sql" > "$OUT/weryfikacja.sql"
  say "zapytanie weryfikujace: $OUT/weryfikacja.sql ($(wc -c < "$OUT/weryfikacja.sql") B)"
  if [ -n "${DEPLOY_PROOF_WRITE_VERIFY:-}" ]; then
    cp "$OUT/weryfikacja.sql" "$DEPLOY_PROOF_WRITE_VERIFY"
    say "  zapisane do $DEPLOY_PROOF_WRITE_VERIFY"
  fi
fi
if [ "$verdict" -eq 0 ]; then say "DOWOD KOLEJNOSCI: OK ($ORDER)"; else say "DOWOD KOLEJNOSCI: CZERWONY ($ORDER)"; fi
exit "$verdict"
