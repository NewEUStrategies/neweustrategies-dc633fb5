-- events-harness: include
-- ============================================================================
-- SCALENIE Z MAIN (PR #504), CZ. 1: KOLEJKA ZWROTOW ZGLOSZEN = REG-03/R45
-- (KAZDE ZAMKNIECIE OPLACONEGO ZGLOSZENIA, DECYZJE ORGANIZATORA) + INV-19c
-- (ESKALACJA Z ALARMEM, BUDZET PROB, `refund.failed`, BRAK POTWIERDZENIA).
--
-- POCHODZENIE
--   * main: 20261012120000_event_refund_jobs_escalation.sql (INV-19c) - helper
--     `_event_refund_job_escalate` (JEDYNE wejscie do `needs_review` z alarmem
--     `_tenant_admins_alert`), budzet prob 10, sweep `failed`/porzuconej
--     dzierzawy/`submitted` > 7 dni, webhook `refund.failed`, czysty budzet
--     przy ponownym zleceniu, `refund_unconfirmed` blokuje przywrocenie,
--     `escalated_at` w dzienniku; 20261012130100 (TIX-05) - odmowa wplaty
--     zaklada zlecenie (`_event_ticket_payment_refused`).
--   * REG: 20261012170000/170050 (REG-03) i 20261012181200 (R45) - zlecenie
--     przy KAZDYM zamknieciu, wplata reczna bez zamowienia, pochodzenie,
--     powod zamkniecia, decyzje organizatora, zlecenie platnika przy wspolnej
--     wplacie, rezygnacja ze zwrotu wygrywa z `pending`.
--
-- DEFEKT (stan po samym scaleniu)
--   Pliki REG sortuja sie PO 20261012120000, wiec ich ciala
--   `_event_rejection_refund_queue`, `_event_refund_reapproval_guard`,
--   `_event_registration_refunds_claim`, `_event_registration_refunds_settle`
--   i `admin_event_refund_jobs` po cichu WYCOFYWALY INV-19c: dziesiata porazka
--   zostawala `failed` bez alarmu (budzet sprawdzany literalem, eskalacja
--   tylko dzwonkiem REG), `submitted` bez potwierdzenia wisial bez konca,
--   wspolna platnosc szla do przegladu bez alarmu i z powodem w `last_error`,
--   ponowne zlecenie nie czyscilo `escalated_at`/`provider_refund_id`,
--   przywrocenie zgloszenia przy `refund_unconfirmed` wycofywalo zlecenie
--   (bilet i pieniadze naraz), a dziennik nie oddawal `escalated_at`.
--   Odwrotnie: zlecenie z odmowy wplaty (TIX-05) dostawalo domyslne
--   pochodzenie REG `organizer_rejected` (naprawa zapisu: 20261013900100,
--   tu - wiersze juz zapisane).
--
-- ZMIANA (unia obu intencji, ciala zbudowane na NAJNOWSZYCH definicjach:
--   kolejka i straznik - 20261012181200, claim/settle/dziennik - 20261012170050
--   + 20261012120000, helper eskalacji - 20261012120000)
--   1. CHECK-i powodu: jeden slownik (`event_refund_jobs_review_reason_values`
--      - zamkniecie REG + eskalacja main) i regula main "needs_review zawsze
--      z powodem" pod nazwa main (`event_refund_jobs_review_reason_check`) -
--      ten sam stan co 20261012170000.
--   2. `_event_refund_job_escalate`: cialo main, tresc alarmu bez slowa
--      "odrzucone" - zlecenia REG pochodza tez z rezygnacji i anulowania.
--   3. Kolejka: odrzucenie przy wspolnej wplacie wchodzi do przegladu PRZEZ
--      helper eskalacji (powod `active_registrations_share_payment` + alarm,
--      w tej samej transakcji - worker nie zobaczy `pending`); ponowne
--      zlecenie startuje z czystym budzetem i bez starego alarmu; zlecenie
--      `refund_unconfirmed` (pieniadze moga byc w drodze) nie jest nadpisywane.
--   4. Straznik: `refund_unconfirmed` blokuje przywrocenie (main); zlecenie
--      INNEGO zgloszenia na wspolnej wplacie wchodzi do przegladu przez helper
--      eskalacji (R45 + alarm), `last_error` zostaje bledem operatora.
--   5. Claim: zamiatanie eskalacji main + tylko zlecenia z zamowieniem +
--      pochodzenie w odpowiedzi (REG). Settle: eskalacja main przy ostatniej
--      porazce + zdarzenie `event.registration.refund_failed.v1` (REG) -
--      jeden alarm (helper), bez drugiego dzwonka REG.
--   6. Dziennik: pola REG + `escalated_at` (main).
--   7. Zapis zlecenia po rezygnacji, decyzja organizatora i odmowa wplaty
--      (TIX-05) - osobny plik 20261013900100 (limit 45 KiB).
--   8. Backfill: zlecenia z odmowy wplaty (znacznik `ticket_refusal` na
--      zamowieniu) dostaja pochodzenie `system` zamiast domyslnego
--      `organizer_rejected` (odmowa juz wdrozona w main: 20261012130100).
--
-- CZEGO TO NIE ZAMYKA. Dwa helpery dzwonka (`_tenant_admins_alert` main
--   i `_event_refund_alert_organizers` REG) zostaja - pierwszy wymaga profilu
--   w najemcy, drugi nie; ujednolicenie odbiorcow to osobna decyzja.
--
-- KOLEJNOSC WDROZENIA: dowolna wzgledem kodu (sygnatury bez zmian, nowe klucze
--   odpowiedzi addytywne); PO wszystkich migracjach main i REG.
-- IDEMPOTENTNA: DROP CONSTRAINT IF EXISTS + ADD, UPDATE z warunkiem na stan
--   docelowy, CREATE OR REPLACE, DROP TRIGGER IF EXISTS + CREATE TRIGGER,
--   bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/reg_main_merge_test.sql,
--   scripts/events-harness/runtime_test.d/24b_refund_jobs_escalation.sql (main),
--   supabase/tests/event_refund_r45_test.sql, event_registration_cancel_refund_test.sql.
-- ============================================================================

-- 1) CHECK-I POWODU ----------------------------------------------------------
ALTER TABLE public.event_registration_refund_jobs
  DROP CONSTRAINT IF EXISTS event_refund_jobs_review_reason_check,
  DROP CONSTRAINT IF EXISTS event_refund_jobs_review_reason_values,
  DROP CONSTRAINT IF EXISTS event_refund_jobs_needs_review_has_reason;
