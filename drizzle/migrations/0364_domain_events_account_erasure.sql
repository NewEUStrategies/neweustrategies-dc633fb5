-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9b-A2, 2/3): RODO SZYNY ZDARZEŃ I ŚCIEŻEK PO
-- USUNIĘCIU KONTA - REDAKCJA `domain_events` I ICH KOPII, WYJŚCIE ZE
-- ŚCIEŻEK (Z-I9b-04). Polecenie właściciela 2026-10-20 („zastosuj").
--
-- DEFEKT
--   1. `domain_events` trzymają przez 90 dni retencji (`prune_domain_events`)
--      uid usuniętego konta: w `payload.user_id` (rejestracja, paywall,
--      licznik, kasa, subskrypcje, retencja, kluby), w `aggregate_id`
--      (agregaty `account`, `paywall`), w `actor_id`, a obok - identyfikatory
--      prowadzące do osoby: `subscription_id`, `order_id`, `document_id`,
--      `application_id`, `lead_id`, `person_id`. Sanityzacja przy zapisie
--      (`domain_events_redact_payload`, 20260729123407) zdejmuje wyłącznie
--      e-mail, telefon, adres i treści - nie identyfikatory.
--   2. Kopie zdarzeń żyją dalej niż konto: skrzynka ścieżek
--      (`journey_event_inbox`, 30 dni po przetworzeniu), dostawy integracji
--      (`integration_deliveries`, 14/30 dni), migawka wyzwalacza zapisu na
--      ścieżkę (`journey_enrollments.trigger_snapshot`, bez terminu).
--   3. Konsumenci zdarzeń nieprzetworzonych działają po usunięciu konta:
--      ingest skrzynki rozpoznaje kontakt po `lead_id`/agregacie leada
--      i zapisuje go na ścieżkę (mail), router integracji wysyła ładunek
--      z uid do zewnętrznego CRM, a zapisy konta w toku wysyłają dalej maile
--      kategorii `service` (ich bramka nie pyta o zgodę marketingową).
--
-- ZMIANA
--   A. `_hub_erasure_payload(ładunek, uid, pseudonim, e-mail)` - BIAŁA lista
--      kluczy nieosobowych (typ, status, warstwa, powód, kwoty `*_minor`/
--      `*_cents`, waluta, treść, plan, klub, etap, źródło - pełna lista
--      w ciele); wszystko inne znika (identyfikatory operatora płatności,
--      subskrypcji, zamówień, dokumentów, leadów, osób, imiona, adresy,
--      wolny tekst). `user_id`/`member_user_id` = uid -> pseudonim konta
--      (spójne liczenie z lejkiem, 1/3) albo usunięty (tryb bez pseudonimu
--      dla wierszy związanych z kontaktem CRM); uid INNEJ osoby zostaje.
--      Wartość z uid albo e-mailem pod kluczem z białej listy - też znika.
--      Znacznik `_redacted: account_deleted`. Lista biała, nie czarna:
--      nowy klucz emitera, którego nikt nie sklasyfikował, znika (fail-safe).
--   B. `_domain_events_erase_account(uid, pseudonim, e-mail)` - zdarzenie
--      osoby (aktor, agregat albo uid/e-mail gdziekolwiek w ładunku):
--      NOWY losowy `id` (odcina odwołania z wierszy związanych z leadem:
--      `trigger_event_id`, `detail.event_id`, `crm_tasks.origin_ref
--      'wf:<id>'`), `aggregate_id` = pseudonim, `actor_id` uid -> NULL,
--      `correlation_id` NULL, ładunek przez A. Zostają typ, czas, najemca,
--      kwoty i klucze nieosobowe. Kopie: skrzynka ścieżek i dostawy
--      integracji dostają ten sam nowy `event_id` i ten sam kształt;
--      NIEPRZETWORZONE są pomijane mechanizmem szyny - skrzynka
--      `processed_at` + `error = skipped:account_deleted` (ingest ich nie
--      weźmie), dostawa `queued|failed` -> `dead` z tym samym powodem (router
--      nie ponowi). Teksty błędów (`journey_engine_errors`,
--      `domain_event_emit_errors`, `workflow_runs`) - uid i e-mail ->
--      `[redacted]`. Retencja 90 dni (`prune_domain_events`) bez zmian.
--   C. `_journeys_erase_account(uid, e-mail)`: zapisy konta w toku ->
--      `exited` z NOWYM powodem `account_deleted` (podstawa ścieżki `service`
--      wygasła z kontem; marketing kontaktu CRM ma własną zgodę, ale zapis
--      wywołany kontem też kończymy - jak `unsubscribed`); zapis zostaje przy
--      kontakcie CRM (historia wysyłek i otwarć leada), bez `user_id`, bez
--      `trigger_event_id`, migawka bez identyfikatorów i BEZ pseudonimu
--      (lead jest identyfikowalny - pseudonim w jego wierszu odtworzyłby
--      osobę stojącą za lejkiem). `journey_step_runs.detail` z uid/e-mailem
--      przez A bez pseudonimu.
--   D. CHECK `journey_enrollments.exit_reason` += `account_deleted` (lustro
--      TS `JOURNEY_EXIT_REASONS`, etykiety PL/EN panelu - parytet
--      src/lib/journeys/__tests__/journeyLimitsParity.test.ts).
--   Konsumenci bez stanu: workflowy działają synchronicznie przy INSERT
--   (nic nie czeka), unieważnianie zapytań w przeglądarce słucha wyłącznie
--   INSERT (`useDomainEventStream`), więc redakcja (UPDATE) niczego nie
--   wyzwala - nie powstaje mail ani lead.
--
-- KOLEJNOŚĆ WDROŻENIA: po S5 (20261020140*) i 1/3; przed 3/3 (wyzwalacz
-- i domknięcie wstecz wołają B i C). CHECK zmieniany przy `lock_timeout`
-- (NOT VALID + VALIDATE: krótka blokada, potem skan bez blokady zapisu).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe nazwy - bez CIALO-Z),
-- DROP CONSTRAINT IF EXISTS + ADD (ten sam wynik przy powtórce), bezstanowe
-- REVOKE. B i C zmieniają wyłącznie wiersze z uid/e-mailem konta - po
-- redakcji ich nie ma, więc powtórka zwraca 0.
-- DOWÓD: supabase/tests/hub_i9b_account_erasure_sweep_test.sql (żadna
-- kolumna uuid/text/jsonb tabel z przeglądu nie zawiera uid, e-maila ani
-- identyfikatorów operatora; zdarzenie nieprzetworzone pominięte - ingest
-- nie zapisuje na ścieżkę, lead nie powstaje; dostawa `dead`; zapis w toku
-- `exited/account_deleted`; nowy id zdarzenia wspólny dla kopii).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Ładunek zdarzenia po usunięciu konta - biała lista kluczy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._hub_erasure_payload(
  p_payload jsonb,
  p_user_id uuid,
  p_surrogate uuid DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
           jsonb_object_agg(
             e.key,
             CASE WHEN e.key IN ('user_id', 'member_user_id') AND e.value = to_jsonb(p_user_id::text)
                  THEN to_jsonb(p_surrogate::text)
                  ELSE e.value END),
           '{}'::jsonb)
         || jsonb_build_object('_redacted', 'account_deleted')
    FROM jsonb_each(CASE WHEN jsonb_typeof(p_payload) = 'object' THEN p_payload ELSE '{}'::jsonb END) AS e(key, value)
   WHERE CASE
           -- Konto osoby: pseudonim albo nic (tryb wierszy przy leadzie).
           WHEN e.key IN ('user_id', 'member_user_id') AND e.value = to_jsonb(p_user_id::text)
             THEN p_surrogate IS NOT NULL
           ELSE
             (e.key = ANY (ARRAY[
                -- Klasyfikacja kluczy emiterów huba i szyny (20261020100000-
                -- 20261020140400): stany, słowniki, kwoty, treść, katalog.
                -- `user_id`/`member_user_id` INNEJ osoby zostaje - to jej dane.
                '_redacted', 'op', 'keys', 'status', 'old_status', 'new_status', 'paused',
                'cancel_at_period_end', 'failure_count', 'trial_ends_at', 'tier_key',
                'required_tier_key', 'reason', 'reason_key', 'failure_reason', 'outcome',
                'offer_shown', 'offer_accepted', 'period_month', 'limit', 'kind', 'segment',
                'signup_source', 'marketing_opt_in', 'has_attribution', 'entity_type',
                'entity_id', 'variant', 'mode', 'metering_policy', 'plan_id', 'event_id',
                'currency', 'has_coupon', 'club_id', 'specialization', 'from', 'to', 'source',
                'stage', 'old_stage', 'new_stage', 'language', 'enabled', 'journey_id',
                'version', 'user_id', 'member_user_id'])
              OR e.key ~ '_(minor|cents)$')
             -- Wartość z uid albo e-mailem osoby pod kluczem z listy - też znika.
             AND strpos(e.value::text, p_user_id::text) = 0
             AND (p_email IS NULL OR strpos(lower(e.value::text), lower(p_email)) = 0)
         END
