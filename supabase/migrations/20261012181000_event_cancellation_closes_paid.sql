-- events-harness: include
-- ============================================================================
-- ZAPISY NA WYDARZENIA - REG-03 (PRZEGLAD R45, CZ. 1): ODWOLANIE CALEGO
-- WYDARZENIA ZAMYKA OPLACONE ZGLOSZENIA ZE ZWROTEM, USUNIECIE WYDARZENIA
-- Z PIENIEDZMI JEST ODMAWIANE.
--
-- DEFEKT
--   1. Odwolanie wydarzenia (`events.status = 'cancelled'` - RPC
--      `admin_event_set_status`, bezposredni UPDATE panelu przez polityke
--      „events staff write" albo rola serwisowa) nie dotyka zgloszen:
--      `tg_events_status_notify` (20260713093000) dzwoni tylko do RSVP.
--      Oplacone zgloszenia zostaja `approved` + `paid`, bez zlecenia zwrotu
--      i bez dzwonka do organizatora, a po efektywnym koncu odwolanego
--      wydarzenia uczestnik nie moze juz sam zrezygnowac (`event_ended`,
--      20261012170100:B) - pieniadze zostaja po cichu. Naglowek
--      20261012170000 wprost zapisal to jako „czego to nie zamyka".
--   2. Usuniecie wydarzenia (`deleteEvent` w panelu = DELETE przez PostgREST,
--      polityka „events staff write") kaskaduje zgloszenia
--      (`event_registrations_event_tenant_fkey ON DELETE CASCADE`): oplacone
--      zgloszenia znikaja, zamowienia zostaja `paid`, nie ma zlecenia zwrotu
--      ani sladu w dzienniku. Odmowe dawal tylko istniejacy wiersz zlecenia
--      (klucz obcy NO ACTION, surowe 23503 bez tlumaczenia).
--
-- ZMIANA
--   A. `_event_cancelled_event_close_paid(tenant, event, actor)` - jedna
--      procedura zamkniecia: blokady wydarzenie -> bilety -> zgloszenie, dla
--      kazdego OTWARTEGO (draft/pending/waitlist/approved) zgloszenia
--      `paid`/`partially_refunded` ocena skutku PRZED zmiana statusu
--      (`_event_registration_refund_assess(..., 'organizer_cancelled')` - dla
--      odwolanego wydarzenia pelny zwrot), status `cancelled` bez kodu QR
--      i zlecenie przez `_event_registration_cancel_refund`. Prowadzacy przed
--      goscmi: kaskada grupy zamyka gosci razem z prowadzacym, a zlecenie
--      calego zamowienia idzie na prowadzacego. JEDEN zbiorczy dzwonek do
--      organizatorow (nie po jednym na zgloszenie). Bez awansu kolejki
--      (`_event_waitlist_promote` od 20261012181100 nie awansuje na odwolanym
--      wydarzeniu). Odwolanie PO efektywnym koncu wydarzenia nie zleca zwrotu
--      automatycznie: `pending` staje sie `needs_review`
--      (`closed_without_refund_decision`) - organizator decyduje w dzienniku,
--      zamiast oddawac pieniadze za cos, co sie odbylo.
--   B. Trigger `events_zz_cancelled_closes_paid` (AFTER UPDATE OF status,
--      tylko przejscie W `cancelled`) wola A - kazda droga odwolania. Bledu
--      NIE polyka: lepiej odmowic odwolania niz zgubic zwrot.
--   C. Trigger `events_00_delete_keeps_payments` (BEFORE DELETE): wydarzenie
--      z oplaconym zgloszeniem albo z JAKIMKOLWIEK zleceniem zwrotu (takze
--      zakonczonym - klucz obcy i tak by odmowil) -> `event_has_payments`.
--      Kaskada z usuniecia NAJEMCY (operacja platformy, `pg_trigger_depth() > 1`)
--      przechodzi jak dotad.
--
-- CZEGO TO NIE ZAMYKA. Zgloszenia BEZPLATNE i NIEOPLACONE odwolanego
-- wydarzenia zostaja bez zmian (dotychczasowe zachowanie): nie ma czego
-- zwracac, wpis zostaje do wgladu, a uczestnicy RSVP dostaja dzwonek
-- z `tg_events_status_notify`. Wplata, ktora dotrze PO odwolaniu, zamyka sie
-- ta sama procedura w `payments_apply_event_ticket_outcome` (20261012181400).
-- `attended`/`no_show` (fakt z sali) nie sa ruszane. Ponowne opublikowanie
-- nie otwiera zamknietych zgloszen (decyzja organizatora: 'approve'); kolejne
-- odwolanie zamyka tylko to, co w miedzyczasie znow jest otwarte i oplacone
-- (procedura jest idempotentna).
--
-- KOLEJNOSC WDROZENIA: dowolna (nowe obiekty; panel tlumaczy
-- `event_has_payments`, a stary panel pokazuje surowy komunikat bazy).
-- IDEMPOTENTNA: CREATE OR REPLACE, DROP TRIGGER IF EXISTS + CREATE TRIGGER,
-- bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_refund_r45_test.sql,
-- scripts/events-harness/runtime_test.d/24_r45_cancel_refund_locks.sql.
-- ============================================================================

-- A) ZAMKNIECIE OPLACONYCH ZGLOSZEN ODWOLANEGO WYDARZENIA ---------------------------
CREATE OR REPLACE FUNCTION public._event_cancelled_event_close_paid(
  _tenant uuid,
  _event_id uuid,
  _actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_title_pl text;
  v_title_en text;
  v_ended boolean;
  v_reg_id uuid;
  v_assess jsonb;
  v_refund jsonb;
  v_closed integer := 0;
  v_queued integer := 0;
  v_review integer := 0;
BEGIN
  IF _tenant IS NULL OR _event_id IS NULL THEN
    RETURN jsonb_build_object('closed', 0, 'refunds_queued', 0, 'refunds_review', 0);
  END IF;

  -- Blokady w kolejnosci calego modulu: wydarzenie -> bilety -> zgloszenie.
  -- Wolajacy (trigger odwolania, wynik platnosci) zwykle juz trzyma wiersz
  -- wydarzenia - ponowna blokada w tej samej transakcji nic nie kosztuje.
  SELECT e.status, e.starts_at, e.ends_at, e.title_pl,
         COALESCE(NULLIF(btrim(e.title_en), ''), e.title_pl)
    INTO v_status, v_starts, v_ends, v_title_pl, v_title_en
    FROM public.events e
   WHERE e.id = _event_id AND e.tenant_id = _tenant
   FOR UPDATE;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RETURN jsonb_build_object('closed', 0, 'refunds_queued', 0, 'refunds_review', 0);
  END IF;
  v_ended := now() >= public._event_effective_end(v_starts, v_ends);

  -- Bilety w porzadku identyfikatorow: trzymamy wydarzenie, wiec zaden
  -- zapisujacy miejsca zgodny z kolejnoscia modulu nie trzyma teraz biletu.
  PERFORM 1 FROM public.event_ticket_types t
   WHERE t.tenant_id = _tenant AND t.event_id = _event_id
   ORDER BY t.id
   FOR UPDATE;

  -- Prowadzacy przed goscmi: zamkniecie prowadzacego zamyka kaskada jego
  -- gosci, a ocena wie, ze zamkna sie razem z nim (zlecenie calego zamowienia
  -- na prowadzacego). Petla czyta migawke z chwili otwarcia, wiec kazdy wiersz
  -- jest sprawdzany ponownie pod blokada (gosc mogl juz zamknac sie kaskada).
  FOR v_reg_id IN
    SELECT r.id
      FROM public.event_registrations r
     WHERE r.tenant_id = _tenant
       AND r.event_id = _event_id
       AND r.status IN ('draft', 'pending', 'waitlist', 'approved')
       AND r.payment_status IN ('paid', 'partially_refunded')
     ORDER BY (r.group_lead_registration_id IS NOT NULL), r.created_at, r.id
  LOOP
    PERFORM 1 FROM public.event_registrations r
     WHERE r.id = v_reg_id AND r.tenant_id = _tenant
       AND r.status IN ('draft', 'pending', 'waitlist', 'approved')
       AND r.payment_status IN ('paid', 'partially_refunded')
     FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Skutek PRZED zmiana statusu: goscie kaskady sa jeszcze aktywni.
    v_assess := public._event_registration_refund_assess(_tenant, v_reg_id, 'organizer_cancelled', now());
    -- Odwolanie po koncu wydarzenia: pieniadze nie wracaja same - decyduje
    -- organizator (zlecenie w przegladzie z powodem „bez decyzji o zwrocie").
    IF v_ended AND v_assess->>'job_state' = 'pending' THEN
      v_assess := v_assess || jsonb_build_object(
        'job_state', 'needs_review',
        'review_reason', 'closed_without_refund_decision');
    END IF;

    UPDATE public.event_registrations r
       SET status = 'cancelled',
           cancelled_at = now(),
           waitlist_position = NULL,
           decided_by = _actor,
           decided_at = now(),
           decision_source = CASE WHEN _actor IS NULL THEN 'system' ELSE 'organizer' END,
           qr_token_hash = NULL,
           qr_issued_at = NULL
     WHERE r.id = v_reg_id AND r.tenant_id = _tenant;

    PERFORM public.emit_domain_event(
      _tenant,
      'event_registration',
      v_reg_id::text,
      'event.registration.cancelled.v1',
      jsonb_build_object('event_id', _event_id, 'by', 'event_cancelled',
                         'refund_effect', v_assess->>'effect'),
      _actor
    );

    -- `organizer_cancelled` nie dzwoni po jednym zgloszeniu - zbiorczy
    -- dzwonek nizej.
    v_refund := public._event_registration_cancel_refund(
      _tenant, v_reg_id, 'organizer_cancelled', _actor, v_assess);

    v_closed := v_closed + 1;
    IF v_refund->>'job_state' = 'pending' THEN
      v_queued := v_queued + 1;
    ELSIF v_refund->>'job_state' = 'needs_review' THEN
      v_review := v_review + 1;
    END IF;
  END LOOP;

  -- Jeden dzwonek na odwolanie, nie po jednym na zgloszenie. Cudzyslow
  -- tytulu doklejany `||`, nie w szablonie formatu (lekser bramki
  -- check_whitelist_writers - patrz 20261012170000:C3).
  IF v_closed > 0 THEN
    PERFORM public._event_refund_alert_organizers(
      _tenant, _event_id,
      'Odwołane wydarzenie: opłacone zgłoszenia zamknięte',
      'Event cancelled: paid registrations closed',
      format('%s: zamknięto opłaconych zgłoszeń: %s. Zwroty zlecone automatycznie: %s, czekające na decyzję w dzienniku zwrotów: %s.',
             '„' || v_title_pl || '”', v_closed, v_queued, v_review),
      format('"%s": paid registrations closed: %s. Refunds queued automatically: %s, waiting for a decision in the refund journal: %s.',
             v_title_en, v_closed, v_queued, v_review));
  END IF;

  RETURN jsonb_build_object('closed', v_closed, 'refunds_queued', v_queued, 'refunds_review', v_review);
END $$;

REVOKE ALL ON FUNCTION public._event_cancelled_event_close_paid(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cancelled_event_close_paid(uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public._event_cancelled_event_close_paid(uuid, uuid, uuid) IS
  'REG-03 (R45): zamyka OTWARTE oplacone (paid/partially_refunded) zgloszenia ODWOLANEGO wydarzenia: blokady wydarzenie -> bilety -> zgloszenie, ocena organizer_cancelled (pelny zwrot), status cancelled bez QR, zlecenie przez _event_registration_cancel_refund; po efektywnym koncu wydarzenia zlecenie w przegladzie (closed_without_refund_decision). Prowadzacy przed goscmi, jeden zbiorczy dzwonek, bez awansu. Wydarzenie nieodwolane -> nic. Idempotentna. {closed, refunds_queued, refunds_review}. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- B) KAZDA DROGA ODWOLANIA ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tg_event_cancelled_closes_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Bez EXCEPTION WHEN OTHERS (inaczej niz `tg_events_status_notify`): blad
  -- wycofuje odwolanie - wydarzenie odwolane bez zwrotow to ten sam defekt.
  PERFORM public._event_cancelled_event_close_paid(NEW.tenant_id, NEW.id, auth.uid());
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public._tg_event_cancelled_closes_paid() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS events_zz_cancelled_closes_paid ON public.events;
CREATE TRIGGER events_zz_cancelled_closes_paid
  AFTER UPDATE OF status ON public.events
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public._tg_event_cancelled_closes_paid();

COMMENT ON FUNCTION public._tg_event_cancelled_closes_paid() IS
  'REG-03 (R45): trigger AFTER UPDATE OF status na events - przejscie W cancelled (RPC admin_event_set_status, UPDATE panelu, rola serwisowa) zamyka oplacone zgloszenia ze zwrotem (_event_cancelled_event_close_paid). Bledu nie polyka.';

-- C) USUNIECIE WYDARZENIA Z PIENIEDZMI ----------------------------------------------
CREATE OR REPLACE FUNCTION public._tg_events_delete_keeps_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Kaskada z usuniecia najemcy (wyzwalacz klucza obcego tenants -> events,
  -- glebokosc > 1) to operacja platformy, nie organizatora - przechodzi.
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.event_registrations r
        WHERE r.tenant_id = OLD.tenant_id
          AND r.event_id = OLD.id
          AND r.payment_status IN ('paid', 'partially_refunded'))
     OR EXISTS (
       SELECT 1 FROM public.event_registration_refund_jobs j
        WHERE j.tenant_id = OLD.tenant_id
          AND j.event_id = OLD.id) THEN
    RAISE EXCEPTION 'event_has_payments: this event has paid registrations or refund history - cancel the event instead of deleting it';
  END IF;
  RETURN OLD;
END $$;

REVOKE ALL ON FUNCTION public._tg_events_delete_keeps_payments() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS events_00_delete_keeps_payments ON public.events;
CREATE TRIGGER events_00_delete_keeps_payments
  BEFORE DELETE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_events_delete_keeps_payments();

COMMENT ON FUNCTION public._tg_events_delete_keeps_payments() IS
  'REG-03 (R45): trigger BEFORE DELETE na events - wydarzenie z oplaconym zgloszeniem (paid/partially_refunded) albo z jakimkolwiek zleceniem zwrotu -> event_has_payments (odwolaj zamiast usuwac). Kaskada z usuniecia najemcy (pg_trigger_depth() > 1) przechodzi.';
