#!/usr/bin/env bash
# PO CO TEN PLIK ISTNIEJE
# Dowod na PRAWDZIWYM PostgreSQL, ze podzial migracji przez
# scripts/split-migration.ts nie zmienil wyniku. Test jednostkowy
# (src/lib/ci/migrationSplit.ts) dowodzi rownosci TEKSTU: SQL wykonywalny czesci
# sklejonych po kolei == SQL oryginalu. Ten skrypt dowodzi rownosci SKUTKU:
# dwie swieze bazy z TYM SAMYM stanem poprzedzajacym, jedna dostaje oryginal,
# druga czesci 1..n po kolei, a potem porownujemy `pg_dump --schema-only`
# (i `--data-only` z zamaskowanymi uuid/czasem, bo atrapy sieja wiersze
# z gen_random_uuid() i now()). Roznica chocby o jeden GRANT, komentarz czy
# domyslna wartosc kolumny konczy sie kodem 1.
#
# STAN POPRZEDZAJACY stawiamy jak scripts/events-harness/run.sh: klaster
# initdb C/UTF8, role Supabase, atrapy harness.sql i WSZYSTKIE migracje
# wybrane selektorem harnessu wydarzen (wzorzec czytany z run.sh, nie
# kopiowany), o nazwie mniejszej od dzielonej migracji. Baza bazowa jest
# SZABLONEM obu baz dowodu, wiec stan poprzedzajacy jest identyczny z definicji.
#
# CZEGO TEN PLIK NIE SPRAWDZA
#   * migracji spoza zestawu harnessu wydarzen - reszta platformy jest tu
#     atrapa, wiec skrypt odmawia zamiast dowodzic na nieprawdziwym stanie;
#   * okna MIEDZY czesciami (to pilnuja grupy nierozlaczne w migrationSplit.ts);
#   * zachowania runtime - to robi pelny przebieg run.sh na drzewie z czesciami.
#
# UZYCIE (z katalogu repozytorium, po `bun run scripts/split-migration.ts`):
#   bash scripts/split-migration-proof.sh supabase/migrations/<plik>.sql [<ref>]
#     <ref>  rewizja git z ORYGINALEM sprzed podzialu (domyslnie HEAD);
#            czesci skrypt bierze z drzewa roboczego.
#   SPLIT_PROOF_ORIGINAL=<sciezka>  oryginal z pliku zamiast z git
#   SPLIT_PROOF_REPO=<katalog>      drzewo z czesciami (domyslnie to repozytorium)
#   SPLIT_PROOF_DIR / SPLIT_PROOF_PORT  klaster (domyslnie /tmp/nes-split-proof, 5481)
#   SPLIT_PROOF_OUT                 wyniki (domyslnie $SPLIT_PROOF_DIR/out)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${SPLIT_PROOF_REPO:-$(cd "$HERE/.." && pwd)}"
TARGET="$(basename "${1:?Podaj plik: supabase/migrations/<wersja>_<nazwa>.sql}")"
REF="${2:-HEAD}"
PGDIR="${SPLIT_PROOF_DIR:-/tmp/nes-split-proof}"
PGPORT_PROOF="${SPLIT_PROOF_PORT:-5481}"
OUT="${SPLIT_PROOF_OUT:-$PGDIR/out}"
MIG="$REPO/supabase/migrations"
LABEL="${TARGET#*_}"; LABEL="${LABEL%.sql}"

fail() { echo "ODMOWA: $*" >&2; exit 2; }
[ -f "$MIG/$TARGET" ] || fail "brak $MIG/$TARGET"

# Wzorzec selektora czytany z run.sh - kopia rozjechalaby sie po cichu.
SEL="$(sed -nE "s/^MIGRATIONS=\"\\\$\(grep -lE '([^']+)'.*/\1/p" "$REPO/scripts/events-harness/run.sh")"
[ -n "$SEL" ] || fail "nie znalazlem selektora migracji w scripts/events-harness/run.sh"

PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
[ -n "$PGBIN" ] || fail "brak PostgreSQL (postgresql-16)"
export PATH="$PGBIN:$PATH"

# Czesci: plik docelowy (czesc 1) i pliki `<wersja>_<nazwa>_part<k>.sql`
# z naglowkiem `migration-split: part k/n of <plik>` - po numerze czesci.
TARGET_RE="${TARGET//./\\.}"
N="$(sed -nE "s/^-- migration-split: part 1\/([0-9]+) of ${TARGET_RE}$/\1/p" "$MIG/$TARGET" | head -1)"
[ -n "$N" ] || fail "$TARGET nie jest czescia 1 podzielonej migracji (brak stopki migration-split)"
PARTS=("$MIG/$TARGET")
for k in $(seq 2 "$N"); do
  hit=""
  for f in "$MIG"/*_"${LABEL}"_part"$k".sql; do
    [ -f "$f" ] && grep -qxF -- "-- migration-split: part $k/$N of $TARGET" "$f" && hit="$f"
  done
  [ -n "$hit" ] || fail "brak czesci $k/$N migracji $TARGET"
  PARTS+=("$hit")
done

mkdir -p "$OUT"
if [ -n "${SPLIT_PROOF_ORIGINAL:-}" ]; then
  cp "$SPLIT_PROOF_ORIGINAL" "$OUT/original.sql"
else
  git -C "$REPO" show "$REF:supabase/migrations/$TARGET" > "$OUT/original.sql" \
    || fail "brak $TARGET w rewizji $REF"
fi
grep -q "migration-split: part 1/" "$OUT/original.sql" \
  && fail "oryginal z $REF jest juz czescia 1 - podaj rewizje sprzed podzialu"
grep -qE "$SEL" "$OUT/original.sql" \
  || fail "$TARGET nie nalezy do zestawu harnessu wydarzen - stan poprzedzajacy bylby atrapa"
for p in "${PARTS[@]}"; do
  grep -qE "$SEL" "$p" || fail "$(basename "$p") wypada z selektora harnessu wydarzen"
done

# Stan poprzedzajacy: migracje harnessu wydarzen PRZED dzielona, bez niej i jej czesci.
PRIOR=()
while IFS= read -r f; do
  b="$(basename "$f")"
  [[ "$b" < "$TARGET" ]] && PRIOR+=("$f")
done < <(grep -lE "$SEL" "$MIG"/*.sql | sort -u)

RUNAS="$(id -un)"
if [ "$RUNAS" = "root" ]; then
  id -un postgres >/dev/null 2>&1 || useradd -m -s /bin/bash postgres
  RUNAS=postgres
fi
run_as() { if [ "$(id -un)" = "root" ]; then su "$RUNAS" -c "PATH=$PGBIN:\$PATH $*"; else eval "$*"; fi; }
run_as "pg_ctl -D $PGDIR/data stop" >/dev/null 2>&1 || true
rm -rf "$PGDIR/data" "$PGDIR/run"; mkdir -p "$PGDIR/data" "$PGDIR/run"
if [ "$(id -un)" = "root" ]; then chown "$RUNAS" "$PGDIR"; chown -R "$RUNAS" "$PGDIR/data" "$PGDIR/run"; fi
run_as "initdb -D $PGDIR/data -U postgres --auth=trust -E UTF8 --locale=C" >/dev/null
run_as "pg_ctl -D $PGDIR/data -o '-k $PGDIR/run -p $PGPORT_PROOF -c listen_addresses=\"\"' -l $PGDIR/pg.log start" >/dev/null
sleep 2
export PGHOST="$PGDIR/run" PGPORT="$PGPORT_PROOF" PGUSER=postgres
trap 'run_as "pg_ctl -D $PGDIR/data stop" >/dev/null 2>&1 || true' EXIT

psql -q -d postgres -c "CREATE DATABASE base;" >/dev/null
psql -q -d base -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SQL
psql -q -d base -v ON_ERROR_STOP=1 -f "$REPO/scripts/events-harness/harness.sql" >/dev/null
ok=0; bad=0
for f in "${PRIOR[@]}"; do
  if psql -q -d base -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1; then ok=$((ok + 1)); else bad=$((bad + 1)); echo "FAIL $(basename "$f")"; fi
done > "$OUT/prior.log"
psql -q -d postgres -c "CREATE DATABASE orig TEMPLATE base;" -c "CREATE DATABASE split TEMPLATE base;" >/dev/null

: > "$OUT/summary.txt"
say() { echo "$*" | tee -a "$OUT/summary.txt"; }
say "Stan poprzedzajacy: ${#PRIOR[@]} migracji harnessu wydarzen przed $TARGET ($ok OK, $bad FAIL - identycznie w obu bazach, bo to jeden szablon)."
if ! psql -q -d orig -v ON_ERROR_STOP=1 -f "$OUT/original.sql" > "$OUT/apply-orig.log" 2>&1; then
  say "ORYGINAL NIE PRZESZEDL ($OUT/apply-orig.log)"; exit 1
fi
say "orig:  $TARGET z ${SPLIT_PROOF_ORIGINAL:-$REF} ($(wc -c < "$OUT/original.sql") B) OK"
: > "$OUT/apply-split.log"
for p in "${PARTS[@]}"; do
  if ! psql -q -d split -v ON_ERROR_STOP=1 -f "$p" >> "$OUT/apply-split.log" 2>&1; then
    say "CZESC $(basename "$p") NIE PRZESZLA ($OUT/apply-split.log)"; exit 1
  fi
  say "split: $(basename "$p") ($(wc -c < "$p") B) OK"
done

# pg_dump 16.10+ otacza zrzut `\restrict <losowy klucz>` - staly klucz (albo,
# w starszym pg_dump, brak tych linii) zeby dwa zrzuty dalo sie porownac.
# Pomoc czytamy do zmiennej: `pg_dump --help | grep -q` przy `pipefail`
# potrafi dostac SIGPIPE i po cichu zgubic klucz.
RK=""
PGDUMP_HELP="$(pg_dump --help)"
[[ "$PGDUMP_HELP" == *--restrict-key* ]] && RK="--restrict-key=splitproof"
for db in orig split; do
  pg_dump --schema-only $RK -d "$db" > "$OUT/schema-$db.sql"
  pg_dump --data-only $RK -d "$db" 2>/dev/null \
    | sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<uuid>/g; s/[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?\+00/<ts>/g' \
    > "$OUT/data-$db.sql"
done

verdict=0
if diff -u "$OUT/schema-orig.sql" "$OUT/schema-split.sql" > "$OUT/schema.diff"; then
  say "pg_dump --schema-only: IDENTYCZNE ($(wc -l < "$OUT/schema-orig.sql") linii, sha256 $(sha256sum < "$OUT/schema-orig.sql" | cut -c1-16))"
else
  say "pg_dump --schema-only: ROZNE ($(grep -cE '^[-+][^-+]' "$OUT/schema.diff") linii roznicy, $OUT/schema.diff)"
  verdict=1
fi
if diff -u "$OUT/data-orig.sql" "$OUT/data-split.sql" > "$OUT/data.diff"; then
  say "pg_dump --data-only (uuid/czas zamaskowane): IDENTYCZNE ($(grep -c '^COPY ' "$OUT/data-orig.sql") tabel z danymi)"
else
  say "pg_dump --data-only: ROZNE ($OUT/data.diff)"
  verdict=1
fi
if [ "$verdict" -eq 0 ]; then say "DOWOD: OK ($TARGET, $N czesci)"; else say "DOWOD: CZERWONY ($TARGET)"; fi
exit "$verdict"
