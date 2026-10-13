-- events-harness: include
-- ============================================================================
-- WYDARZENIA: USUNIECIE SESJI Z PUNKTEM ODPRAWY ODMAWIA JAWNYM KODEM
-- (przekazanie z S2, OPS-11).
--
-- PROBLEM. S2 (20261012110000) zamienil `event_checkpoints_session_fk` z ON
-- DELETE SET NULL na NO ACTION: punkt rodzaju `session` bez sesji lamie
-- `event_checkpoints_session_required`, wiec SET NULL i tak nie mial jak
-- zadzialac. Od tej chwili `admin_event_session_delete` dla sesji, do ktorej
-- (albo do ktorej podsesji - kaskada `event_sessions_parent_fk`) przypiety
-- jest punkt odprawy, konczy sie surowym bledem klucza obcego (23503).
-- Panel agendy pokazywal organizatorowi zdanie zapasowe "Operacja sie nie
-- udala" - bez slowa o tym, ze przeszkoda jest punkt w module obslugi na
-- miejscu i co z nim zrobic.
--
-- ZMIANA: `admin_event_session_delete(uuid)` - cialo z 20260824084741 z JEDNYM
-- dodatkiem: po sprawdzeniu zapisow liczy punkty odprawy przypiete do sesji
-- i jej podsesji (drzewo ma jeden poziom - `parent_depth`) i odmawia kodem
--   'session_has_checkpoints: N checkpoint(s) ... - change their kind or
--    delete them first'
-- w formacie glowy bledu modulu (jak `sponsor_has_checkpoints` z S2).
-- Kolejnosc: zapisy przed punktami - sesja z zapisami ma byc ODWOLANA, nie
-- usunieta, wiec to zdanie jest wazniejsze od drugiej przeszkody.
-- Punkty WYLACZONE (`is_active = false`) tez sie licza: klucz obcy nie
-- odroznia wylaczenia, a ich dziennik odpraw zostaje przy punkcie.
-- Klucz obcy zostaje ostatnia linia obrony (punkt dopisany rownolegle).
--
-- CZEGO TO NIE ZMIENIA: sygnatury, wyniku i ACL (CREATE OR REPLACE zachowuje
-- GRANT-y: authenticated, service_role), bramki `assert_editor_tenant()`,
-- odmowy `session_has_signups`, kaskady usuniecia podsesji i obsady.
--
-- IDEMPOTENTNA: CREATE OR REPLACE.
-- DOWOD: scripts/events-harness/runtime_test.d/78_ops_followups.sql (sekcja 2);
-- klient: src/lib/events/adminAgendaErrors.ts (adminEventAgenda.errors.
-- sessionHasCheckpoints, PL/EN).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_event_session_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_signups integer;
  v_checkpoints integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_sessions s WHERE s.id = _id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: session does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_signups
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant
    AND g.session_id = _id
    AND g.status <> 'cancelled';

  IF v_signups > 0 THEN
    RAISE EXCEPTION 'session_has_signups: % active signup(s) - cancel the session instead', v_signups;
  END IF;

  -- ZMIANA 20261012140100: punkt odprawy sesji (albo jej podsesji, ktora
  -- zniknie kaskada) blokuje usuniecie jawnym kodem zamiast bledu 23503
  -- z `event_checkpoints_session_fk` (NO ACTION od 20261012110000).
  SELECT count(*)::integer INTO v_checkpoints
  FROM public.event_checkpoints c
  WHERE c.tenant_id = v_tenant
    AND c.session_id IN (
      SELECT s.id
      FROM public.event_sessions s
      WHERE s.tenant_id = v_tenant
        AND (s.id = _id OR s.parent_session_id = _id)
    );

  IF v_checkpoints > 0 THEN
    RAISE EXCEPTION 'session_has_checkpoints: % checkpoint(s) are bound to this session or its sub-sessions - change their kind or delete them first', v_checkpoints;
  END IF;

  DELETE FROM public.event_sessions WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.admin_event_session_delete(uuid) IS
  'Usuwa sesje bez aktywnych zapisow i bez punktow odprawy (razem z jej podsesjami i obsada - kaskada). Sesja z zapisami wymaga odwolania (session_has_signups); punkt odprawy sesji lub podsesji trzeba najpierw zmienic albo usunac (session_has_checkpoints).';
