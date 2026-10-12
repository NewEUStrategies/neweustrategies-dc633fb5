-- ============================================================================
-- RETENCJA dziennika webhooków płatności: pseudonimizacja ładunku po 30/90
-- dniach i przy zamknięciu konta (audyt rozliczeń SUB-11, 2026-10-12).
--
-- DEFEKT. `payment_webhook_events.payload` trzyma PEŁNE zdarzenie operatora:
-- e-mail i imię płatnika, adres rozliczeniowy, telefon, numer podatkowy,
-- ostatnie cyfry i odcisk karty, adresy faktur. Nic go nigdy nie czyściło -
-- dane osobowe żyły w dzienniku bez terminu (art. 5 ust. 1 lit. e RODO), także
-- po usunięciu konta.
--
-- OKRES (decyzja produktowa, uzasadnienie):
--   * 30 dni dla zdarzeń domkniętych (`processed`/`skipped`/`ignored`).
--     Operator ponawia dostarczenie najwyżej 3 doby; uzgodnienie w panelu
--     (`reconcile.server`) sięga najwyżej 30 dni wstecz, a jego naprawa czyta
--     zdarzenie OD OPERATORA, nie z dziennika. Po 30 dniach pełny ładunek nie
--     służy już żadnemu przetwarzaniu - zostaje tylko jego szkielet do
--     uzgodnienia z wyciągiem.
--   * 90 dni dla `failed`/`received`: nierozwiązany incydent potrzebuje
--     ładunku do diagnozy i ręcznego ponowienia dłużej - ale nie bez końca.
--   * Zamknięcie konta - od razu (`payment_webhook_events_redact_for_user`,
--     wołane przez `accountClosure.server` po anulowaniu subskrypcji).
--
-- CO ZOSTAJE: identyfikatory (zdarzenia, obiektu, klienta, subskrypcji,
-- faktury, intencji), typ, status, kwoty, waluty, daty, metadane domenowe
-- (`purpose`, `donationId`, `orderId`, `tenantId`) - komplet do uzgodnienia
-- księgowego. CO ZNIKA (wartość -> null): każde pole o nazwie z listy
-- danych osobowych w `payment_webhook_payload_scrub` (e-maile, imiona, adresy,
-- telefony, numery podatkowe, szczegóły karty i rachunku, IP, adresy faktur
-- dających wgląd w dane nabywcy), a w pozostałych napisach - adresy e-mail.
-- Przy zamknięciu konta dodatkowo `userId`/`user_id` i kolumna `user_id`.
--
-- ZNACZNIK: ładunek dostaje `_redacted: {at, reason}`. Ponowienie z panelu
-- (`webhookRetry.functions`) odmawia takiego wiersza z czytelnym komunikatem,
-- a przejęcie zdarzenia (`claimWebhookEvent`) zapisuje świeży ładunek - bez
-- znacznika - więc stan nie rozjeżdża się z treścią. Indeks częściowy obejmuje
-- tylko wiersze BEZ znacznika (okno 30-90 dni), więc przebieg retencji nie
-- skanuje historii.
--
-- HARMONOGRAM: pg_cron co godzinę (minuta 43 - wolna w repo), partia 2000.
-- IDEMPOTENTNA: CREATE OR REPLACE, IF NOT EXISTS, wyrejestrowanie zadania.
-- DOWÓD: supabase/tests/payment_webhook_events_retention_test.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payment_webhook_payload_scrub(
  p_payload jsonb,
  p_strip_user_ref boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
  v_key text;
  v_val jsonb;
  v_lower text;
BEGIN
  IF p_payload IS NULL THEN
    RETURN NULL;
  END IF;

  CASE jsonb_typeof(p_payload)
    WHEN 'object' THEN
      v_out := '{}'::jsonb;
      FOR v_key, v_val IN SELECT e.key, e.value FROM jsonb_each(p_payload) AS e LOOP
        v_lower := lower(v_key);
        IF v_lower LIKE '%email%'
           OR v_lower LIKE '%phone%'
           OR v_lower = ANY (ARRAY[
             'name', 'customer_name', 'individual_name', 'business_name',
             'account_holder_name', 'cardholder_name', 'verified_name',
             'first_name', 'last_name', 'display_name',
             'address', 'customer_address', 'billing_address', 'shipping_address',
             'verified_address', 'shipping', 'shipping_details', 'customer_shipping',
             'customer_details', 'billing_details', 'collected_information',
             'custom_fields', 'tax_ids', 'customer_tax_ids', 'tax_id', 'tax_id_data',
             'ip_address', 'user_agent',
             'payment_method_details', 'card', 'fingerprint', 'last4', 'iban',
             'account_number', 'routing_number', 'sort_code', 'bsb_number',
             'hosted_invoice_url', 'invoice_pdf', 'receipt_url'
           ])
           OR (p_strip_user_ref AND v_lower IN ('userid', 'user_id'))
        THEN
          v_out := v_out || jsonb_build_object(v_key, 'null'::jsonb);
        ELSE
          v_out := v_out || jsonb_build_object(
            v_key, public.payment_webhook_payload_scrub(v_val, p_strip_user_ref)
          );
        END IF;
      END LOOP;
      RETURN v_out;
    WHEN 'array' THEN
      SELECT COALESCE(
               jsonb_agg(public.payment_webhook_payload_scrub(a.value, p_strip_user_ref)
                         ORDER BY a.ord),
               '[]'::jsonb)
        INTO v_out
        FROM jsonb_array_elements(p_payload) WITH ORDINALITY AS a(value, ord);
      RETURN v_out;
    WHEN 'string' THEN
      -- Siatka bezpieczeństwa: e-mail wklejony w opis, komunikat czy notatkę.
      RETURN to_jsonb(regexp_replace(
        p_payload #>> '{}',
        '[^[:space:]@"<>(),;:]+@[^[:space:]@"<>(),;:]+\.[A-Za-z]{2,}',
        '[redacted-email]',
        'g'
      ));
    ELSE
      RETURN p_payload;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_webhook_payload_scrub(jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_webhook_payload_scrub(jsonb, boolean) TO service_role;

COMMENT ON FUNCTION public.payment_webhook_payload_scrub(jsonb, boolean) IS
  'Rekurencyjnie zeruje pola z danymi osobowymi w ładunku webhooka płatności (e-mail, imię, adres, telefon, NIP, karta/rachunek, IP, adresy faktur) i maskuje adresy e-mail w napisach; identyfikatory, kwoty, statusy i metadane domenowe zostają. p_strip_user_ref zeruje też userId/user_id (zamknięcie konta). Audyt SUB-11.';

CREATE OR REPLACE FUNCTION public.payment_webhook_payload_redact(
  p_payload jsonb,
  p_reason text,
  p_strip_user_ref boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scrubbed jsonb := public.payment_webhook_payload_scrub(COALESCE(p_payload, '{}'::jsonb), p_strip_user_ref);
  v_marker jsonb := jsonb_build_object('at', now(), 'reason', p_reason);
BEGIN
  IF jsonb_typeof(v_scrubbed) = 'object' THEN
    RETURN v_scrubbed || jsonb_build_object('_redacted', v_marker);
  END IF;
  RETURN jsonb_build_object('_redacted', v_marker, 'data', v_scrubbed);
END;
$$;

REVOKE ALL ON FUNCTION public.payment_webhook_payload_redact(jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_webhook_payload_redact(jsonb, text, boolean) TO service_role;

COMMENT ON FUNCTION public.payment_webhook_payload_redact(jsonb, text, boolean) IS
  'payment_webhook_payload_scrub + znacznik _redacted {at, reason}. Wiersz ze znacznikiem nie jest ponawiany z dziennika (webhookRetry.functions).';

-- Tylko wiersze jeszcze nie zanonimizowane: indeks zostaje mały (okno 30-90
-- dni ruchu), a przebieg retencji nie przechodzi przez całą historię.
CREATE INDEX IF NOT EXISTS payment_webhook_events_unredacted_created_idx
  ON public.payment_webhook_events (created_at)
  WHERE NOT (payload ? '_redacted');

CREATE OR REPLACE FUNCTION public.payment_webhook_events_redact_expired(p_limit integer DEFAULT 2000)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 2000), 1), 50000);
  v_done integer;
BEGIN
  WITH doomed AS (
    SELECT e.id
      FROM public.payment_webhook_events e
     WHERE NOT (e.payload ? '_redacted')
       AND e.created_at < now() - interval '30 days'
       AND (
         e.status NOT IN ('failed', 'received')
         OR e.created_at < now() - interval '90 days'
       )
     ORDER BY e.created_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.payment_webhook_events e
     SET payload = public.payment_webhook_payload_redact(e.payload, 'retention', false),
         error = regexp_replace(
           e.error,
           '[^[:space:]@"<>(),;:]+@[^[:space:]@"<>(),;:]+\.[A-Za-z]{2,}',
           '[redacted-email]',
           'g'
         )
    FROM doomed d
   WHERE e.id = d.id;
  GET DIAGNOSTICS v_done = ROW_COUNT;
  RETURN v_done;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_webhook_events_redact_expired(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_webhook_events_redact_expired(integer) TO service_role;

COMMENT ON FUNCTION public.payment_webhook_events_redact_expired(integer) IS
  'Retencja dziennika webhooków płatności (audyt SUB-11): partiami (najstarsze, SKIP LOCKED) pseudonimizuje ładunek zdarzeń starszych niż 30 dni (failed/received: 90 dni). p_limit 1..50000, domyślnie 2000. Co godzinę z pg_cron (payment-webhook-events-redact, minuta 43), gdy rozszerzenie jest dostępne; inaczej na żądanie (service_role).';

-- Zamknięcie konta: zdarzenia płatnika rozpoznane po koncie i po NASZYCH
-- wierszach rozliczeń (klient i subskrypcja operatora w tym samym środowisku) -
-- `invoice.*` i `charge.*` nie niosą `user_id`. Najemca nie jest parametrem:
-- zakres wyznacza konto, a konto należy do jednego najemcy.
CREATE OR REPLACE FUNCTION public.payment_webhook_events_redact_for_user(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_done integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: p_user_id is required';
  END IF;

  WITH refs AS (
    SELECT s.environment, s.provider_customer_id AS customer_id,
           s.provider_subscription_id AS subscription_id
      FROM public.subscriptions s
     WHERE s.user_id = p_user_id
    UNION
    SELECT o.environment, o.provider_customer_id, o.provider_subscription_id
      FROM public.payment_orders o
     WHERE o.user_id = p_user_id
    UNION
    SELECT d.environment, NULL::text, d.provider_subscription_id
      FROM public.donations d
     WHERE d.user_id = p_user_id
  )
  UPDATE public.payment_webhook_events e
     SET payload = public.payment_webhook_payload_redact(e.payload, 'account_closure', true),
         error = regexp_replace(
           e.error,
           '[^[:space:]@"<>(),;:]+@[^[:space:]@"<>(),;:]+\.[A-Za-z]{2,}',
           '[redacted-email]',
           'g'
         ),
         user_id = CASE WHEN e.user_id = p_user_id THEN NULL ELSE e.user_id END
   WHERE e.user_id = p_user_id
      OR EXISTS (
        SELECT 1
          FROM refs r
         WHERE r.environment = e.environment
           AND (
             (r.customer_id IS NOT NULL AND r.customer_id = e.customer_id)
             OR (r.subscription_id IS NOT NULL AND r.subscription_id = e.subscription_id)
           )
      );
  GET DIAGNOSTICS v_done = ROW_COUNT;
  RETURN v_done;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_webhook_events_redact_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_webhook_events_redact_for_user(uuid) TO service_role;

COMMENT ON FUNCTION public.payment_webhook_events_redact_for_user(uuid) IS
  'Pseudonimizacja dziennika webhooków płatności zamykanego konta (audyt SUB-11): zdarzenia z user_id konta oraz zdarzenia jego klientów/subskrypcji operatora (subscriptions, payment_orders, donations; to samo środowisko). Zeruje dane osobowe i userId, kolumnę user_id konta ustawia na NULL. Woła accountClosure.server po anulowaniu subskrypcji. Tylko service_role.';

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron unavailable - payment_webhook_events retention runs only on demand';
    RETURN;
  END IF;
  BEGIN
    PERFORM cron.unschedule('payment-webhook-events-redact');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM cron.schedule(
    'payment-webhook-events-redact',
    '43 * * * *',
    $job$SELECT public.payment_webhook_events_redact_expired(2000)$job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'payment_webhook_events: scheduling retention job failed (%)', SQLERRM;
END $$;
