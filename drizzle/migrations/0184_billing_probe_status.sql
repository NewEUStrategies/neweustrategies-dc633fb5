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

CREATE OR REPLACE FUNCTION public.billing_probe_rotate_token()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
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