$$;

REVOKE ALL ON FUNCTION public._hub_erasure_payload(jsonb, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._hub_erasure_payload(jsonb, uuid, uuid, text) IS
  'Hub I9b-A2 (RODO): ładunek zdarzenia po usunięciu konta - biała lista kluczy nieosobowych, user_id/member_user_id konta -> pseudonim (albo usunięte, gdy pseudonim NULL), znacznik _redacted. Wewnętrzny: bez EXECUTE dla ról API.';

-- Tekst diagnostyczny (błąd ingestu, emitera, dostawy): uid i e-mail ->
-- `[redacted]`, reszta komunikatu zostaje. E-mail jako wzorzec: każdy znak
-- poza literą, cyfrą, `_` i `@` poprzedzony ukośnikiem (w ARE to zawsze
-- literał), wielkość liter bez znaczenia.
CREATE OR REPLACE FUNCTION public._hub_erasure_text(p_text text, p_user_id uuid, p_email text DEFAULT NULL)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN p_text IS NULL THEN NULL
           WHEN NULLIF(btrim(p_email), '') IS NULL
             THEN replace(p_text, p_user_id::text, '[redacted]')
           ELSE regexp_replace(
                  replace(p_text, p_user_id::text, '[redacted]'),
                  regexp_replace(lower(btrim(p_email)), '([^[:alnum:]_@])', '\\\1', 'g'),
                  '[redacted]', 'gi')
         END
$$;

REVOKE ALL ON FUNCTION public._hub_erasure_text(text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._hub_erasure_text(text, uuid, text) IS
  'Hub I9b-A2 (RODO): tekst diagnostyczny po usunięciu konta - uid i e-mail -> [redacted]. Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- B) Zdarzenia osoby i ich kopie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._domain_events_erase_account(
  p_user_id uuid,
  p_surrogate uuid,
  p_email text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_skip constant text := 'skipped:account_deleted';
  v_uid text := p_user_id::text;
  v_sur text := p_surrogate::text;
  v_email text := NULLIF(lower(btrim(p_email)), '');
  v_ids uuid[] := ARRAY[]::uuid[];
  v_new uuid;
  r record;
  v_rows integer := 0;
  v_n integer;
BEGIN
  IF p_user_id IS NULL OR p_surrogate IS NULL THEN
    RETURN 0;
  END IF;

  -- Szyna. Pełny przegląd ≤ 90 dni zdarzeń (retencja) - usunięcie konta jest
  -- rzadkie, a dopasowanie tekstowe łapie uid także głębiej w ładunku.
  FOR r IN
    SELECT e.id
      FROM public.domain_events e
     WHERE e.actor_id = p_user_id
        OR e.aggregate_id = v_uid
        OR strpos(e.payload::text, v_uid) > 0
        OR (v_email IS NOT NULL AND strpos(lower(e.payload::text), v_email) > 0)
     FOR UPDATE
  LOOP
    v_new := gen_random_uuid();
    UPDATE public.domain_events e
       SET id = v_new,
           actor_id = NULLIF(e.actor_id, p_user_id),
           aggregate_id = v_sur,
           correlation_id = NULL,
           payload = public._hub_erasure_payload(e.payload, p_user_id, p_surrogate, v_email)
     WHERE e.id = r.id;
    -- Kopie dostają TEN SAM nowy identyfikator (redakcja kształtu niżej).
    UPDATE public.journey_event_inbox i SET event_id = v_new WHERE i.event_id = r.id;
    UPDATE public.integration_deliveries d SET event_id = v_new WHERE d.event_id = r.id;
    v_ids := v_ids || v_new;
    v_rows := v_rows + 1;
  END LOOP;

  -- Skrzynka ścieżek: kopia zdarzenia (także gdy źródło wycięła już
  -- retencja). Nieprzetworzone - pominięte: ingest bierze wyłącznie
  -- `processed_at IS NULL`, więc nie rozpozna kontaktu i nie wyśle maila.
  UPDATE public.journey_event_inbox i
     SET event_id = CASE WHEN i.event_id = ANY (v_ids) THEN i.event_id ELSE gen_random_uuid() END,
         actor_id = NULLIF(i.actor_id, p_user_id),
         aggregate_id = v_sur,
         correlation_id = NULL,
         payload = public._hub_erasure_payload(i.payload, p_user_id, p_surrogate, v_email),
         processed_at = COALESCE(i.processed_at, now()),
         error = CASE WHEN i.processed_at IS NULL THEN c_skip
                      WHEN i.error IS NULL THEN NULL
                      ELSE public._hub_erasure_text(i.error, p_user_id, v_email) END
   WHERE i.event_id = ANY (v_ids)
      OR i.actor_id = p_user_id
      OR i.aggregate_id = v_uid
      OR strpos(i.payload::text, v_uid) > 0
      OR (v_email IS NOT NULL AND strpos(lower(i.payload::text), v_email) > 0);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  -- Dostawy integracji: ładunek = koperta zdarzenia (router 20260802153008).
  -- Czekające i ponawiane -> `dead` (router nie wysyła już nic o tej osobie).
  UPDATE public.integration_deliveries d
     SET event_id = x.new_event,
         payload = jsonb_build_object(
           'id', x.new_event,
           'event_type', d.payload -> 'event_type',
           'aggregate_type', d.payload -> 'aggregate_type',
           'aggregate_id', v_sur,
           'payload', public._hub_erasure_payload(d.payload -> 'payload', p_user_id, p_surrogate, v_email),
           'correlation_id', NULL,
           'created_at', d.payload -> 'created_at'),
         status = CASE WHEN d.status IN ('queued', 'failed') THEN 'dead' ELSE d.status END,
         last_error = CASE WHEN d.status IN ('queued', 'failed') THEN c_skip
                           WHEN d.last_error IS NULL THEN NULL
                           ELSE public._hub_erasure_text(d.last_error, p_user_id, v_email) END
    FROM (
      SELECT d2.id,
             CASE WHEN d2.event_id = ANY (v_ids) THEN d2.event_id ELSE gen_random_uuid() END AS new_event
        FROM public.integration_deliveries d2
       WHERE d2.event_id = ANY (v_ids)
          OR strpos(d2.payload::text, v_uid) > 0
          OR (v_email IS NOT NULL AND strpos(lower(d2.payload::text), v_email) > 0)
    ) x
   WHERE d.id = x.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  -- Teksty błędów: diagnostyka zostaje, osoba znika.
  UPDATE public.journey_engine_errors x
     SET error = public._hub_erasure_text(x.error, p_user_id, v_email)
   WHERE strpos(x.error, v_uid) > 0
      OR (v_email IS NOT NULL AND strpos(lower(x.error), v_email) > 0);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.domain_event_emit_errors x
     SET error = public._hub_erasure_text(x.error, p_user_id, v_email)
   WHERE strpos(x.error, v_uid) > 0
      OR (v_email IS NOT NULL AND strpos(lower(x.error), v_email) > 0);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.workflow_runs x
     SET error = public._hub_erasure_text(x.error, p_user_id, v_email)
   WHERE strpos(x.error, v_uid) > 0
      OR (v_email IS NOT NULL AND strpos(lower(x.error), v_email) > 0);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_rows + v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._domain_events_erase_account(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._domain_events_erase_account(uuid, uuid, text) IS
  'Hub I9b-A2 (RODO Z-I9b-04): zdarzenia osoby po usunięciu konta - nowy losowy id, aggregate_id = pseudonim, bez aktora i korelacji, ładunek z białej listy; ta sama redakcja w skrzynce ścieżek i dostawach integracji, nieprzetworzone pominięte (skipped:account_deleted, dead); uid i e-mail w tekstach błędów -> [redacted]. Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- C) Ścieżki: zapisy konta.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journeys_erase_account(p_user_id uuid, p_email text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid text := p_user_id::text;
  v_email text := NULLIF(lower(btrim(p_email)), '');
  v_rows integer := 0;
  v_n integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Wyjście jak przy zdarzeniu wyjścia w `journey_ingest_inbox` (te same
  -- kolumny); `journey_contact_for_send` odmawia zapisowi spoza active/
  -- waiting, więc krok mailowy w toku też nie wyśle.
  UPDATE public.journey_enrollments e
     SET status = 'exited',
         exit_reason = 'account_deleted',
         finished_at = now(),
         next_run_at = NULL,
         lock_token = NULL,
         locked_until = NULL
   WHERE e.user_id = p_user_id
     AND e.status IN ('active', 'waiting');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  -- Zapis zostaje przy leadzie - bez konta, bez odwołania do zdarzenia,
  -- migawka bez identyfikatorów i bez pseudonimu.
  UPDATE public.journey_enrollments e
     SET user_id = NULLIF(e.user_id, p_user_id),
         trigger_event_id = NULL,
         trigger_snapshot = jsonb_strip_nulls(jsonb_build_object(
           'tenant_id', e.trigger_snapshot -> 'tenant_id',
           'aggregate_type', e.trigger_snapshot -> 'aggregate_type',
           'event_type', e.trigger_snapshot -> 'event_type',
           'payload', public._hub_erasure_payload(e.trigger_snapshot -> 'payload', p_user_id, NULL, v_email),
           '_redacted', 'account_deleted'))
   WHERE e.user_id = p_user_id
      OR strpos(e.trigger_snapshot::text, v_uid) > 0
      OR (v_email IS NOT NULL AND strpos(lower(e.trigger_snapshot::text), v_email) > 0);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  UPDATE public.journey_step_runs sr
     SET detail = public._hub_erasure_payload(sr.detail, p_user_id, NULL, v_email)
   WHERE strpos(sr.detail::text, v_uid) > 0
      OR (v_email IS NOT NULL AND strpos(lower(sr.detail::text), v_email) > 0);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_rows + v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._journeys_erase_account(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._journeys_erase_account(uuid, text) IS
  'Hub I9b-A2 (RODO): zapisy usuniętego konta w toku -> exited/account_deleted; zapisy przy leadzie bez user_id i trigger_event_id, migawka i szczegóły kroków bez identyfikatorów i bez pseudonimu. Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- D) Powód wyjścia `account_deleted`.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';
ALTER TABLE public.journey_enrollments DROP CONSTRAINT IF EXISTS journey_enrollments_exit_reason_check;
ALTER TABLE public.journey_enrollments ADD CONSTRAINT journey_enrollments_exit_reason_check
  CHECK (exit_reason IN ('completed', 'goal', 'exit_event', 'consent', 'unsubscribed', 'suppressed',
                         'manual', 'journey_archived', 'error', 'entry_filter', 'account_deleted')) NOT VALID;
RESET lock_timeout;
ALTER TABLE public.journey_enrollments VALIDATE CONSTRAINT journey_enrollments_exit_reason_check;
