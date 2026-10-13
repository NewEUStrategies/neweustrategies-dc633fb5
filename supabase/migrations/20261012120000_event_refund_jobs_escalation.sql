-- ============================================================================
-- ZLECENIA ZWROTOW Z ESKALACJA (INV-19c): wyczerpane proby, `refund.failed`
-- i zwrot bez potwierdzenia trafiaja do `needs_review` Z ALARMEM.
-- events-harness: include
--
-- PRZYCZYNA (20260929113000:141-143, :166-169)
--   1. Claim bral wylacznie `attempts < 10`. Dziesiata porazka zostawiala
--      zlecenie w `failed` NA ZAWSZE: nikt go juz nie podejmowal i nikt o nim
--      nie wiedzial. Zwrot za odrzucone zgloszenie po prostu nie dochodzil do
--      skutku, a organizator widzial to tylko wtedy, gdy SAM otworzyl dziennik.
--   2. `submitted` znaczy "operator przyjal zlecenie", nie "pieniadze wrocily".
--      Zwrot moze jeszcze upasc u operatora (`refund.failed`: zamknieta karta,
--      odrzucenie przez bank) albo wisiec w `pending` (metody asynchroniczne,
--      wtedy `charge.refunded` jest pomijany jako nierozstrzygniety). Zadna
--      sciezka nie mapowala porazki, wiec `submitted` mogl wisiec bez konca.
--
-- CO ROBI TA MIGRACJA
--   * jeden helper `_event_refund_job_escalate` - JEDYNE wejscie do
--     `needs_review`: stan + powod (`review_reason`) + stempel `escalated_at`
--     + alarm `_tenant_admins_alert` (20261012095900) w TEJ SAMEJ transakcji.
--     Helper zna dozwolone stany zrodlowe kazdego powodu, wiec zaden wolajacy
--     nie zamieni `cancelled` ani `needs_review` w drugi alarm;
--   * `_event_registration_refunds_settle`: porazka, ktora wyczerpuje budzet
--     prob (`_event_refund_attempt_budget()` = 10), od razu eskaluje;
--   * `_event_registration_refunds_claim`: zamiatanie zastanych zlecen
--     (`failed`/`pending` z budzetem wyczerpanym przed ta migracja, porzucona
--     dzierzawa po ostatniej probie), siatka bezpieczenstwa dla `submitted`
--     bez potwierdzenia dluzej niz `_event_refund_unconfirmed_days()` = 7 dni
--     oraz dotychczasowa wspolna platnosc grupy - teraz takze z alarmem;
--   * `_event_registration_refund_failed` - webhook `refund.failed`
--     (`refund.updated` -> failed/canceled) przenosi zlecenie do `needs_review`;
--     najemca pochodzi z WIERSZA zlecenia, nigdy z ladunku operatora;
--   * ponowne zlecenie po decyzji organizatora startuje z CZYSTYM budzetem
--     (dotad `attempts` zostawalo 10 i nowe zlecenie nigdy nie bylo podejmowane);
--   * `refund_unconfirmed` blokuje przywrocenie zgloszenia tak jak `submitted`
--     (eskalacja nie moze otwierac drogi do biletu przy zwrocie w drodze).
--
-- DLACZEGO ALARM RAZ: przejscie do `needs_review` jest jednorazowe (helper nie
-- rusza wiersza, ktory juz tam jest), a href niesie id zlecenia, wiec
-- deduplikacja 5 minut w `enqueue_notification` nie polyka roznych zlecen.
-- Kolejny alarm dla tego samego zlecenia wymaga nowego epizodu (zlecenie
-- wyszlo z `needs_review` i wrocilo z innego powodu).
--
-- STALE: budzet prob i okno potwierdzenia sa funkcjami IMMUTABLE, bo czyta je
-- claim, settle i tresc alarmu. Lustro w TS: `REFUND_ATTEMPT_BUDGET`
-- (src/lib/events/registrationRefundJournal.ts) - test parzystosci pilnuje,
-- zeby panel nie obiecywal innej liczby prob niz baza.
--
-- PLASZCZYZNA: wszystko poza `admin_event_refund_jobs` = service_role.
-- Testy: scripts/events-harness/runtime_test.d/24b_refund_jobs_escalation.sql.
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP + ADD CHECK.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Powod przegladu i stempel alarmu.
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_registration_refund_jobs
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz;

