-- migrations-mirror: supabase/migrations/20261025090020_profiles_discoverable_decision_stamp.sql
-- WYGENEROWANE przez `bun run migrations:mirror` z pliku wyzej - NIE EDYTUJ RECZNIE.
-- Zrodlo prawdy schematu: supabase/migrations. Ten plik to kopia dostawcza dla
-- migratora Drizzle platformy Lovable (drizzle.config.ts); bramka
-- check:migration-lanes pilnuje, ze jego SQL wykonywalny == zrodlo.

-- ============================================================================
-- profiles.discoverable: ZNACZNIK DECYZJI WŁAŚCICIELA PROFILU
-- (`profiles.discoverable_decided_at`).
--
-- DEFEKT
--   `profiles.discoverable` jest zgodą na widoczność w katalogu osób wyrażoną
--   WPROST (20260913150000), ale baza nie zapisuje FAKTU decyzji: true
--   z przełącznika właściciela, z DEFAULT-u i z operacji systemowej wygląda
--   identycznie. Dlatego skutki hurtowego UPDATE z wpisu dziennika
--   `drizzle/migrations/0001_profiles_discoverable_default_true.sql`
--   (2026-09-11) da się cofnąć tylko tam, gdzie znaczniki czasu wiersza
--   dowodzą braku decyzji (20261025090030), a resztę trzeba rozstrzygnąć
--   ponownym pytaniem. RODO art. 7 ust. 1: administrator musi umieć WYKAZAĆ
--   zgodę - bez znacznika decyzji nie umie.
--
-- ZMIANA
--   1. Kolumna `discoverable_decided_at timestamptz`, bez DEFAULT-u. NULL znaczy:
--      wartość `discoverable` pochodzi z DEFAULT-u albo z operacji systemowej,
--      nie z decyzji właściciela.
--   2. Wyzwalacz `profiles_discoverable_decision_stamp_trg`,
--      BEFORE INSERT OR UPDATE OF discoverable:
--      * INSERT zawsze zeruje znacznik. Rejestracja bierze DEFAULT
--        (`handle_new_user()` nie wymienia kolumny), więc to nie jest decyzja;
--        `authenticated` ma na `profiles` tabelowy grant INSERT, więc bez tego
--        klient wstawiłby sobie dowolny znacznik.
--      * UPDATE z `discoverable` na liście SET pod sesją właściciela
--        (`auth.uid() = NEW.id`) stempluje `now()` - także bez zmiany wartości:
--        ponowne potwierdzenie też jest decyzją. Przełącznik
--        (`useSetDiscoverable` w src/lib/chat/useDiscoverable.ts) wysyła
--        wartość wprost pod sesją właściciela, więc stempluje bez zmian
--        w kliencie.
--      * UPDATE administratora, service_role i migracji (`auth.uid()` NULL albo
--        inne konto) znacznika nie rusza - to nie jest decyzja właściciela.
--        Także cofnięcie z 20261025090030 zostawia NULL.
--   Klient nie dostaje grantu na kolumnę: `authenticated` ma na `profiles`
--   wyłącznie kolumnowe granty SELECT/UPDATE, więc odczyt i zapis nowej kolumny
--   kończą się 42501. Kolumna nie wchodzi do widoku `profiles_public` ani do
--   publicznych stałych kolumn w TS.
--
-- KOLEJNOŚĆ WYZWALACZY
--   Wyzwalacze BEFORE odpalają alfabetycznie; ten stoi między
--   `profiles_completeness_trg` a `profiles_discovery_search_trg`. Żaden inny
--   wyzwalacz na `profiles` nie czyta ani nie pisze `discoverable` ani tej
--   kolumny, więc kolejność nie zmienia wyniku. `UPDATE OF discoverable`
--   patrzy na listę SET polecenia, nie na zmianę wartości - stąd stempel przy
--   potwierdzeniu bez zmiany.
--
-- OGRANICZENIE
--   Sesja „Zaloguj jako" (src/lib/admin/impersonation.functions.ts) to
--   prawdziwa sesja konta docelowego: przełącznik użyty w niej stempluje jak
--   decyzja właściciela. Każde podszycie jest w `impersonation_sessions`, więc
--   taki stempel da się odróżnić po czasie.
--
-- BLOKADY
--   ADD COLUMN bez DEFAULT-u zmienia tylko katalog, ale bierze ACCESS EXCLUSIVE
--   na `profiles` do końca wsadu migratora. `lock_timeout` 5 s: zamiast kolejki
--   wszystkich odczytów profili za długą transakcją - szybkie 55P03 (runbook
--   pozwala ponowić). SET na najwyższym poziomie obowiązuje do końca wsadu
--   (generator lustra zgłasza to ostrzeżeniem `ustawienie-sesji`) - świadomie,
--   tak jak w plikach 20261020090000-090400.
--
-- IDEMPOTENTNE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP/CREATE
-- wyzwalacza; drugi przebieg nie zmienia stanu.
-- Nośnik w dzienniku drizzle generuje `bun run migrations:mirror`; nikt nie
-- pisze go ręcznie.
-- Test: supabase/tests/profiles_discoverable_decision_stamp_test.sql.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discoverable_decided_at timestamptz;

COMMENT ON COLUMN public.profiles.discoverable_decided_at IS
  'Chwila ostatniej decyzji WŁAŚCICIELA profilu o discoverable (UPDATE z discoverable na liście SET pod auth.uid() = id, także bez zmiany wartości - potwierdzenie). NULL: wartość z DEFAULT-u albo z operacji systemowej. Pisze wyłącznie wyzwalacz profiles_discoverable_decision_stamp_trg; klient nie ma grantu na tę kolumnę.';

CREATE OR REPLACE FUNCTION public.profiles_discoverable_decision_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.discoverable_decided_at := NULL;
  ELSIF auth.uid() IS NOT NULL AND auth.uid() = NEW.id THEN
    NEW.discoverable_decided_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.profiles_discoverable_decision_stamp() IS
  'Wyzwalacz profiles_discoverable_decision_stamp_trg: INSERT zeruje discoverable_decided_at, UPDATE OF discoverable pod sesją właściciela (auth.uid() = id) stempluje now(); administrator, service_role i migracja znacznika nie ruszają.';

REVOKE ALL ON FUNCTION public.profiles_discoverable_decision_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_discoverable_decision_stamp_trg ON public.profiles;
CREATE TRIGGER profiles_discoverable_decision_stamp_trg
  BEFORE INSERT OR UPDATE OF discoverable ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_discoverable_decision_stamp();