ALTER TABLE public.event_registration_refund_jobs
  ADD CONSTRAINT event_refund_jobs_review_reason_values CHECK (
    review_reason IS NULL OR review_reason IN (
      'outside_refund_window', 'refund_disabled', 'shared_payment', 'manual_payment',
      'organizer_waived', 'closed_without_refund_decision',
      'active_registrations_share_payment', 'attempts_exhausted',
      'provider_refund_failed', 'refund_unconfirmed')),
  ADD CONSTRAINT event_refund_jobs_review_reason_check CHECK (
    state <> 'needs_review' OR review_reason IS NOT NULL);

COMMENT ON COLUMN public.event_registration_refund_jobs.review_reason IS
  'Dlaczego zlecenie czeka na czlowieka albo dlaczego zwrotu nie ma. Zamkniecie (REG-03): outside_refund_window | refund_disabled | shared_payment | manual_payment | organizer_waived | closed_without_refund_decision. Eskalacja kolejki z alarmem (INV-19c, wylacznie _event_refund_job_escalate): active_registrations_share_payment | attempts_exhausted | provider_refund_failed | refund_unconfirmed. needs_review zawsze z powodem. last_error zostaje bledem operatora.';

-- 8) BACKFILL POCHODZENIA ODMOW WPLATY --------------------------------------
UPDATE public.event_registration_refund_jobs j
   SET origin = 'system', updated_at = now()
  FROM public.payment_orders o
 WHERE o.id = j.payment_order_id AND o.tenant_id = j.tenant_id
   AND COALESCE(o.metadata, '{}'::jsonb) ? 'ticket_refusal'
   AND j.origin = 'organizer_rejected'
   AND NOT EXISTS (
     SELECT 1 FROM public.event_registrations r
      WHERE r.id = j.registration_id AND r.tenant_id = j.tenant_id
        AND r.status = 'rejected' AND r.payment_order_id = j.payment_order_id);

