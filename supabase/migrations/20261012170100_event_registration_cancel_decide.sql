-- events-harness: include
-- ============================================================================
-- ZAPISY NA WYDARZENIA - REG-03 (CZ. 2), REG-13 (REZYGNACJA), REG-06 (DECYZJA):
-- REZYGNACJA I ANULOWANIE ZOSTAWIAJA ZWROT, PO KONCU WYDARZENIA NIE MA
-- REZYGNACJI ANI AWANSU, NOTATKA ORGANIZATORA ODDZIELONA OD POWODU DLA
-- UCZESTNIKA.
--
-- DEFEKT
--   1. REG-03. `event_registration_cancel` (20260824090214:526-627) ustawia
--      tylko status: oplacone zgloszenie zamyka sie bez zwrotu, bez wpisu
--      w dzienniku i bez sygnalu dla organizatora. Uczestnik nie widzi
--      skutku finansowego przed potwierdzeniem. `admin_event_registration_decide`
--      'cancel' (20260829071947:611-622) - to samo po stronie organizatora.
--   2. REG-13. Rezygnacja nie porownuje `now()` z koncem wydarzenia, a potem
--      bezwarunkowo awansuje kolejke (:584-590, :613) - rezygnacja dzien po
--      wydarzeniu dawala komus „miejsce" na cos, co juz sie odbylo. Decyzja
--      organizatora awansuje po koncu tak samo (20260829071947:652-656).
--   3. REG-17 (czesc rezygnacji). Klucz samoobslugi nie wygasa: rezygnacja
--      liczy hash sama, bez `_event_manage_token_resolve` (A1).
--   3a. Wlasnosc po koncie liczona `person_user_id = v_uid` daje NULL dla osoby
--      BEZ konta, a `IF NOT (false OR NULL)` nie rzuca - zalogowany obcy
--      odwolywal cudze zgloszenie goscia po samym identyfikatorze (:579-584).
--   4. REG-06. Jedno pole `note` decyzji trafia do `decision_note`, ktore
--      `event_my_registrations` i mail o odrzuceniu pokazywaly uczestnikowi -
--      notatka wewnetrzna nie miala gdzie byc wewnetrzna.
--
-- ZMIANA
--   A. Kolumna `participant_reason` (<= 1000) - JEDYNY tekst decyzji widoczny
--      dla uczestnika; `decision_note` jest wewnetrzna, `cancel_reason`
--      wycofana (nikt jej nie pisze ani nie czyta). Bez backfillu.
--   B. `event_registration_cancel`: klucz przez resolver (cel 'act'),
--      blokady wydarzenie -> bilet -> zgloszenie, `event_ended` od
--      `_event_effective_end`, ocena skutku i obowiazkowe potwierdzenie
--      (`acknowledged_effect`: `refund_ack_required` / `refund_terms_changed`),
--      zlecenie zwrotu i dzwonek przez `_event_registration_cancel_refund`.
--   C. `event_registration_cancel_preview` - podglad tego samego skutku przed
--      potwierdzeniem (cel klucza 'view').
--   D. `admin_event_registration_decide`: `participant_reason` (tylko
--      reject/cancel/refund), `note_too_long`/`participant_reason_too_long`
--      zamiast urwania, `refund` = full|none przy 'cancel' (rezygnacja ze
--      zwrotu wymaga notatki), awans tylko przed koncem wydarzenia.
--      Przejscie 'waitlist' i przyjecie nieoplaconego bez kodu QR bez zmian.
--   E. `admin_event_registration_refund_preview` - skutek anulowania w oknie
--      decyzji organizatora.
--
-- CZEGO TO NIE ZAMYKA. Kaskada gosci grupy (`_tg_event_group_follow_lead_status`
-- -> `_event_group_promote_freed`) awansuje za miejsca gosci takze po koncu
-- wydarzenia - straznik nalezy do `_event_waitlist_promote` (wlasciciel B6).
-- Akcja 'refund' (oznaczenie zwrotu przez organizatora) nie wola operatora,
-- jak dotad - panel jej nie oferuje.
--
-- KOLEJNOSC WDROZENIA: NAJPIERW KOD. Nowy front wysyla `acknowledged_effect`
-- (stara baza go ignoruje), czyta podglad przez `event_registration_cancel_preview`
-- (przy PGRST202/42883 pokazuje rezygnacje bez skutku, jak dotad) i dwa pola
-- decyzji. Stary front na nowej bazie: rezygnacja OPLACONEGO zgloszenia
-- dostaje `refund_ack_required` do odswiezenia strony - zamierzone, bo to
-- jedyny dowod w bazie, ze uczestnik widzial skutek finansowy.
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD,
-- CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_registration_cancel_refund_test.sql,
-- supabase/tests/event_registration_participant_reason_test.sql,
-- scripts/events-harness/runtime_test.d/24_cancel_refund_visibility.sql.
-- ============================================================================

