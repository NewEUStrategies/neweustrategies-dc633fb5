#!/usr/bin/env bash
# Stawia lokalny PostgreSQL, tworzy atrape platformy (harness.sql), aplikuje
# PRAWDZIWE migracje izolacji tenantow z supabase/migrations i wykonuje asercje
# runtime RLS dla plaszczyzny wlasciciela (media_mentions / saved_searches /
# user_follows i dalsze) oraz - od 2026-09-01 - dla plaszczyzny czatu.
#
# Migracje wchodza DWOMA etapami, bo dowodza dwoch roznych rzeczy:
#   1. CALE PLIKI, dobierane po tresci (nazwy polityk / nazwa ograniczenia).
#      Tam przedmiotem dowodu jest takze schemat i cialo funkcji.
#   2. SAME INSTRUKCJE POLITYK czatu, wycinane z migracji doslownie przez
#      `extract_chat_policies.awk`. Uzasadnienie stoi przy samym etapie.
#
# Patrz scripts/tenant-isolation-harness/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PGDIR="${TENANT_HARNESS_DIR:-/tmp/nes-tenant-pg}"
KEEP=0
for arg in "$@"; do
  case "$arg" in --keep) KEEP=1 ;; esac
done

PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
# Fallback: initdb juz na PATH (obrazy bez /usr/lib/postgresql, lokalny sandbox).
if [ -z "$PGBIN" ] && command -v initdb >/dev/null 2>&1; then
  PGBIN="$(dirname "$(command -v initdb)")"
fi
if [ -z "$PGBIN" ]; then echo "Brak PostgreSQL. Zainstaluj postgresql-16." >&2; exit 2; fi
export PATH="$PGBIN:$PATH"

# initdb odmawia pracy jako root - potrzebny konto nieuprzywilejowane.
RUNAS="$(id -un)"
if [ "$RUNAS" = "root" ]; then
  if id -un postgres >/dev/null 2>&1; then
    RUNAS=postgres
  elif command -v useradd >/dev/null 2>&1; then
    useradd -m -s /bin/bash postgres
    RUNAS=postgres
  else
    RUNAS="$(awk -F: '$3>=1000 && $1!="nobody" {print $1; exit}' /etc/passwd)"
    [ -n "$RUNAS" ] || { echo "Brak konta nie-root do uruchomienia initdb." >&2; exit 2; }
  fi
fi

pg_ctl -D "$PGDIR/data" stop >/dev/null 2>&1 || true
rm -rf "$PGDIR"; mkdir -p "$PGDIR/data" "$PGDIR/run"
RUNAS_UID="$(id -u "$RUNAS")"
RUNAS_GID="$(id -g "$RUNAS")"
[ "$(id -un)" = "root" ] && chown -R "$RUNAS_UID:$RUNAS_GID" "$PGDIR"

run_as() {
  if [ "$(id -un)" != "root" ]; then eval "$*"; return; fi
  # `su`/`runuser` wymagaja PAM, ktorego czesc obrazow nie ma - `setpriv`
  # przelacza uid/gid bez niego i jest dostepny w util-linux.
  if command -v su >/dev/null 2>&1; then
    su "$RUNAS" -c "PATH=$PGBIN:\$PATH $*"
  else
    setpriv --reuid="$RUNAS_UID" --regid="$RUNAS_GID" --clear-groups \
      env PATH="$PGBIN:$PATH" HOME="$PGDIR" bash -c "$*"
  fi
}

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

psql -q -d nes -v ON_ERROR_STOP=1 -f "$HERE/harness.sql" >/dev/null
echo "harness: OK"