-- 2) HELPER ESKALACJI ----------------------------------------------------------
-- Cialo z 20261012120000:129-216. ZMIANA (scalenie): tresc alarmu nie mowi
-- "odrzucone zgloszenie" - po REG-03 zlecenie powstaje tez z rezygnacji,
-- anulowania i zamkniecia bez decyzji. Liczba prob i okno potwierdzenia
-- zostaja w tresci (test 24b).
CREATE OR REPLACE FUNCTION public._event_refund_job_escalate(
  p_job_id uuid,
  p_reason text,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job record;
  v_from text[];
  v_event_pl text;
  v_event_en text;
  v_body_pl text;
  v_body_en text;
BEGIN
  v_from := CASE p_reason
    WHEN 'attempts_exhausted' THEN ARRAY['pending', 'failed', 'processing']
    WHEN 'active_registrations_share_payment' THEN ARRAY['pending', 'failed']
    WHEN 'refund_unconfirmed' THEN ARRAY['submitted']
    WHEN 'provider_refund_failed' THEN ARRAY['submitted', 'completed']
  END;
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'invalid_review_reason: %', p_reason;
  END IF;

  UPDATE public.event_registration_refund_jobs j
     SET state = 'needs_review',
         review_reason = p_reason,
         last_error = COALESCE(left(p_error, 500), j.last_error),
         escalated_at = clock_timestamp(),
         claim_token = NULL,
         updated_at = now()
   WHERE j.id = p_job_id AND j.state = ANY (v_from)
  RETURNING j.id, j.tenant_id, j.event_id, j.payment_order_id, j.attempts, j.last_error
    INTO v_job;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT COALESCE(NULLIF(btrim(e.title_pl), ''), NULLIF(btrim(e.title_en), ''), '-'),
         COALESCE(NULLIF(btrim(e.title_en), ''), NULLIF(btrim(e.title_pl), ''), '-')
    INTO v_event_pl, v_event_en
    FROM public.events e
   WHERE e.id = v_job.event_id AND e.tenant_id = v_job.tenant_id;

  CASE p_reason
    WHEN 'attempts_exhausted' THEN
      v_body_pl := format('Zwrot za zgłoszenie na „%s” (zamówienie %s) nie doszedł do skutku po %s próbach. Zleć zwrot ręcznie u operatora płatności albo zdecyduj w dzienniku zwrotów.',
        v_event_pl, v_job.payment_order_id, v_job.attempts);
      v_body_en := format('The refund for a registration for "%s" (order %s) failed after %s attempts. Issue it manually with the payment provider or decide in the refund journal.',
        v_event_en, v_job.payment_order_id, v_job.attempts);
    WHEN 'provider_refund_failed' THEN
      v_body_pl := format('Operator płatności odrzucił zwrot za zgłoszenie na „%s” (zamówienie %s, powód: %s). Pieniądze nie wróciły do uczestnika - zleć zwrot inną drogą.',
        v_event_pl, v_job.payment_order_id, COALESCE(v_job.last_error, 'unknown'));
      v_body_en := format('The payment provider rejected the refund for a registration for "%s" (order %s, reason: %s). The money did not reach the attendee - refund them another way.',
        v_event_en, v_job.payment_order_id, COALESCE(v_job.last_error, 'unknown'));
    WHEN 'refund_unconfirmed' THEN
      v_body_pl := format('Zwrot za zgłoszenie na „%s” (zamówienie %s) od ponad %s dni czeka na potwierdzenie operatora płatności. Sprawdź jego status u operatora.',
        v_event_pl, v_job.payment_order_id, public._event_refund_unconfirmed_days());
      v_body_en := format('The refund for a registration for "%s" (order %s) has awaited provider confirmation for more than %s days. Check its status with the payment provider.',
        v_event_en, v_job.payment_order_id, public._event_refund_unconfirmed_days());
    ELSE
      v_body_pl := format('Zamknięte zgłoszenie na „%s” opłacono wspólną płatnością (zamówienie %s), z której inni uczestnicy nadal korzystają. Rozlicz zwrot częściowy w panelu płatności albo zamknij zlecenie w dzienniku zwrotów.',
        v_event_pl, v_job.payment_order_id);
      v_body_en := format('A closed registration for "%s" was paid with a shared payment (order %s) that still covers other attendees. Arrange a partial refund in the payments panel or close the request in the refund journal.',
        v_event_en, v_job.payment_order_id);
  END CASE;

  PERFORM public._tenant_admins_alert(
    v_job.tenant_id,
    'Zwrot wymaga decyzji',
    'Refund needs attention',
    v_body_pl,
    v_body_en,
    format('/admin/events/%s/registration/list?refund_job=%s', v_job.event_id, v_job.id)
  );
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._event_refund_job_escalate(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_refund_job_escalate(uuid, text, text) TO service_role;
COMMENT ON FUNCTION public._event_refund_job_escalate(uuid, text, text) IS
  'Jedyne wejscie zlecenia zwrotu do needs_review z powodem ESKALACJI (attempts_exhausted, active_registrations_share_payment, refund_unconfirmed, provider_refund_failed): powod, stempel escalated_at i alarm dla administratorow najemcy w tej samej transakcji. Powody zamkniecia REG-03 wpisuja ich wlasni autorzy (kolejka, zapis zlecenia). Tylko z cial SECURITY DEFINER.';

-- 3) KOLEJKA ZWROTOW ----------------------------------------------------------
-- Cialo z 20261012181200 (A+B). Zmiany `ZMIANA (scalenie z main)`.
CREATE OR REPLACE FUNCTION public._event_rejection_refund_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_payer uuid := COALESCE(NEW.group_lead_registration_id, NEW.id);
  v_shared boolean;
  v_job uuid;
BEGIN
  -- (1) Odrzucenie przez organizatora: zwrot automatyczny.
  IF NEW.status = 'rejected' AND NEW.payment_status IN ('paid', 'partially_refunded')
     AND NEW.payment_order_id IS NOT NULL
     AND (OLD.status <> 'rejected' OR OLD.payment_status NOT IN ('paid', 'partially_refunded')) THEN
    -- R45: odrzucony gosc, ktorego prowadzacy (albo inny gosc) nadal ma
    -- miejsce, nie zleca zwrotu CALEGO zamowienia - zlecenie na odrzuconym
    -- zgloszeniu idzie do przegladu. Bez wspolnej wplaty zlecenie calego
    -- zamowienia nalezy do PLATNIKA.
    v_shared := EXISTS (
      SELECT 1 FROM public.event_registrations x
       WHERE x.tenant_id = NEW.tenant_id
         AND x.payment_order_id = NEW.payment_order_id
         AND x.id <> NEW.id
         AND x.status NOT IN ('cancelled', 'rejected'));
    -- ZMIANA (scalenie z main): wiersz wchodzi jako `pending` z CZYSTYM
    -- budzetem (INV-19c: ponowne zlecenie po przywroceniu nie dziedziczy
    -- `attempts = 10`, starego alarmu ani identyfikatora zwrotu), a wspolna
    -- wplata przechodzi do przegladu helperem eskalacji ponizej - w tej samej
    -- transakcji, wiec worker nigdy nie widzi `pending`. Zlecenie
    -- `refund_unconfirmed` (zwrot moze jeszcze dojsc) zostaje nietkniete.
    INSERT INTO public.event_registration_refund_jobs(
      tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason)
    SELECT NEW.tenant_id, NEW.event_id, o.id,
           CASE WHEN v_shared THEN NEW.id ELSE v_payer END,
           'pending', 'organizer_rejected', NULL
      FROM public.payment_orders o
     WHERE o.id = NEW.payment_order_id AND o.tenant_id = NEW.tenant_id
       AND o.metadata->>'event_id' = NEW.event_id::text
       AND o.metadata->>'registration_id' = v_payer::text
    ON CONFLICT (payment_order_id) DO UPDATE SET
      registration_id = EXCLUDED.registration_id,
      state = 'pending',
      origin = EXCLUDED.origin,
      review_reason = NULL,
      attempts = 0,
      escalated_at = NULL,
      provider_refund_id = NULL,
      claim_token = NULL,
      last_error = NULL,
      next_attempt_at = now(),
      updated_at = now()
    WHERE event_registration_refund_jobs.state IN ('needs_review', 'cancelled')
      AND event_registration_refund_jobs.review_reason IS DISTINCT FROM 'refund_unconfirmed'
    RETURNING id INTO v_job;
    IF v_job IS NOT NULL AND v_shared THEN
      PERFORM public._event_refund_job_escalate(v_job, 'active_registrations_share_payment');
    END IF;
  END IF;

  -- (2) Siatka bezpieczenstwa (REG-03): KAZDE inne przejscie oplaconego
  -- zgloszenia w zamkniete zostawia co najmniej `needs_review`.
  IF NEW.status IN ('cancelled', 'rejected')
     AND NEW.payment_status IN ('paid', 'partially_refunded')
     AND (OLD.status NOT IN ('cancelled', 'rejected')
          OR OLD.payment_status NOT IN ('paid', 'partially_refunded')) THEN
    IF NEW.payment_order_id IS NOT NULL THEN
      v_shared := EXISTS (
        SELECT 1 FROM public.event_registrations x
         WHERE x.tenant_id = NEW.tenant_id
           AND x.payment_order_id = NEW.payment_order_id
           AND x.id <> NEW.id
           AND x.status NOT IN ('cancelled', 'rejected'));
      INSERT INTO public.event_registration_refund_jobs(
        tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason)
      SELECT NEW.tenant_id, NEW.event_id, o.id,
             CASE WHEN NOT v_shared AND o.metadata->>'registration_id' = v_payer::text
                  THEN v_payer ELSE NEW.id END,
             'needs_review',
             CASE WHEN NEW.status = 'rejected' THEN 'organizer_rejected' ELSE 'system' END,
             'closed_without_refund_decision'
        FROM public.payment_orders o
       WHERE o.id = NEW.payment_order_id AND o.tenant_id = NEW.tenant_id
         AND o.status::text = 'paid'
         AND COALESCE(o.amount_cents, 0) - COALESCE(o.refunded_amount_cents, 0) > 0
      ON CONFLICT (payment_order_id) DO NOTHING;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.plan_ticket_claims c
       WHERE c.registration_id = NEW.id
          OR (NEW.group_lead_registration_id IS NOT NULL
              AND c.registration_id = NEW.group_lead_registration_id)
    ) THEN
      INSERT INTO public.event_registration_refund_jobs(
        tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason)
      VALUES (NEW.tenant_id, NEW.event_id, NULL, NEW.id, 'needs_review',
              CASE WHEN NEW.status = 'rejected' THEN 'organizer_rejected' ELSE 'system' END,
              'manual_payment')
      ON CONFLICT (registration_id) WHERE payment_order_id IS NULL DO NOTHING;
    END IF;
  END IF;

  -- (3) R45: zakonczenie zlecenia z zamowieniem tylko wtedy, gdy zamowienie
  -- naprawde jest zwrocone, albo gdy zwrot oznaczono na zgloszeniu zlecenia.
  IF NEW.payment_status = 'refunded' AND NEW.payment_order_id IS NOT NULL THEN
    UPDATE public.event_registration_refund_jobs j
       SET state = 'completed', claim_token = NULL, updated_at = now()
     WHERE j.payment_order_id = NEW.payment_order_id AND j.tenant_id = NEW.tenant_id
       AND (j.registration_id = NEW.id
            OR EXISTS (
              SELECT 1 FROM public.payment_orders o
               WHERE o.id = NEW.payment_order_id AND o.tenant_id = NEW.tenant_id
                 AND (o.status::text = 'refunded'
                      OR (COALESCE(o.amount_cents, 0) > 0
                          AND COALESCE(o.refunded_amount_cents, 0) >= o.amount_cents))));
  END IF;
  -- (4) REG-03: zlecenie bez zamowienia konczy reczne oznaczenie zwrotu.
  IF NEW.payment_status = 'refunded' AND OLD.payment_status IS DISTINCT FROM 'refunded' THEN
    UPDATE public.event_registration_refund_jobs SET state = 'completed', claim_token = NULL, updated_at = now()
    WHERE payment_order_id IS NULL AND registration_id = NEW.id AND tenant_id = NEW.tenant_id
      AND state <> 'completed';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._event_rejection_refund_queue() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registrations_zz_refund_queue ON public.event_registrations;
