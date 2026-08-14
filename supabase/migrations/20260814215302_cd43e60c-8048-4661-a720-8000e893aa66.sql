DO $$
DECLARE
  v_leads uuid[] := '{}';
  v_lead  uuid;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY campaign_id, subscriber_id, kind, (created_at AT TIME ZONE 'UTC')::date
        ORDER BY created_at, id
      ) AS rn
    FROM public.newsletter_campaign_events
    WHERE subscriber_id IS NOT NULL
  ),
  deleted AS (
    DELETE FROM public.newsletter_campaign_events e
    USING ranked r
    WHERE e.id = r.id
      AND r.rn > 1
    RETURNING e.subscriber_id
  )
  SELECT COALESCE(array_agg(DISTINCT cl.id), '{}'::uuid[])
    INTO v_leads
    FROM deleted d
    JOIN public.newsletter_subscribers ns ON ns.id = d.subscriber_id
    JOIN public.crm_leads cl
      ON cl.tenant_id = ns.tenant_id
     AND cl.email_norm = lower(ns.email);

  FOREACH v_lead IN ARRAY v_leads LOOP
    PERFORM public.compute_crm_lead_score(v_lead);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS nl_campaign_events_subscriber_day_uq
  ON public.newsletter_campaign_events (
    campaign_id,
    subscriber_id,
    kind,
    ((created_at AT TIME ZONE 'UTC')::date)
  )
  WHERE subscriber_id IS NOT NULL;

COMMENT ON INDEX public.nl_campaign_events_subscriber_day_uq IS
  'Jedno zdarzenie na (kampania, subskrybent, rodzaj, doba UTC). Zamyka podwojne zliczanie otwarc/klikniec z dwoch producentow (piksel/przekierowanie oraz webhook Resend) i wielokrotne pobranie piksela przez klienta pocztowego.';

COMMENT ON TABLE public.newsletter_campaign_events IS
  'Zdarzenia zaangazowania w kampanii (open/click), ZDEDUPLIKOWANE do jednego wiersza na (kampania, subskrybent, rodzaj, doba UTC) przez nl_campaign_events_subscriber_day_uq. Zapis wylacznie przez newsletter_record_campaign_event (service_role); odczyt stafowy w granicach tenanta.';

DROP FUNCTION IF EXISTS public.newsletter_record_campaign_event(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.newsletter_record_campaign_event(
  p_campaign uuid,
  p_subscriber uuid,
  p_kind text,
  p_url text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_subscriber uuid;
  v_id uuid;
  v_at timestamptz := LEAST(COALESCE(p_occurred_at, now()), now());
BEGIN
  IF p_campaign IS NULL OR p_kind IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'invalid_input');
  END IF;

  IF p_kind NOT IN ('open', 'click') THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'invalid_kind');
  END IF;

  SELECT c.tenant_id INTO v_tenant
    FROM public.newsletter_campaigns c
   WHERE c.id = p_campaign;

  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'unknown_campaign');
  END IF;

  SELECT s.id INTO v_subscriber
    FROM public.newsletter_subscribers s
   WHERE s.id = p_subscriber
     AND s.tenant_id = v_tenant;

  IF v_subscriber IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'unknown_subscriber');
  END IF;

  INSERT INTO public.newsletter_campaign_events
    (tenant_id, campaign_id, subscriber_id, kind, url, created_at)
  VALUES (v_tenant, p_campaign, v_subscriber, p_kind, left(p_url, 2048), v_at)
  ON CONFLICT (campaign_id, subscriber_id, kind, ((created_at AT TIME ZONE 'UTC')::date))
    WHERE subscriber_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'recorded',  v_id IS NOT NULL,
    'duplicate', v_id IS NULL,
    'reason',    CASE WHEN v_id IS NULL THEN 'duplicate_in_day' ELSE 'recorded' END,
    'event_id',  v_id,
    'tenant_id', v_tenant,
    'event_day', (v_at AT TIME ZONE 'UTC')::date
  );
END;
$$;

COMMENT ON FUNCTION public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz) IS
  'Jedyna sciezka zapisu zdarzen open/click. Tenant z kampanii, subskrybent walidowany w tym samym tenancie, wstawienie idempotentne w dobie UTC.';

REVOKE ALL ON FUNCTION public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.newsletter_campaign_engagement(p_campaign uuid)
RETURNS TABLE (
  opens bigint,
  clicks bigint,
  unique_openers bigint,
  unique_clickers bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_uid IS NULL
     OR v_tenant IS NULL
     OR NOT (
       public.has_role(v_uid, 'admin'::public.app_role)
       OR public.has_role(v_uid, 'editor'::public.app_role)
     )
  THEN
    RAISE EXCEPTION 'forbidden: staff role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE e.kind = 'open')::bigint,
    COUNT(*) FILTER (WHERE e.kind = 'click')::bigint,
    COUNT(DISTINCT e.subscriber_id) FILTER (WHERE e.kind = 'open')::bigint,
    COUNT(DISTINCT e.subscriber_id) FILTER (WHERE e.kind = 'click')::bigint
  FROM public.newsletter_campaign_events e
  JOIN public.newsletter_campaigns c ON c.id = e.campaign_id
  WHERE e.campaign_id = p_campaign
    AND e.tenant_id = v_tenant
    AND c.tenant_id = v_tenant;
END;
$$;

COMMENT ON FUNCTION public.newsletter_campaign_engagement(uuid) IS
  'Zaangazowanie kampanii dla panelu: sumy zdarzen i ZASIEG UNIKALNY. Bramka: admin/editor w tenancie domowym.';

REVOKE ALL ON FUNCTION public.newsletter_campaign_engagement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.newsletter_campaign_engagement(uuid) TO authenticated, service_role;