COMMENT ON COLUMN public.event_registration_refund_jobs.review_reason IS
  'Dlaczego zlecenie czeka na czlowieka: active_registrations_share_payment | attempts_exhausted | provider_refund_failed | refund_unconfirmed. last_error zostaje bledem operatora.';
COMMENT ON COLUMN public.event_registration_refund_jobs.escalated_at IS
  'Kiedy administratorzy najemcy dostali alarm o tym zleceniu (ostatnie wejscie do needs_review). NULL = nigdy.';

-- Jedynym producentem `needs_review` przed ta migracja byla wspolna platnosc
-- grupy (claim, 20260929113000:146-150), ktora wpisywala powod do `last_error`.
-- Powod przechodzi do wlasnej kolumny, a `last_error` znow znaczy blad operatora.
UPDATE public.event_registration_refund_jobs
   SET review_reason = 'active_registrations_share_payment',
       last_error = NULLIF(last_error, 'active_registrations_share_payment')
 WHERE state = 'needs_review' AND review_reason IS NULL;

ALTER TABLE public.event_registration_refund_jobs
  DROP CONSTRAINT IF EXISTS event_refund_jobs_review_reason_check;
ALTER TABLE public.event_registration_refund_jobs
  ADD CONSTRAINT event_refund_jobs_review_reason_check CHECK (
    (review_reason IS NULL OR review_reason IN (
      'active_registrations_share_payment', 'attempts_exhausted',
      'provider_refund_failed', 'refund_unconfirmed'))
    -- Zlecenie czekajace na czlowieka MUSI mowic, na co czeka - inaczej panel
    -- pokazuje "wymaga decyzji" bez slowa o tym, jakiej.
    AND (state <> 'needs_review' OR review_reason IS NOT NULL)
  );

-- `refund.failed` szuka zlecenia po identyfikatorze zwrotu u operatora.
CREATE INDEX IF NOT EXISTS event_refund_jobs_provider_refund
  ON public.event_registration_refund_jobs (provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2) Stale polityki ponawiania - jedno zrodlo dla claim, settle i alarmu.
-- ----------------------------------------------------------------------------
-- Dziesiec prob z wykladniczym odstepem (2, 4, ..., 512 min, potem 1440) to
-- okolo doby. Dluzej czekac nie ma po co: blad, ktory nie minal przez dobe,
-- wymaga czlowieka, a nie jedenastej proby.
CREATE OR REPLACE FUNCTION public._event_refund_attempt_budget()
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$ SELECT 10 $$;
REVOKE ALL ON FUNCTION public._event_refund_attempt_budget() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_refund_attempt_budget() TO service_role;
COMMENT ON FUNCTION public._event_refund_attempt_budget() IS
  'Budzet prob zlecenia zwrotu; porazka numer budzet eskaluje do needs_review. Lustro TS: REFUND_ATTEMPT_BUDGET.';

-- Zwrot kartowy Stripe zwykle jest `succeeded` od razu; `pending` dluzej niz
-- tydzien to juz nie kolejka operatora, tylko zwrot, o ktorym nikt nic nie wie.
CREATE OR REPLACE FUNCTION public._event_refund_unconfirmed_days()
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$ SELECT 7 $$;
REVOKE ALL ON FUNCTION public._event_refund_unconfirmed_days() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_refund_unconfirmed_days() TO service_role;
COMMENT ON FUNCTION public._event_refund_unconfirmed_days() IS
  'Po ilu dniach zlecenie submitted bez potwierdzenia operatora eskaluje do needs_review (refund_unconfirmed).';