CREATE TRIGGER event_registrations_zz_refund_queue AFTER UPDATE OF status, payment_status
ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public._event_rejection_refund_queue();

COMMENT ON FUNCTION public._event_rejection_refund_queue() IS
  'Kolejka zwrotow (trigger AFTER UPDATE OF status, payment_status): odrzucenie oplaconego -> pending na platniku z czystym budzetem (INV-19c), przy wspolnej wplacie z innym aktywnym zgloszeniem - eskalacja active_registrations_share_payment z alarmem w tej samej transakcji (R45 + INV-19c); refund_unconfirmed nietkniete; KAZDE inne przejscie oplaconego zgloszenia w zamkniete -> co najmniej needs_review (closed_without_refund_decision, bez zamowienia: manual_payment); refunded konczy zlecenie z zamowieniem tylko przy zwroconym zamowieniu albo na zgloszeniu zlecenia, bez zamowienia - po zgloszeniu.';

-- 4) PONOWNE PRZYJECIE ---------------------------------------------------------
-- Cialo z 20261012181200 (C) + warunek z 20261012120000 (4b).
CREATE OR REPLACE FUNCTION public._event_refund_reapproval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_job uuid;
BEGIN
  IF OLD.status IN ('cancelled', 'rejected') AND NEW.status NOT IN ('cancelled', 'rejected') THEN
    PERFORM 1 FROM public.event_registration_refund_jobs j
    WHERE j.tenant_id = NEW.tenant_id
      AND (j.payment_order_id = NEW.payment_order_id
           OR (j.payment_order_id IS NULL AND j.registration_id = NEW.id))
    ORDER BY j.id
    FOR UPDATE;
    -- Pieniadze tej wplaty sa juz u operatora - ponowne przyjecie (takze
    -- goscia dzielacego wplate) zostawiloby miejsce bez zaplaty.
    -- ZMIANA (scalenie z main, INV-19c): `refund_unconfirmed` blokuje tak samo
    -- jak `submitted` - eskalacja po 7 dniach nie zdejmuje blokady, bo zwrot
    -- moze jeszcze dojsc (uczestnik z biletem i z pieniedzmi).
    IF EXISTS (SELECT 1 FROM public.event_registration_refund_jobs j
      WHERE j.tenant_id = NEW.tenant_id
        AND (j.payment_order_id = NEW.payment_order_id
             OR (j.payment_order_id IS NULL AND j.registration_id = NEW.id))
        AND (j.state IN ('processing', 'submitted')
             OR (j.state = 'needs_review' AND j.review_reason = 'refund_unconfirmed'))) THEN
      RAISE EXCEPTION 'invalid_transition: refund already in progress; create a new registration';
    END IF;

    -- Zlecenie TEGO zgloszenia (z jego zamowieniem albo reczne): ponowne
    -- przyjecie je wycofuje.
    UPDATE public.event_registration_refund_jobs j SET state = 'cancelled', updated_at = now()
    WHERE j.tenant_id = NEW.tenant_id
      AND j.registration_id = NEW.id
      AND (j.payment_order_id IS NULL OR j.payment_order_id = NEW.payment_order_id)
      AND j.state IN ('pending', 'failed', 'needs_review');

    -- Zlecenie INNEGO zgloszenia (np. prowadzacego) na tej samej wplacie:
    -- wraca miejsce oplacone ta wplata, wiec zwrot calosci jest bledny.
    -- ZMIANA (scalenie z main): zlecenie jeszcze probowane wchodzi do
    -- przegladu helperem eskalacji (powod + alarm), zlecenie juz w przegladzie
    -- dostaje powod wspolnej platnosci bez drugiego alarmu; `last_error`
    -- zostaje bledem operatora (INV-19c przeniosl powod do kolumny).
    UPDATE public.event_registration_refund_jobs j SET
      review_reason = 'active_registrations_share_payment',
      updated_at = now()
    WHERE j.tenant_id = NEW.tenant_id
      AND j.payment_order_id = NEW.payment_order_id
      AND j.registration_id IS DISTINCT FROM NEW.id
      AND j.state = 'needs_review';
    FOR v_job IN
      SELECT j.id FROM public.event_registration_refund_jobs j
       WHERE j.tenant_id = NEW.tenant_id
         AND j.payment_order_id = NEW.payment_order_id
         AND j.registration_id IS DISTINCT FROM NEW.id
         AND j.state IN ('pending', 'failed')
       ORDER BY j.id
    LOOP
      PERFORM public._event_refund_job_escalate(v_job, 'active_registrations_share_payment');
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._event_refund_reapproval_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registrations_refund_reapproval ON public.event_registrations;
CREATE TRIGGER event_registrations_refund_reapproval BEFORE UPDATE OF status
ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public._event_refund_reapproval_guard();

