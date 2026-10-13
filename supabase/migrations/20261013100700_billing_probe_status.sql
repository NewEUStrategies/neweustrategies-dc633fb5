-- ============================================================================
-- Nocna sonda rozliczeń czyta naszą stronę BEZ klucza service_role (PAY-17c,
-- przegląd 7.6).
--
-- CO BYŁO ZŁE. Krok `verify` workflow `billing-nightly.yml` potrzebował
-- `PROBE_SUPABASE_SERVICE_ROLE_KEY` - klucza `service_role` PRODUKCJI - tylko
-- po to, żeby przeczytać dwie tabele. Ten klucz omija RLS w całej bazie
-- (odczyt i zapis, dane osobowe i płatności każdego najemcy), a sekret
-- repozytorium czyta każdy workflow wypchnięty na gałąź przez kogoś
-- z prawem zapisu. Prawo zapisu do repo stawało się pełnym dostępem do bazy.
--
-- CO ZMIENIA TA MIGRACJA. Sonda dostaje poświadczenie NAJMNIEJSZEGO
-- uprawnienia:
--   * `billing_probe_credentials` - jednowierszowa tabela z SKRÓTEM SHA-256
--     tokenu sondy (sam token nie jest nigdzie zapisany), tylko service_role,
--   * `billing_probe_rotate_token()` - service_role / SQL editor: losuje nowy
--     token, zapisuje jego skrót i zwraca token JEDEN raz (do sekretu
--     `BILLING_PROBE_TOKEN` w GitHub),
--   * `billing_probe_status(token, subskrypcja, od)` - SECURITY DEFINER,
--     wołana kluczem PUBLIKOWALNYM (jak `missing_migration_versions`), która
--     po sprawdzeniu tokenu zwraca WYŁĄCZNIE pola, których sonda potrzebuje,
--     i wyłącznie z PIASKOWNICY: wiersze dziennika webhooków jednej
--     subskrypcji `sub_…` od chwili zbrojenia (najwyżej 7 dni wstecz, 200
--     wierszy, błąd przycięty do 500 znaków) oraz jej stan w `subscriptions`.
--
-- Wyciek tokenu daje więc tyle, co sama sonda: status przetwarzania zdarzeń
-- testowych jednej subskrypcji testowej. Token ma 244 losowe bity - zgadywanie
-- przez publiczne RPC nie wchodzi w grę, a porównanie skrótów nie zdradza
-- czasem niczego o tokenie.
--
-- Klucz dziennika: `payment_webhook_events.subscription_id` stempluje trasa
-- webhooka przy rezerwacji (identyfikator `sub_…` z danych zdarzenia
-- `subscription.*` albo `subscriptionId` faktury) - test
-- `src/lib/ci/__tests__/billingProbeSubscriptionKey.test.ts` wiąże oba końce.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Skrót tokenu sondy (jeden wiersz, service_role only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_probe_credentials (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token_sha256 text CHECK (token_sha256 IS NULL OR token_sha256 ~ '^[0-9a-f]{64}$'),
  rotated_at timestamptz
);

COMMENT ON TABLE public.billing_probe_credentials IS
  'Skrot SHA-256 tokenu nocnej sondy rozliczen (billing-nightly.yml). Token nigdy nie jest zapisany; NULL = sonda wylaczona. Tylko service_role.';

ALTER TABLE public.billing_probe_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_probe_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_probe_credentials TO service_role;

INSERT INTO public.billing_probe_credentials (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2) Rotacja tokenu - zwraca token jawnie JEDEN raz
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_probe_rotate_token()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- 64 znaki hex z dwóch UUID v4 (244 losowe bity), bez pgcrypto.
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
BEGIN
  INSERT INTO public.billing_probe_credentials (id, token_sha256, rotated_at)
  VALUES (1, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), now())
  ON CONFLICT (id) DO UPDATE
    SET token_sha256 = EXCLUDED.token_sha256,
        rotated_at = EXCLUDED.rotated_at;
  RETURN v_token;
END;
$fn$;

REVOKE ALL ON FUNCTION public.billing_probe_rotate_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_probe_rotate_token() TO service_role;

COMMENT ON FUNCTION public.billing_probe_rotate_token() IS
  'Nowy token sondy rozliczen: zapisuje wylacznie skrot, token zwraca jeden raz (do sekretu BILLING_PROBE_TOKEN). Tylko service_role / SQL editor.';

-- ----------------------------------------------------------------------------
-- 3) Odczyt sondy - wyłącznie piaskownica, wyłącznie potrzebne pola
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_probe_status(
  p_token text,
  p_subscription_id text,
  p_since timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_expected text;
  v_events jsonb;
  v_subscription jsonb;
BEGIN
  SELECT c.token_sha256 INTO v_expected
    FROM public.billing_probe_credentials c
   WHERE c.id = 1;
  -- Jedna odpowiedź na każdy powód odmowy (brak tokenu, sonda wyłączona,
  -- zły token) - wołający nie dowie się, który to był.
  IF v_expected IS NULL
     OR p_token IS NULL
     OR length(p_token) < 32
     OR encode(sha256(convert_to(p_token, 'UTF8')), 'hex') <> v_expected THEN
    RAISE EXCEPTION 'billing probe: unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_subscription_id IS NULL OR p_subscription_id !~ '^sub_[A-Za-z0-9]{1,250}$' THEN
    RAISE EXCEPTION 'billing probe: invalid subscription id' USING ERRCODE = '22023';
  END IF;
  IF p_since IS NULL
     OR p_since < now() - interval '7 days'
     OR p_since > now() + interval '1 hour' THEN
    RAISE EXCEPTION 'billing probe: since must be within the last 7 days' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'event_id', e.event_id,
               'event_type', e.event_type,
               'status', e.status,
               'error', left(e.error, 500),
               'created_at', e.created_at
             )
             ORDER BY e.created_at, e.event_id
           ),
           '[]'::jsonb
         )
    INTO v_events
    FROM (
      SELECT w.event_id, w.event_type, w.status, w.error, w.created_at
        FROM public.payment_webhook_events w
       WHERE w.environment = 'sandbox'
         AND w.subscription_id = p_subscription_id
         AND w.created_at >= p_since
       ORDER BY w.created_at, w.event_id
       LIMIT 200
    ) e;

  SELECT jsonb_build_object(
           'provider_subscription_id', s.provider_subscription_id,
           'status', s.status,
           'current_period_end', s.current_period_end
         )
    INTO v_subscription
    FROM public.subscriptions s
   WHERE s.environment = 'sandbox'
     AND s.provider_subscription_id = p_subscription_id
   ORDER BY s.updated_at DESC NULLS LAST
   LIMIT 1;

  RETURN jsonb_build_object('webhook_events', v_events, 'subscription', v_subscription);
END;
$fn$;

REVOKE ALL ON FUNCTION public.billing_probe_status(text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_probe_status(text, text, timestamptz)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.billing_probe_status(text, text, timestamptz) IS
  'Nocna sonda rozliczen (billing-nightly.yml): po sprawdzeniu tokenu zwraca stan przetwarzania zdarzen PIASKOWNICY jednej subskrypcji sub_ od chwili zbrojenia. Klucz publikowalny + token sondy zamiast service_role.';