-- ----------------------------------------------------------------------------
-- 3) JEDYNE wejscie do `needs_review`.
--
-- Dozwolone stany zrodlowe sa czescia kontraktu, nie wygoda: wyczerpany budzet
-- dotyczy tylko zlecen, ktore jeszcze probujemy; porazka u operatora - tylko
-- zlecen, ktore operator przyjal (takze `completed`, bo zwrot `succeeded` moze
-- jeszcze upasc); `cancelled` (organizator przywrocil zgloszenie) nie alarmuje
-- nigdy. Zwraca true, gdy TO wywolanie przenioslo zlecenie i wyslalo alarm.
-- Tresc alarmu: tytul wydarzenia i identyfikatory - bez danych osobowych.
-- ----------------------------------------------------------------------------
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
      v_body_pl := format('Zwrot za odrzucone zgłoszenie na „%s” (zamówienie %s) nie doszedł do skutku po %s próbach. Zleć zwrot ręcznie u operatora płatności i sprawdź dziennik zwrotów.',
        v_event_pl, v_job.payment_order_id, v_job.attempts);
      v_body_en := format('The refund for a rejected registration for "%s" (order %s) failed after %s attempts. Issue it manually with the payment provider and check the refund journal.',
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
      v_body_pl := format('Odrzucone zgłoszenie na „%s” opłacono wspólną płatnością (zamówienie %s), z której inni uczestnicy nadal korzystają. Rozlicz zwrot częściowy w panelu płatności.',
        v_event_pl, v_job.payment_order_id);
      v_body_en := format('A rejected registration for "%s" was paid with a shared payment (order %s) that still covers other attendees. Arrange a partial refund in the payments panel.',
        v_event_en, v_job.payment_order_id);
  END CASE;

  -- Strona zapisow wydarzenia, na ktorej mieszka dziennik zwrotow; `refund_job`
  -- otwiera dziennik na tym zleceniu i rozroznia alarmy przy deduplikacji.
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
  'Jedyne wejscie zlecenia zwrotu do needs_review: powod, stempel escalated_at i alarm dla administratorow najemcy w tej samej transakcji. Tylko z cial SECURITY DEFINER.';

-- ----------------------------------------------------------------------------
-- 4) Ponowne zlecenie po decyzji organizatora: czysty budzet i czysty powod.
--    Cialo jak w 20260929113000, plus reset w galezi ON CONFLICT. Bez resetu
--    zlecenie z `attempts = 10` wracalo jako `pending`, ktorego claim NIGDY nie
--    podejmie (budzet), a sweep od razu eskalowalby je drugi raz.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_rejection_refund_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'rejected' AND NEW.payment_status IN ('paid', 'partially_refunded')
     AND NEW.payment_order_id IS NOT NULL
     AND (OLD.status <> 'rejected' OR OLD.payment_status NOT IN ('paid', 'partially_refunded')) THEN
    INSERT INTO public.event_registration_refund_jobs(tenant_id, event_id, payment_order_id, registration_id)
    SELECT NEW.tenant_id, NEW.event_id, o.id, NEW.id FROM public.payment_orders o
    WHERE o.id = NEW.payment_order_id AND o.tenant_id = NEW.tenant_id
      AND o.metadata->>'event_id' = NEW.event_id::text
      AND o.metadata->>'registration_id' = COALESCE(NEW.group_lead_registration_id, NEW.id)::text
    ON CONFLICT (payment_order_id) DO UPDATE SET state = 'pending', last_error = NULL,
      attempts = 0, review_reason = NULL, escalated_at = NULL, provider_refund_id = NULL,
      claim_token = NULL, next_attempt_at = now(), updated_at = now()
    WHERE event_registration_refund_jobs.state IN ('needs_review', 'cancelled');
  END IF;
  IF NEW.payment_status = 'refunded' AND NEW.payment_order_id IS NOT NULL THEN
    UPDATE public.event_registration_refund_jobs SET state = 'completed', claim_token = NULL, updated_at = now()
    WHERE payment_order_id = NEW.payment_order_id AND tenant_id = NEW.tenant_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._event_rejection_refund_queue() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4b) Przywrocenie zgloszenia: `refund_unconfirmed` blokuje tak samo jak