COMMENT ON FUNCTION public._event_refund_reapproval_guard() IS
  'Straznik ponownego przyjecia (BEFORE UPDATE OF status, z cancelled/rejected do otwartego): zlecenie w drodze (processing/submitted) albo needs_review/refund_unconfirmed na wplacie -> invalid_transition (INV-19c); zlecenie TEGO zgloszenia (pending/failed/needs_review) -> cancelled; zlecenie INNEGO zgloszenia na tej samej wplacie -> przeglad active_registrations_share_payment (eskalacja z alarmem, R45 + INV-19c).';

-- 5a) DZIERZAWA ------------------------------------------------------------------
-- Cialo z 20261012120000 (5) + `j.payment_order_id IS NOT NULL` i `origin`
-- z 20261012170050 (D3).
CREATE OR REPLACE FUNCTION public._event_registration_refunds_claim(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_jobs jsonb;
  v_budget CONSTANT integer := public._event_refund_attempt_budget();
  v_unconfirmed CONSTANT interval := make_interval(days => public._event_refund_unconfirmed_days());
  v_due record;
BEGIN
  -- Zwrot potwierdzony webhookiem zamyka zlecenie w kazdym stanie - z jednym
  -- wyjatkiem: `provider_refund_failed` na zamowieniu juz `refunded` to zwrot,
  -- ktory operator cofnal PO `charge.refunded`.
  UPDATE public.event_registration_refund_jobs j SET state = 'completed', claim_token = NULL, updated_at = now()
  FROM public.payment_orders o WHERE o.id = j.payment_order_id AND o.tenant_id = j.tenant_id
    AND o.status = 'refunded' AND j.state <> 'completed'
    AND NOT (j.state = 'needs_review' AND j.review_reason IS NOT DISTINCT FROM 'provider_refund_failed');

  -- Eskalacje (INV-19c). Wspolna platnosc ma pierwszenstwo przed budzetem.
  -- Zlecenia reczne (bez zamowienia) nigdy nie sa w tych stanach (CHECK
  -- `event_refund_jobs_manual_needs_review`) - warunek jest jawny dla czytelnika.
  FOR v_due IN
    SELECT j.id,
      CASE
        WHEN j.state IN ('pending', 'failed') AND s.shared THEN 'active_registrations_share_payment'
        WHEN j.state = 'submitted' THEN 'refund_unconfirmed'
        ELSE 'attempts_exhausted'
      END AS reason
    FROM public.event_registration_refund_jobs j
    CROSS JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1 FROM public.event_registrations r WHERE r.payment_order_id = j.payment_order_id
          AND r.tenant_id = j.tenant_id AND r.status NOT IN ('cancelled', 'rejected')) AS shared
    ) s
    WHERE j.payment_order_id IS NOT NULL
      AND ((j.state IN ('pending', 'failed') AND (s.shared OR j.attempts >= v_budget))
       OR (j.state = 'processing' AND j.claimed_at < now() - interval '15 minutes' AND j.attempts >= v_budget)
       OR (j.state = 'submitted' AND COALESCE(j.claimed_at, j.updated_at) < now() - v_unconfirmed))
    ORDER BY j.created_at, j.id
    LIMIT 100
    FOR UPDATE OF j SKIP LOCKED
  LOOP
    PERFORM public._event_refund_job_escalate(v_due.id, v_due.reason);
  END LOOP;

  WITH picked AS (
    SELECT j.id FROM public.event_registration_refund_jobs j
    WHERE j.payment_order_id IS NOT NULL
      AND ((j.state IN ('pending', 'failed') AND j.next_attempt_at <= now())
        OR (j.state = 'processing' AND j.claimed_at < now() - interval '15 minutes'))
      AND j.attempts < v_budget
      -- Druga zapora: wspolnej platnosci grupy z aktywnymi uczestnikami NIE
      -- zwracamy w calosci nigdy.
      AND NOT EXISTS (
        SELECT 1 FROM public.event_registrations r WHERE r.payment_order_id = j.payment_order_id
          AND r.tenant_id = j.tenant_id AND r.status NOT IN ('cancelled', 'rejected'))
    ORDER BY j.created_at, j.id LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.event_registration_refund_jobs j SET state = 'processing',
      claim_token = gen_random_uuid(), claimed_at = clock_timestamp(), attempts = attempts + 1, updated_at = now()
    FROM picked p WHERE j.id = p.id RETURNING j.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', j.id, 'claim_token', j.claim_token, 'order_id', o.id, 'tenant_id', j.tenant_id,
    'environment', o.environment, 'provider', o.provider,
    'transaction_id', COALESCE(o.provider_payment_intent_id, o.provider_intent_id, o.provider_session_id),
    'order_status', o.status, 'origin', j.origin)), '[]'::jsonb) INTO v_jobs
  FROM claimed j JOIN public.payment_orders o ON o.id = j.payment_order_id AND o.tenant_id = j.tenant_id;
  RETURN v_jobs;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refunds_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_refunds_claim(integer) TO service_role;