# Migracja izolacji tenantow - dobierana po TRESCI, nie po nazwie pliku (panel
# nadaje migracjom losowe UUID-y). Pusty zestaw to blad, nie sukces.
#
# 2026-08-31 (2): selektor dostal DRUGIE ramie, bo domkniecie kanonicznej
# sciezki strony (20260831160000) NIE TWORZY ZADNEJ POLITYKI - naprawia cialo
# funkcji i schemat. Pierwsze ramie szuka nazw polityk i tej migracji nie
# widzialo, wiec harness aplikowalby atrape i sam ja testowal. Dlatego drugie
# ramie celuje w nazwe ograniczenia, ktore ta migracja zaklada.
MIGRATIONS="$(grep -lE 'POLICY "(media_mentions owner|saved_searches owner|follows owner|purchases owner read|subs owner read|grants own read|seats own read|gift links owner read|Users can view own subscription|read_history owner|personality_history_owner_read)|pages_parent_same_tenant_fkey' \
  "$REPO"/supabase/migrations/*.sql | sort -u)"
count="$(echo "$MIGRATIONS" | grep -c . || true)"
echo "Migracje dotykajace plaszczyzny wlasciciela: $count"
[ "$count" -gt 0 ] || { echo "Zero migracji w zestawie - selektor nie trafil."; exit 1; }

for f in $MIGRATIONS; do
  name="$(basename "$f")"
  # Caly plik, w jednej transakcji. Pliki zalozycielskie niosa tez CREATE TABLE
  # calych modulow, ktorych atrapa nie ma - taki plik wywraca sie w calosci
  # i laduje jako SKIP. To jest bezpieczne DOPOKI polityka, ktora ma udowodnic
  # asercja, powstaje w pliku, ktory przechodzi; dla plaszczyzny czatu tak nie
  # bylo i dlatego ma ona osobny etap nizej.
  if out="$(psql -q -d nes -v ON_ERROR_STOP=1 --single-transaction -f "$f" 2>&1)"; then
    printf '  OK   %s\n' "$name"
  else
    printf '  SKIP %s (poza zakresem atrapy)\n' "$name"
  fi
done

