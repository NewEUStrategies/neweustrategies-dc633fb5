-- events-harness: include
-- ============================================================================
-- WYDARZENIA: USUNIECIE KLUBU DYSKUSJI NIE ODBIJA SIE OD CHECK-a PARY
-- KLUB / GRUPA (przekazanie B2, klasa OPS-11 / R10).
--
-- CZESC 3/3 poprawek po koncowym przegladzie skanera (opis serii -
-- 20261012150000).
--
-- PROBLEM. `events.discussion_club_id` -> `clubs(id)` jest ON DELETE SET NULL
-- (20260827065944), a CHECK `events_discussion_group_needs_club` wymaga
-- klubu, gdy jest grupa. Akcja klucza obcego zeruje SAM klub, wiec wiersz
-- wydarzenia z przypieta grupa lamie CHECK (23514) i usuniecie klubu
-- przepada w calosci - takze wtedy, gdy grupa nalezy do tego klubu (kaskada
-- `club_groups.club_id` nie zdazy wyzerowac grupy przed sprawdzeniem
-- CHECK-a) i tym bardziej, gdy wydarzenie wskazuje grupe innego klubu (para
-- niespojna, czytana jak brak przypiecia). Rejestr kluczy SET NULL w 56
-- trzymal te pare jako `handoff`.
--
-- ZMIANA: trigger BEFORE UPDATE OF discussion_club_id na `events` - gdy klub
-- znika (stary niepusty, nowy pusty), a grupa zostala, grupa tez jest
-- zerowana. Ta sama technika, co R10 (20261012111000): wiersz naprawia sie
-- przy SET NULL, zamiast odbijac sie od CHECK-a. Klucz obcy w formie PG15
-- `SET NULL (kolumny)` nie wystarcza - grupa nie jest kolumna tego klucza.
-- Para "klub bez grupy" pozostaje stanem dozwolonym; wstawienie albo
-- zmiana, ktora ustawia grupe BEZ klubu (stary klub tez pusty), nadal
-- konczy sie bledem CHECK-a. Redakcja, ktora czysci klub, czysci tym samym
-- grupe (grupa bez klubu nie da sie przypiac).
--
-- IDEMPOTENTNA: CREATE OR REPLACE, DROP TRIGGER IF EXISTS + CREATE.
-- DOWOD: scripts/events-harness/runtime_test.d/57_scanner_final_fixes.sql
-- (sekcja B2) oraz rejestr w 56_scanner_review_fixes.sql (para
-- events / discussion_club_id: handoff -> repaired).
-- ============================================================================

CREATE OR REPLACE FUNCTION public._tg_events_discussion_club_cleared()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.discussion_group_id := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_events_discussion_club_cleared() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_events_discussion_club_cleared() IS
  'Klub dyskusji wydarzenia zostal wyzerowany (usuniecie klubu - ON DELETE SET NULL - albo redakcja): grupa tego przypiecia tez znika, bo grupa bez klubu lamie events_discussion_group_needs_club.';

DROP TRIGGER IF EXISTS events_discussion_club_cleared ON public.events;
CREATE TRIGGER events_discussion_club_cleared
  BEFORE UPDATE OF discussion_club_id ON public.events
  FOR EACH ROW
  WHEN (OLD.discussion_club_id IS NOT NULL
        AND NEW.discussion_club_id IS NULL
        AND NEW.discussion_group_id IS NOT NULL)
  EXECUTE FUNCTION public._tg_events_discussion_club_cleared();