-- A) POWOD DLA UCZESTNIKA ODDZIELONY OD NOTATKI WEWNETRZNEJ ------------------------
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS participant_reason text;

ALTER TABLE public.event_registrations
  DROP CONSTRAINT IF EXISTS event_registrations_participant_reason_len;
ALTER TABLE public.event_registrations
  ADD CONSTRAINT event_registrations_participant_reason_len CHECK (
    participant_reason IS NULL OR char_length(participant_reason) <= 1000);

-- BEZ BACKFILLU: istniejace `decision_note` sa wewnetrzne z definicji i nigdy
-- nie sa kopiowane do `participant_reason`.
COMMENT ON COLUMN public.event_registrations.participant_reason IS
  'REG-06 (D10): powod decyzji widoczny dla uczestnika (mail o decyzji, „Moje bilety"), tylko przy statusie rejected/cancelled. Pisze wylacznie admin_event_registration_decide z jawnego klucza participant_reason (reject/cancel/refund). <= 1000 znakow.';
COMMENT ON COLUMN public.event_registrations.decision_note IS
  'REG-06 (D10): WEWNETRZNA notatka organizatora (<= 2000). Nigdy nie wraca z RPC uczestnika ani w mailu; authenticated nie ma SELECT na tej kolumnie.';
COMMENT ON COLUMN public.event_registrations.cancel_reason IS
  'WYCOFANA (REG-06): nigdy niepisana od 20260828063423, zastapiona przez participant_reason. Nie czytac.';