# ---------------------------------------------------------------------------
# ETAP 2 (2026-09-01): PLASZCZYZNA CZATU - POLITYKI Z MIGRACJI, BEZ RESZTY PLIKU
#
# DLACZEGO INNY TRYB NIZ WYZEJ. Etap 1 aplikuje CALE pliki i tak ma zostac:
# tam migracja niesie takze schemat i cialo funkcji, ktore SA przedmiotem
# dowodu. Migracje polityk czatu sa natomiast ZLEPKAMI - jeden plik niesie
# polityke czatu obok `storage.buckets`, `notifications`, `content_access`,
# `author_profiles`, tabel sieci kontaktow i kilkunastu funkcji obcych
# modulow. Zeby taki plik przeszedl w calosci, atrapa musialaby postawic
# kilkanascie tabel spoza modulu 09, a kazda taka atrapa to kolejne
# NIEZWERYFIKOWANE zdanie o ksztalcie cudzej tabeli (ten sam argument stoi
# w `scripts/careers-harness/run.sh` przy jawnych pominieciach).
#
# DLACZEGO TO NADAL SA PRAWDZIWE MIGRACJE. `extract_chat_policies.awk`
# kopiuje instrukcje `CREATE POLICY` / `DROP POLICY` BAJT W BAJT, bez
# przepisywania i bez sklejania. Pliki ida chronologicznie, instrukcje w
# kolejnosci wystapienia, wiec idiom repo „DROP POLICY IF EXISTS x;
# CREATE POLICY x …" daje ten sam STAN KONCOWY, co pelny przebieg - dokladnie
# tak, jak liczy go `src/lib/ci/rlsPolicies.ts`.
#
# DLACZEGO BEZ `--single-transaction` I BEZ SKIP-a. Kazda instrukcja idzie we
# wlasnej transakcji, a `ON_ERROR_STOP` przerywa na pierwszym bledzie i konczy
# bramke czerwono. Cicha porazka calego wsadu (jak SKIP w etapie 1) dalaby
# zielona bramke bez ani jednej polityki czatu, czyli asercje ponizej
# mierzylyby stol.
# ---------------------------------------------------------------------------
echo
CHAT_SQL="$PGDIR/chat_policies.sql"
: > "$CHAT_SQL"
for f in "$REPO"/supabase/migrations/*.sql; do
  awk -f "$HERE/extract_chat_policies.awk" "$f" >> "$CHAT_SQL"
done
chat_stmts="$(grep -c ';$' "$CHAT_SQL" || true)"
echo "Instrukcje polityk czatu wyciete z migracji: $chat_stmts"
[ "$chat_stmts" -gt 0 ] || { echo "Zero instrukcji - ekstraktor polityk czatu nie trafil."; exit 1; }
if ! out="$(psql -q -d nes -v ON_ERROR_STOP=1 -f "$CHAT_SQL" 2>&1)"; then
  echo "Polityki czatu NIE daly sie zalozyc na atrapie:"
  echo "$out" | tail -12 | sed 's/^/  /'
  exit 1
fi
echo "  OK   polityki czatu zalozone z tresci migracji"

# STRAZNIK STANU KONCOWEGO. Ekstraktor moglby przepuscic komplet instrukcji
# i mimo to zostawic inny zestaw polityk niz produkcja (np. gdyby ktos dodal
# migracje kasujaca polityke bez odtworzenia). Lista jest ta sama, ktora
# przypina statyczna bramka `src/lib/ci/__tests__/chatPolicyContract.test.ts` -
# rozjazd miedzy bramka statyczna a wykonawcza ma byc GLOSNY.
missing="$(psql -tAq -d nes <<'SQL'
WITH oczekiwane(tablename, policyname) AS (VALUES
  ('conversations', 'conversations_member_select'),
  ('conversations', 'conversations_staff_read'),
  ('conversations', 'conversations_staff_delete'),
  ('conversation_participants', 'conversation_participants_member_select'),
  ('conversation_nicknames', 'conversation_nicknames_member_select'),
  ('messages', 'messages_member_select'),
  ('messages', 'messages_member_insert'),
  ('messages', 'messages_sender_update'),
  ('messages', 'messages_staff_read'),
  ('messages', 'messages_staff_update'),
  ('message_reactions', 'message_reactions_member_select'),
  ('message_reactions', 'message_reactions_own_insert'),
  ('message_reactions', 'message_reactions_own_update'),
  ('message_reactions', 'message_reactions_own_delete'),
  ('message_stars', 'message_stars_own_select'),
  ('message_stars', 'message_stars_own_insert'),
  ('message_stars', 'message_stars_own_delete'),
  ('user_blocks', 'user_blocks_owner_select'),
  ('user_blocks', 'user_blocks_owner_insert'),
  ('user_blocks', 'user_blocks_owner_delete'),
  ('expert_inmails', 'expert_inmails: participants and admin may read'),
  ('expert_inmails', 'expert_inmails: no direct insert'),
  ('expert_inmails', 'expert_inmails: sender may cancel own request'),
  ('expert_inmails', 'expert_inmails: recipient may respond'),
  ('expert_inmails', 'expert_inmails: admin may update')
)
SELECT string_agg(o.tablename || '::' || o.policyname, ', ')
  FROM oczekiwane o
 WHERE NOT EXISTS (
   SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = o.tablename
      AND p.policyname = o.policyname
 );
SQL
)"
if [ -n "$missing" ]; then
  echo "Brakuje polityk czatu w stanie koncowym: $missing"
  exit 1
fi
echo "  OK   stan koncowy polityk czatu zgodny z kontraktem statycznym"

echo
set +e
psql -d nes -q -f "$HERE/runtime_test.sql" > "$PGDIR/runtime.out" 2>&1
rc=$?
set -e
sed 's/psql:[^ ]* //;s/NOTICE:  //' "$PGDIR/runtime.out" \
  | grep -E "^==|  ok |ERROR|ASERCJA" || true

passed="$(grep -cE 'NOTICE: +ok +' "$PGDIR/runtime.out" || true)"
echo
if [ "$rc" -ne 0 ]; then
  echo "Testy RLS NIE przeszly (asercji zdanych przed bledem: $passed)."
  [ "$KEEP" -eq 1 ] && echo "Baza zostaje: PGHOST=$PGDIR/run PGPORT=5434 psql -d nes"
  exit 1
fi
[ "$passed" -gt 0 ] || { echo "Zero asercji - test nic nie sprawdzil."; exit 1; }
echo "Testy RLS OK ($passed asercji)."
exit 0