-- 5b) ROZLICZENIE PROBY -------------------------------------------------------
-- Cialo z 20261012120000 (6) + zdarzenie na szynie z 20261012170050 (D4).
-- Jeden alarm (helper eskalacji) zamiast drugiego dzwonka REG.
CREATE OR REPLACE FUNCTION public._event_registration_refunds_settle(
  p_job_id uuid, p_claim_token uuid, p_refund_id text, p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_failed CONSTANT boolean := p_error IS NOT NULL OR p_refund_id IS NULL;
  v_attempts integer;
  v_tenant uuid;
  v_event_id uuid;
  v_registration_id uuid;
BEGIN
  UPDATE public.event_registration_refund_jobs SET
    state = CASE WHEN v_failed THEN 'failed' ELSE 'submitted' END,
    provider_refund_id = p_refund_id, last_error = left(p_error, 500), claim_token = NULL,
    next_attempt_at = now() + make_interval(mins => LEAST(1440, (power(2, LEAST(attempts, 10)))::integer)), updated_at = now()
  WHERE id = p_job_id AND claim_token = p_claim_token AND state = 'processing'
  RETURNING attempts, tenant_id, event_id, registration_id
    INTO v_attempts, v_tenant, v_event_id, v_registration_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- `attempts` podbija claim, wiec tu jest to numer WLASNIE zakonczonej proby.
  IF v_failed AND v_attempts >= public._event_refund_attempt_budget() THEN
    IF public._event_refund_job_escalate(p_job_id, 'attempts_exhausted') THEN
      -- REG-03: dziennik zwrotow w panelu odswieza sie od razu.
      PERFORM public.emit_domain_event(
        v_tenant, 'event_registration', v_registration_id::text,
        'event.registration.refund_failed.v1',
        jsonb_build_object('event_id', v_event_id, 'job_id', p_job_id),
        NULL);
    END IF;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refunds_settle(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_refunds_settle(uuid, uuid, text, text) TO service_role;

-- 6) DZIENNIK ZWROTOW W PANELU ---------------------------------------------------
-- Cialo z 20261012170050 (E1) + `escalated_at` z 20261012120000 (8).
CREATE OR REPLACE FUNCTION public.admin_event_refund_jobs(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant(); v_jobs jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j.created_at DESC), '[]'::jsonb)
  INTO v_jobs FROM (
    SELECT j.id, j.registration_id, j.payment_order_id, j.state, j.attempts, j.created_at,
      j.next_attempt_at, j.last_error, j.origin, j.review_reason, j.escalated_at,
      j.amount_cents, j.currency, j.refund_deadline_at, j.review_note, j.decided_at,
      concat_ws(' ', p.first_name, p.last_name) AS person_name
    FROM public.event_registration_refund_jobs j
    JOIN public.event_registrations r ON r.id = j.registration_id AND r.tenant_id = j.tenant_id
    JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    WHERE j.tenant_id = v_tenant AND j.event_id = p_event_id
    ORDER BY j.created_at DESC, j.id DESC LIMIT 100
  ) j;
  RETURN v_jobs;
END $$;
REVOKE ALL ON FUNCTION public.admin_event_refund_jobs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_refund_jobs(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_refund_jobs(uuid) IS
  'Dziennik zwrotow wydarzenia (ostatnie 100): stan, proby, pochodzenie, powod przegladu, chwila alarmu (escalated_at), kwota, termin, notatka decyzji, osoba, ostatni blad operatora. Bez dzierzawy workera (claim_token) i identyfikatora zwrotu. Bramka: assert_event_admin_tenant().';