-- B) REZYGNACJA UCZESTNIKA ---------------------------------------------------------
-- Cialo z 20260824090214:526-621 (search_path z 20260830120000). Zmiany
-- (ZMIANA 20261012):
--   * REG-17: klucz przez `_event_manage_token_resolve(..., 'act')`. Sam klucz:
--     wygasly -> `manage_expired`, zamkniete -> `already_closed`, brak ->
--     `not_found`. Klucz z identyfikatorem: dowodem jest klucz TEGO zgloszenia
--     (wygasly bez konta wlasciciela -> `manage_expired`), inaczej `forbidden`
--     jak dotad. Sciezka konta bez zmian (osoba.user_id = auth.uid()).
--   * Blokady wydarzenie -> bilet -> zgloszenie (FOR UPDATE) i ponowne
--     sprawdzenie statusu pod blokada: drugi rownolegly klik dostaje
--     `already_closed`, a nie drugie zdarzenie i drugi awans.
--   * REG-13: `event_ended` od `_event_effective_end(starts_at, ends_at)`.
--   * REG-03: ocena skutku, potwierdzenie (`acknowledged_effect`), zlecenie
--     zwrotu i dzwonek po zmianie statusu (kaskada gosci juz zamknieta).
--   * Klucz `reason` z ladunku nadal ignorowany (`cancel_reason` wycofana).
CREATE OR REPLACE FUNCTION public.event_registration_cancel(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_manage text := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  v_ack text := NULLIF(btrim(COALESCE(p_payload->>'acknowledged_effect', '')), '');
  v_reg_id uuid;
  v_key_id uuid;
  v_key_verdict text;
  v_token_ok boolean := false;
  v_owner boolean;
  v_reg record;
  v_status text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_assess jsonb;
  v_effect text;
  v_refund jsonb;
  v_promoted jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  v_reg_id := CASE
    WHEN COALESCE(p_payload->>'registration_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'registration_id')::uuid
    ELSE NULL
  END;

  IF v_reg_id IS NULL AND v_manage IS NULL THEN
    RAISE EXCEPTION 'invalid_request: registration_id or manage_token is required';
  END IF;

  IF v_manage IS NOT NULL THEN
    SELECT k.registration_id, k.verdict INTO v_key_id, v_key_verdict
      FROM public._event_manage_token_resolve(v_tenant, v_manage, 'act') k;
  END IF;

  IF v_reg_id IS NULL THEN
    IF v_key_verdict = 'expired' THEN
      RAISE EXCEPTION 'manage_expired: this management link expired when the event ended';
    ELSIF v_key_verdict = 'closed' THEN
      RAISE EXCEPTION 'already_closed: this registration is already closed';
    ELSIF v_key_verdict IS DISTINCT FROM 'ok' THEN
      RAISE EXCEPTION 'not_found: registration does not exist';
    END IF;
    v_reg_id := v_key_id;
    v_token_ok := true;
  END IF;

  SELECT r.id, r.event_id, r.ticket_type_id, r.status, p.user_id AS person_user_id
  INTO v_reg
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.tenant_id = v_tenant
    AND r.id = v_reg_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  -- ZMIANA 20261012 (wlasnosc bez NULL): stare `v_uid IS NOT NULL AND
  -- person_user_id = v_uid` dawalo NULL dla osoby BEZ konta, a `NOT (false OR
  -- NULL)` to NULL - IF go pomijal i zalogowany obcy odwolywal cudze zgloszenie
  -- po samym identyfikatorze. Wlasnosc jest prawda albo falszem, nigdy NULL.
  v_owner := v_uid IS NOT NULL AND v_reg.person_user_id IS NOT DISTINCT FROM v_uid;

  -- Klucz podany obok identyfikatora dowodzi wlasnosci tylko TEGO zgloszenia.
  IF NOT v_token_ok AND v_key_id IS NOT DISTINCT FROM v_reg.id AND v_key_id IS NOT NULL THEN
    IF v_key_verdict IN ('ok', 'closed') THEN
      v_token_ok := true;
    ELSIF v_key_verdict = 'expired' AND NOT v_owner THEN
      RAISE EXCEPTION 'manage_expired: this management link expired when the event ended';
    END IF;
  END IF;

  IF NOT (v_token_ok OR v_owner) THEN
    RAISE EXCEPTION 'forbidden: this registration belongs to somebody else';
  END IF;

  IF v_reg.status IN ('cancelled', 'rejected') THEN
    RAISE EXCEPTION 'already_closed: this registration is already closed';
  END IF;

  IF v_reg.status IN ('attended', 'no_show') THEN
    RAISE EXCEPTION 'event_finished: attendance is already recorded';
  END IF;

  -- Blokady w kolejnosci calego modulu: wydarzenie -> bilet -> zgloszenie.
  SELECT e.starts_at, e.ends_at INTO v_starts, v_ends
    FROM public.events e
   WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant
   FOR UPDATE;

  IF v_reg.ticket_type_id IS NOT NULL THEN
    PERFORM 1 FROM public.event_ticket_types t
     WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant
     FOR UPDATE;
  END IF;

  SELECT r.status INTO v_status
    FROM public.event_registrations r
   WHERE r.id = v_reg.id AND r.tenant_id = v_tenant
   FOR UPDATE;
  IF v_status IN ('cancelled', 'rejected') THEN
    RAISE EXCEPTION 'already_closed: this registration is already closed';
  END IF;
  IF v_status IN ('attended', 'no_show') THEN
    RAISE EXCEPTION 'event_finished: attendance is already recorded';
  END IF;

  -- REG-13 (D7): po efektywnym koncu wydarzenia uczestnik nie rezygnuje -
  -- zwolnione „miejsce" nie mialoby komu sluzyc, a awans dawalby bilet na
  -- cos, co sie odbylo. Korekte po koncu robi organizator (bez awansu).
  IF now() >= public._event_effective_end(v_starts, v_ends) THEN
    RAISE EXCEPTION 'event_ended: the event has already ended';
  END IF;

  -- REG-03 (D9): skutek finansowy, ktory uczestnik musial zobaczyc.
  v_assess := public._event_registration_refund_assess(v_tenant, v_reg.id, 'participant_cancelled', now());
  v_effect := v_assess->>'effect';
  IF v_ack IS NULL AND v_effect IN ('full_refund', 'no_refund', 'organizer_review') THEN
    RAISE EXCEPTION 'refund_ack_required: %', v_effect;
  END IF;
  IF v_ack IS NOT NULL AND v_ack IS DISTINCT FROM v_effect THEN
    RAISE EXCEPTION 'refund_terms_changed: %', v_effect;
  END IF;

  UPDATE public.event_registrations r
  SET status = 'cancelled',
      cancelled_at = now(),
      waitlist_position = NULL,
      qr_token_hash = NULL,
      qr_issued_at = NULL
  WHERE r.id = v_reg.id AND r.tenant_id = v_tenant;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg.id::text,
    'event.registration.cancelled.v1',
    jsonb_build_object('event_id', v_reg.event_id, 'by', 'participant', 'refund_effect', v_effect),
    v_uid
  );

  v_refund := public._event_registration_cancel_refund(
    v_tenant, v_reg.id, 'participant_cancelled', v_uid, v_assess);

  -- Wydarzenie trwa (sprawdzone pod blokada), wiec zwolnione miejsce sluzy.
  v_promoted := public._event_waitlist_promote(v_tenant, v_reg.event_id, v_reg.ticket_type_id, 1);

  RETURN jsonb_build_object(
    'registration_id', v_reg.id,
    'status', 'cancelled',
    'promoted_from_waitlist', COALESCE((v_promoted->>'promoted')::integer, 0),
    'refund', jsonb_build_object(
      'effect', v_refund->>'effect',
      'job_state', v_refund->>'job_state',
      'review_reason', v_refund->>'review_reason',
      'amount_cents', (v_refund->>'amount_cents')::integer,
      'currency', v_refund->>'currency',
      'refund_deadline_at', v_refund->>'refund_deadline_at')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_registration_cancel(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_cancel(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_cancel(jsonb) IS
  'Rezygnacja z WLASNEGO zgloszenia: dowod to klucz samoobslugi (resolver, cel act: manage_expired po koncu wydarzenia, already_closed po zamknieciu) albo konto dowiazane do osoby. Po koncu wydarzenia event_ended. Oplacone: skutek z _event_registration_refund_assess musi byc potwierdzony (acknowledged_effect; refund_ack_required / refund_terms_changed), zlecenie zwrotu i dzwonek do organizatorow. Zwolnione miejsce promuje kolejke.';

-- C) PODGLAD REZYGNACJI ----------------------------------------------------------
-- Ta sama tozsamosc co rezygnacja (cel klucza 'view': po zamknieciu
-- zgloszenia podglad dziala, po koncu wydarzenia - nie). Odmowa niczego nie
-- zdradza: obce i nieistniejace zgloszenie to ten sam `not_found`.
-- Uczestnik dostaje skutek BEZ identyfikatora zamowienia.
CREATE OR REPLACE FUNCTION public.event_registration_cancel_preview(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_manage text := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  v_reg_id uuid;
  v_key_id uuid;
  v_key_verdict text;
  v_token_ok boolean := false;
  v_owner boolean;
  v_reg record;
  v_refusal text;
  v_assess jsonb;
BEGIN
  v_reg_id := CASE
    WHEN COALESCE(p_payload->>'registration_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'registration_id')::uuid
    ELSE NULL
  END;

  IF v_tenant IS NULL OR (v_reg_id IS NULL AND v_manage IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_manage IS NOT NULL THEN
    SELECT k.registration_id, k.verdict INTO v_key_id, v_key_verdict
      FROM public._event_manage_token_resolve(v_tenant, v_manage, 'view') k;
  END IF;

  IF v_reg_id IS NULL THEN
    IF v_key_verdict = 'expired' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'expired');
    ELSIF v_key_verdict IS DISTINCT FROM 'ok' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    v_reg_id := v_key_id;
    v_token_ok := true;
  END IF;

  SELECT r.id, r.status, r.event_id, e.starts_at, e.ends_at, p.user_id AS person_user_id
    INTO v_reg
    FROM public.event_registrations r
    JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
   WHERE r.tenant_id = v_tenant AND r.id = v_reg_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Wlasnosc bez NULL - jak w rezygnacji (osoba bez konta to nie „moje").
  v_owner := v_uid IS NOT NULL AND v_reg.person_user_id IS NOT DISTINCT FROM v_uid;

  IF NOT v_token_ok AND v_key_id IS NOT NULL AND v_key_id = v_reg.id THEN
    IF v_key_verdict = 'ok' THEN
      v_token_ok := true;
    ELSIF v_key_verdict = 'expired' AND NOT v_owner THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'expired');
    END IF;
  END IF;

  IF NOT (v_token_ok OR v_owner) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  v_refusal := CASE
    WHEN v_reg.status IN ('cancelled', 'rejected') THEN 'already_closed'
    WHEN v_reg.status IN ('attended', 'no_show') THEN 'event_finished'
    WHEN now() >= public._event_effective_end(v_reg.starts_at, v_reg.ends_at) THEN 'event_ended'
  END;

  IF v_refusal IS NULL THEN
    v_assess := public._event_registration_refund_assess(v_tenant, v_reg.id, 'participant_cancelled', now());
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_reg.id,
    'status', v_reg.status,
    'can_cancel', v_refusal IS NULL,
    'refusal', v_refusal,
    'refund', CASE WHEN v_assess IS NULL THEN NULL ELSE jsonb_build_object(
      'effect', v_assess->>'effect',
      'review_reason', v_assess->>'review_reason',
      'amount_cents', (v_assess->>'amount_cents')::integer,
      'currency', v_assess->>'currency',
      'refund_mode', v_assess->>'refund_mode',
      'refund_deadline_at', v_assess->>'refund_deadline_at',
      'group_guests_closing', (v_assess->>'group_guests_closing')::integer,
      'acknowledgement_required',
        (v_assess->>'effect') IN ('full_refund', 'no_refund', 'organizer_review'))
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_registration_cancel_preview(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_cancel_preview(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_cancel_preview(jsonb) IS
  'REG-03/REG-13: podglad rezygnacji z WLASNEGO zgloszenia przed potwierdzeniem - ta sama tozsamosc co event_registration_cancel (klucz przez resolver, cel view, albo konto). {ok:false, reason not_found|expired} albo {ok:true, registration_id, status, can_cancel, refusal null|already_closed|event_finished|event_ended, refund {effect, review_reason, amount_cents, currency, refund_mode, refund_deadline_at, group_guests_closing, acknowledgement_required}}. Bez identyfikatora zamowienia.';

-- D) DECYZJA ORGANIZATORA ----------------------------------------------------------
-- Cialo z 20260829071947:436-680 (search_path z 20260830120000). Zmiany
-- (ZMIANA 20261012):
--   * REG-06: `participant_reason` (jawny klucz) tylko dla reject/cancel/
--     refund, inaczej `invalid_request`; ustawiany przy kazdej decyzji
--     zamykajacej, czyszczony przy kazdej innej (nowa decyzja nie dziedziczy
--     starego powodu). Przekroczenie limitu to odmowa, nie przyciecie:
--     `participant_reason_too_long` (1000), `note_too_long` (2000, zamiast
--     nieczytelnego 23514 z CHECK).
--   * REG-03: 'cancel' liczy skutek (`organizer_cancelled`) i zapisuje
--     zlecenie; `refund` = 'full' (domyslnie) | 'none' - rezygnacja ze zwrotu
--     wymaga notatki wewnetrznej (>= 3 znaki, `reason_required`).
--   * REG-13: awans kolejki tylko przed efektywnym koncem wydarzenia -
--     organizator moze zamknac zgloszenie po koncu (korekta), ale nie daje
--     nikomu miejsca na cos, co sie odbylo.
-- Bez zmian: tablica przejsc (w tym 'waitlist'), przyjecie nieoplaconego bez
-- kodu QR, wymagany powod odrzucenia (`decision_note`, CHECK
-- rejection_has_reason), blokady wydarzenie -> bilet.
CREATE OR REPLACE FUNCTION public.admin_event_registration_decide(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_action text := lower(btrim(COALESCE(p_payload->>'action', '')));
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_reason text := NULLIF(btrim(COALESCE(p_payload->>'participant_reason', '')), '');
  v_refund_choice text := NULLIF(lower(btrim(COALESCE(p_payload->>'refund', ''))), '');
  v_reg public.event_registrations;
  v_starts timestamptz;
  v_ends timestamptz;
  v_seats_left integer;
  v_token text;
  v_position integer;
  v_freed boolean := false;
  v_status text;
  v_assess jsonb;
  v_refund jsonb;
  v_promoted jsonb := jsonb_build_object('promoted', 0);
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: registration_id is required';
  END IF;

  IF v_action NOT IN ('approve', 'reject', 'waitlist', 'attended', 'no_show',
                      'cancel', 'paid', 'refund') THEN
    RAISE EXCEPTION 'invalid_action: unknown decision %', v_action;
  END IF;

  -- ZMIANA 20261012 (REG-06): powod dla uczestnika tylko przy zamknieciu,
  -- limity jako odmowa (AGENTS.md: odrzucac, nie przycinac).
  IF v_reason IS NOT NULL AND v_action NOT IN ('reject', 'cancel', 'refund') THEN
    RAISE EXCEPTION 'invalid_request: participant_reason is accepted only for reject, cancel or refund';
  END IF;
  IF char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'participant_reason_too_long: at most 1000 characters';
  END IF;
  IF char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'note_too_long: at most 2000 characters';
  END IF;
  -- ZMIANA 20261012 (REG-03): wybor zwrotu tylko przy anulowaniu.
  IF v_refund_choice IS NOT NULL AND v_refund_choice NOT IN ('full', 'none') THEN
    RAISE EXCEPTION 'invalid_request: refund must be full or none';
  END IF;
  IF v_refund_choice IS NOT NULL AND v_action <> 'cancel' THEN
    RAISE EXCEPTION 'invalid_request: refund choice is accepted only for cancel';
  END IF;

  SELECT * INTO v_reg
  FROM public.event_registrations r
  WHERE r.id = v_id AND r.tenant_id = v_tenant;

  IF v_reg.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  SELECT e.starts_at, e.ends_at INTO v_starts, v_ends
  FROM public.events e
  WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant
  FOR UPDATE;

  IF v_reg.ticket_type_id IS NOT NULL THEN
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant
    FOR UPDATE;
  END IF;

  IF NOT (
    (v_action = 'approve' AND v_reg.status IN ('draft', 'pending', 'waitlist', 'rejected', 'cancelled'))
    OR (v_action = 'reject' AND v_reg.status IN ('draft', 'pending', 'waitlist', 'approved'))
    OR (v_action = 'waitlist' AND v_reg.status IN ('draft', 'pending', 'approved'))
    OR (v_action = 'attended' AND v_reg.status IN ('approved', 'no_show'))
    OR (v_action = 'no_show' AND v_reg.status IN ('approved', 'attended'))
    OR (v_action = 'cancel' AND v_reg.status IN ('draft', 'pending', 'waitlist', 'approved'))
    OR (v_action = 'paid' AND v_reg.payment_status = 'unpaid'
        AND v_reg.status IN ('draft', 'pending', 'waitlist', 'approved'))
    OR (v_action = 'refund' AND v_reg.payment_status = 'paid')
  ) THEN
    IF v_action IN ('paid', 'refund') THEN
      RAISE EXCEPTION 'invalid_transition: payment % cannot be %',
        v_reg.payment_status, v_action;
    END IF;
    RAISE EXCEPTION 'invalid_transition: % cannot be %', v_reg.status, v_action;
  END IF;

  v_freed := v_reg.status IN ('approved', 'attended', 'no_show')
    AND v_action IN ('reject', 'waitlist', 'cancel', 'refund');

  IF v_action = 'approve' THEN
    IF v_reg.status IN ('rejected', 'cancelled') AND EXISTS (
      SELECT 1 FROM public.event_registrations r2
      WHERE r2.tenant_id = v_tenant
        AND r2.event_id = v_reg.event_id
        AND r2.person_id = v_reg.person_id
        AND r2.id <> v_reg.id
        AND r2.status NOT IN ('cancelled', 'rejected')
    ) THEN
      RAISE EXCEPTION 'already_registered: this person already has an active registration';
    END IF;

    v_seats_left := public._event_seats_left(v_tenant, v_reg.event_id, v_reg.ticket_type_id);
    IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
      RAISE EXCEPTION 'no_seats_left: no free seat for this ticket - use the waiting list';
    END IF;

    IF v_reg.payment_status <> 'unpaid' THEN
      v_token := public._event_new_qr_token();
    END IF;

    UPDATE public.event_registrations r
    SET status = 'approved',
        waitlist_position = NULL,
        cancelled_at = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        participant_reason = NULL,
        qr_token_hash = CASE
          WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex')
          ELSE NULL
        END,
        qr_issued_at = CASE WHEN v_token IS NOT NULL THEN now() END,
        promoted_at = CASE WHEN r.status = 'waitlist' THEN now() ELSE r.promoted_at END
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'paid' THEN
    IF v_reg.status <> 'approved' THEN
      v_seats_left := public._event_seats_left(v_tenant, v_reg.event_id, v_reg.ticket_type_id);
      IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
        RAISE EXCEPTION 'no_seats_left: no free seat for this ticket - use the waiting list';
      END IF;
    END IF;

    v_token := public._event_new_qr_token();

    UPDATE public.event_registrations r
    SET payment_status = 'paid',
        status = 'approved',
        waitlist_position = NULL,
        cancelled_at = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        participant_reason = NULL,
        qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        qr_issued_at = now(),
        promoted_at = CASE WHEN r.status = 'waitlist' THEN now() ELSE r.promoted_at END
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'refund' THEN
    UPDATE public.event_registrations r
    SET payment_status = 'refunded',
        status = 'cancelled',
        cancelled_at = now(),
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        participant_reason = v_reason,
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'reject' THEN
    IF v_note IS NULL OR char_length(v_note) < 3 THEN
      RAISE EXCEPTION 'reason_required: a rejection reason is required';
    END IF;

    UPDATE public.event_registrations r
    SET status = 'rejected',
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = v_note,
        participant_reason = v_reason,
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'waitlist' THEN
    v_position := public._event_next_waitlist_position(v_tenant, v_reg.event_id);

    UPDATE public.event_registrations r
    SET status = 'waitlist',
        waitlist_position = v_position,
        waitlist_notified_at = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        participant_reason = NULL,
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'cancel' THEN
    -- ZMIANA 20261012 (REG-03): skutek PRZED zmiana statusu (goscie kaskady
    -- jeszcze aktywni - ocena wie, ze zamkna sie razem z prowadzacym).
    v_assess := public._event_registration_refund_assess(v_tenant, v_id, 'organizer_cancelled', now());
    IF v_refund_choice = 'none' AND v_assess->>'job_state' IS NOT NULL
       AND (v_note IS NULL OR char_length(v_note) < 3) THEN
      RAISE EXCEPTION 'reason_required: waiving the refund needs an internal note';
    END IF;

    UPDATE public.event_registrations r
    SET status = 'cancelled',
        cancelled_at = now(),
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        participant_reason = v_reason,
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

    v_refund := public._event_registration_cancel_refund(
      v_tenant, v_id, 'organizer_cancelled', v_uid, v_assess,
      v_refund_choice = 'none', v_note);

  ELSE
    UPDATE public.event_registrations r
    SET status = v_action,
        attended_at = CASE
          WHEN v_action = 'attended' THEN COALESCE(r.attended_at, now())
          ELSE NULL
        END,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        participant_reason = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_id::text,
    'event.registration.decided.v1',
    jsonb_build_object(
      'event_id', v_reg.event_id,
      'person_id', v_reg.person_id,
      'from', v_reg.status,
      'action', v_action,
      'refund_effect', v_refund->>'effect'
    ),
    v_uid
  );

  -- ZMIANA 20261012 (REG-13): po koncu wydarzenia zamkniecie nie awansuje.
  IF v_freed AND now() < public._event_effective_end(v_starts, v_ends) THEN
    v_promoted := public._event_waitlist_promote(
      v_tenant, v_reg.event_id, v_reg.ticket_type_id, 1
    );
  END IF;

  SELECT r.status INTO v_status
  FROM public.event_registrations r
  WHERE r.id = v_id AND r.tenant_id = v_tenant;

  RETURN jsonb_build_object(
    'registration_id', v_id,
    'action', v_action,
    'status', v_status,
    'waitlist_position', v_position,
    'qr_token', v_token,
    'participant_reason', CASE WHEN v_action IN ('reject', 'cancel', 'refund') THEN v_reason END,
    'refund', CASE WHEN v_refund IS NULL THEN NULL ELSE jsonb_build_object(
      'effect', v_refund->>'effect',
      'job_id', v_refund->>'job_id',
      'job_state', v_refund->>'job_state',
      'review_reason', v_refund->>'review_reason',
      'amount_cents', (v_refund->>'amount_cents')::integer,
      'currency', v_refund->>'currency') END,
    'promoted_from_waitlist', COALESCE((v_promoted->>'promoted')::integer, 0),
    'promoted', COALESCE(v_promoted->'registrations', '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_decide(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_decide(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_decide(jsonb) IS
  'Decyzja organizatora o zapisie: approve | reject | waitlist | attended | no_show | cancel | paid | refund. Jawna tablica przejsc, pula pod blokada, slad decyzji. note = WEWNETRZNA notatka (decision_note, <= 2000); participant_reason (<= 1000, tylko reject/cancel/refund) = jedyny tekst dla uczestnika. cancel liczy skutek finansowy i zapisuje zlecenie zwrotu (refund full|none; none wymaga notatki). Awans kolejki tylko przed koncem wydarzenia. Najemca z assert_editor_tenant().';

-- E) SKUTEK ANULOWANIA W OKNIE ORGANIZATORA --------------------------------------
-- Wiersz listy zgloszen nie ma pol platnosci, wiec okno decyzji pyta tu.
CREATE OR REPLACE FUNCTION public.admin_event_registration_refund_preview(p_registration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_payment text;
  v_status text;
BEGIN
  SELECT r.payment_status, r.status INTO v_payment, v_status
    FROM public.event_registrations r
   WHERE r.id = p_registration_id AND r.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  RETURN public._event_registration_refund_assess(v_tenant, p_registration_id, 'organizer_cancelled', now())
    || jsonb_build_object('payment_status', v_payment, 'registration_status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_refund_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_refund_preview(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_refund_preview(uuid) IS
  'REG-03: skutek finansowy anulowania zgloszenia przez organizatora (_event_registration_refund_assess, origin organizer_cancelled) + payment_status i status. Najemca z assert_event_admin_tenant().';
