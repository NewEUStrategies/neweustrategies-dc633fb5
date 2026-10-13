-- events-harness: include
-- ============================================================================
-- WYDARZENIA: USUNIECIE BLOKU NIE KASUJE ZAPISOW JEGO PODSESJI (F11, po
-- przegladzie koncowym OPS).
--
-- PROBLEM. `admin_event_session_delete` (20261012140100) liczyl zapisy TYLKO
-- na usuwanej sesji (`g.session_id = _id`), choc tuz pod spodem liczyl punkty
-- odprawy na calym poddrzewie (`s.id = _id OR s.parent_session_id = _id`).
-- Blok "Blok" z podsesja "Warsztat" (requires_signup) i jednym aktywnym
-- zapisem na warsztat: organizator usuwa blok z agendy, RPC oddaje `true`,
-- `event_sessions_parent_fk` (ON DELETE CASCADE) zabiera warsztat,
-- a `event_session_signups_session_fk` (ON DELETE CASCADE) - zapis
-- uczestnika. Nikt nie dostaje powiadomienia i nie ma juz czego odwolac,
-- a okno potwierdzenia obiecuje: "Sesja z aktywnymi zapisami nie zostanie
-- usunieta - odwolaj ja zamiast usuwac". Luka jest starsza niz B3 (ta sama
-- klauzula stoi w 20260824084741), ale B3 odtworzyl funkcje wokol niej.
--
-- ZMIANA: `admin_event_session_delete(uuid)` - cialo z 20261012140100
-- z JEDNA zmiana: zapisy liczone na tym samym poddrzewie co punkty odprawy
-- (sesja i jej podsesje; drzewo ma jeden poziom - `parent_depth`
-- w `tg_event_sessions_validate`). Komunikat mowi, ze zapis moze siedziec na
-- podsesji. Kolejnosc bez zmian: `session_has_signups` PRZED
-- `session_has_checkpoints` - sesja z zapisami ma byc ODWOLANA, nie usunieta.
-- Klucz glowy (`session_has_signups`) i liczba w ogonie zostaja, wiec
-- mapowanie klienta (`adminAgendaErrors.ts`) dziala bez zmian; zdanie PL/EN
-- mowi teraz o sesji ALBO jej podsesjach.
--
-- CZEGO TO NIE ZMIENIA: sygnatury, wyniku i ACL (CREATE OR REPLACE zachowuje
-- GRANT-y: authenticated, service_role), bramki `assert_editor_tenant()`,
-- odmowy `session_has_checkpoints`, kaskady usuniecia podsesji i obsady dla
-- poddrzewa BEZ aktywnych zapisow. Zapisy `cancelled` dalej nie blokuja.
--
-- IDEMPOTENTNA: CREATE OR REPLACE.
-- DOWOD: scripts/events-harness/runtime_test.d/78_ops_followups.sql
-- (sekcja 3): blok + podsesja z aktywnym zapisem -> `session_has_signups`,
-- nic nie znika; zapis odwolany -> blok znika razem z podsesja.
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

  -- ZMIANA 20261012180000: zapisy liczone na poddrzewie (sesja i jej
  -- podsesje), tak jak punkty odprawy nizej - podsesja z zapisami zniknelaby
  -- kaskada `event_sessions_parent_fk`, a z nia zapisy uczestnikow.
  SELECT count(*)::integer INTO v_signups
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant
    AND g.status <> 'cancelled'
    AND g.session_id IN (
      SELECT s.id
      FROM public.event_sessions s
      WHERE s.tenant_id = v_tenant
        AND (s.id = _id OR s.parent_session_id = _id)
    );

  IF v_signups > 0 THEN
    RAISE EXCEPTION 'session_has_signups: % active signup(s) on this session or its sub-sessions - cancel the session instead', v_signups;
  END IF;

  -- 20261012140100: punkt odprawy sesji (albo jej podsesji, ktora zniknie
  -- kaskada) blokuje usuniecie jawnym kodem zamiast bledu 23503
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
  'Usuwa sesje bez aktywnych zapisow i bez punktow odprawy w calym poddrzewie (razem z jej podsesjami i obsada - kaskada). Aktywny zapis na sesji lub jej podsesji wymaga odwolania (session_has_signups, 20261012180000); punkt odprawy sesji lub podsesji trzeba najpierw zmienic albo usunac (session_has_checkpoints).';