--     `submitted`. Cialo jak w 20260929113000 plus jeden warunek. Bez niego
--     eskalacja po 7 dniach ZDEJMOWALABY blokade: organizator przywracal
--     zgloszenie, guard wycofywal zlecenie (`cancelled`), a zwrot wiszacy
--     u operatora mogl jeszcze dojsc - uczestnik z biletem i z pieniedzmi.
--     `provider_refund_failed` nie blokuje: pieniadze zostaly u nas.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_refund_reapproval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('cancelled', 'rejected') AND NEW.status NOT IN ('cancelled', 'rejected') THEN
    PERFORM 1 FROM public.event_registration_refund_jobs j
    WHERE j.payment_order_id = NEW.payment_order_id AND j.tenant_id = NEW.tenant_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.event_registration_refund_jobs j
      WHERE j.payment_order_id = NEW.payment_order_id AND j.tenant_id = NEW.tenant_id
        AND (j.state IN ('processing', 'submitted')
             OR (j.state = 'needs_review' AND j.review_reason = 'refund_unconfirmed'))) THEN
      RAISE EXCEPTION 'invalid_transition: refund already in progress; create a new registration';
    END IF;
    UPDATE public.event_registration_refund_jobs SET state = 'cancelled', updated_at = now()
    WHERE payment_order_id = NEW.payment_order_id AND tenant_id = NEW.tenant_id
      AND state IN ('pending', 'failed', 'needs_review');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._event_refund_reapproval_guard() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) Claim: zamiatanie eskalacji przed podjeciem prob.
-- ----------------------------------------------------------------------------
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
  -- ktory operator cofnal PO `charge.refunded`. Status zamowienia jest wtedy
  -- nieaktualny, a powrot do `completed` schowalby jedyny slad tej porazki.
  UPDATE public.event_registration_refund_jobs j SET state = 'completed', claim_token = NULL, updated_at = now()
  FROM public.payment_orders o WHERE o.id = j.payment_order_id AND o.tenant_id = j.tenant_id
    AND o.status = 'refunded' AND j.state <> 'completed'
    AND NOT (j.state = 'needs_review' AND j.review_reason IS NOT DISTINCT FROM 'provider_refund_failed');

  -- Eskalacje. Wspolna platnosc ma pierwszenstwo przed budzetem: to ona jest
  -- powodem, dla ktorego zwrotu nie wolno zlecic w calosci. Limit 100 trzyma
  -- transakcje krotka; reszta zostaje na nastepny przebieg (cron co kilka minut).
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
    WHERE (j.state IN ('pending', 'failed') AND (s.shared OR j.attempts >= v_budget))
       -- Dzierzawa ostatniej proby porzucona (worker padl przed settle):
       -- kolejnej proby juz nie ma, wiec jest to wyczerpany budzet.
       OR (j.state = 'processing' AND j.claimed_at < now() - interval '15 minutes' AND j.attempts >= v_budget)
       -- `claimed_at` to start proby, ktora dostala identyfikator zwrotu; settle
       -- go nie rusza, wiec mierzy wiek zlecenia u operatora.
       OR (j.state = 'submitted' AND COALESCE(j.claimed_at, j.updated_at) < now() - v_unconfirmed)
    ORDER BY j.created_at, j.id
    LIMIT 100
    FOR UPDATE OF j SKIP LOCKED
  LOOP
    PERFORM public._event_refund_job_escalate(v_due.id, v_due.reason);
  END LOOP;

  WITH picked AS (
    SELECT j.id FROM public.event_registration_refund_jobs j
    WHERE ((j.state IN ('pending', 'failed') AND j.next_attempt_at <= now())
        OR (j.state = 'processing' AND j.claimed_at < now() - interval '15 minutes'))
      AND j.attempts < v_budget
      -- Druga zapora niezalezna od limitu petli wyzej: wspolnej platnosci grupy
      -- z aktywnymi uczestnikami NIE zwracamy w calosci nigdy.
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
    'order_status', o.status)), '[]'::jsonb) INTO v_jobs
  FROM claimed j JOIN public.payment_orders o ON o.id = j.payment_order_id AND o.tenant_id = j.tenant_id;
  RETURN v_jobs;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refunds_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_refunds_claim(integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 6) Settle: porazka wyczerpujaca budzet eskaluje w tej samej transakcji.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_registration_refunds_settle(
  p_job_id uuid, p_claim_token uuid, p_refund_id text, p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_failed CONSTANT boolean := p_error IS NOT NULL OR p_refund_id IS NULL;
  v_attempts integer;
BEGIN
  UPDATE public.event_registration_refund_jobs SET
    state = CASE WHEN v_failed THEN 'failed' ELSE 'submitted' END,
    provider_refund_id = p_refund_id, last_error = left(p_error, 500), claim_token = NULL,
    next_attempt_at = now() + make_interval(mins => LEAST(1440, (power(2, LEAST(attempts, 10)))::integer)), updated_at = now()
  WHERE id = p_job_id AND claim_token = p_claim_token AND state = 'processing'
  RETURNING attempts INTO v_attempts;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- `attempts` podbija claim, wiec tu jest to numer WLASNIE zakonczonej proby.
  IF v_failed AND v_attempts >= public._event_refund_attempt_budget() THEN
    PERFORM public._event_refund_job_escalate(p_job_id, 'attempts_exhausted');
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refunds_settle(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_refunds_settle(uuid, uuid, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 7) Webhook `refund.failed`: zwrot przyjety przez operatora, ktory nie doszedl.
--
-- Dopasowanie po identyfikatorze zwrotu ORAZ srodowisku zamowienia (zdarzenie
-- z piaskownicy nie dotyka zlecenia produkcyjnego). Najemca i wydarzenie sa
-- z wiersza zlecenia. `p_reason` (np. `expired_or_canceled_card`) jest kodem
-- operatora: przycinamy go do bezpiecznego alfabetu, bo trafia do alarmu.
-- Zlecenie juz eskalowane jako `refund_unconfirmed` dostaje precyzyjniejszy
-- powod BEZ drugiego alarmu. Zwraca true, gdy wywolanie wyslalo alarm.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_registration_refund_failed(
  p_provider_refund_id text,
  p_environment text,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refund CONSTANT text := NULLIF(btrim(p_provider_refund_id), '');
  v_reason CONSTANT text := COALESCE(
    NULLIF(left(regexp_replace(COALESCE(p_reason, ''), '[^A-Za-z0-9_.-]', '', 'g'), 64), ''), 'unknown');
  v_job record;
BEGIN
  IF v_refund IS NULL OR p_environment IS NULL OR p_environment NOT IN ('sandbox', 'live') THEN
    RETURN false;
  END IF;
  SELECT j.id, j.state, j.review_reason INTO v_job
    FROM public.event_registration_refund_jobs j
    JOIN public.payment_orders o ON o.id = j.payment_order_id AND o.tenant_id = j.tenant_id
   WHERE j.provider_refund_id = v_refund AND o.environment = p_environment
   ORDER BY j.created_at DESC, j.id DESC
   LIMIT 1
   FOR UPDATE OF j;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_job.state = 'needs_review' AND v_job.review_reason = 'refund_unconfirmed' THEN
    UPDATE public.event_registration_refund_jobs
       SET review_reason = 'provider_refund_failed', last_error = v_reason, updated_at = now()
     WHERE id = v_job.id;
    RETURN false;
  END IF;
  RETURN public._event_refund_job_escalate(v_job.id, 'provider_refund_failed', v_reason);
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refund_failed(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_refund_failed(text, text, text) TO service_role;
COMMENT ON FUNCTION public._event_registration_refund_failed(text, text, text) IS
  'Webhook refund.failed: zlecenie zwrotu (submitted/completed) o tym identyfikatorze zwrotu i srodowisku przechodzi do needs_review z alarmem. Najemca z wiersza zlecenia.';

-- ----------------------------------------------------------------------------
-- 8) Dziennik organizatora: powod przegladu i chwila alarmu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_refund_jobs(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant(); v_jobs jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j.created_at DESC), '[]'::jsonb)
  INTO v_jobs FROM (
    SELECT j.id, j.payment_order_id, j.state, j.attempts, j.created_at,
      j.next_attempt_at, j.last_error, j.review_reason, j.escalated_at,
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
