
ALTER TABLE public.metered_views
  ADD COLUMN IF NOT EXISTS ip_subject text;

DO $$
BEGIN
  ALTER TABLE public.metered_views
    ADD CONSTRAINT metered_views_ip_subject_check
    CHECK (ip_subject IS NULL OR (user_id IS NULL AND ip_subject ~ '^ip:[0-9a-f]{32}$'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS metered_views_ip_period_idx
  ON public.metered_views (tenant_id, ip_subject, period_month)
  WHERE user_id IS NULL AND ip_subject IS NOT NULL;

COMMENT ON COLUMN public.metered_views.ip_subject IS
  'Solony skrot adresu goscia (requestRateSubject: ip:<32 hex>) pod adresowy limit '
  'meteringu. Tylko wiersze gosci, tylko biezacy okres - starsze zeruje '
  'metered_views_scrub_ip().';

CREATE OR REPLACE FUNCTION public._metered_view_consume(
  _tenant uuid,
  _uid uuid,
  _visitor_id uuid,
  _ip_subject text,
  _entity_type public.access_entity_type,
  _entity_id uuid
)
RETURNS TABLE (
  granted boolean,
  consumed boolean,
  used integer,
  monthly_limit integer,
  remaining integer,
  requires_registration boolean,
  show_counter boolean,
  content_pl text,
  content_en text,
  builder_data jsonb,
  blocks_data jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.metering_settings%ROWTYPE;
  v_mode public.access_mode;
  v_policy text;
  v_rule_tenant uuid;
  v_limit integer := 0;
  v_ip_limit integer := 0;
  v_used integer := 0;
  v_ip_used integer := 0;
  v_remaining integer := 0;
  v_already boolean := false;
  v_insert_count integer := 0;
  v_requires_registration boolean := false;
  v_show_counter boolean := false;
  v_content_pl text;
  v_content_en text;
  v_builder jsonb;
  v_blocks jsonb;
  v_body_found boolean := false;
  v_period date := (date_trunc('month', now()))::date;
  v_subject text;
BEGIN
  IF _uid IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'metering_identity_mismatch';
  END IF;
  IF _uid IS NULL AND _ip_subject IS NOT NULL AND _ip_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'metering_ip_subject_invalid';
  END IF;

  IF _entity_type = 'media' OR _tenant IS NULL THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  SELECT ca.mode, ca.metering_policy, ca.tenant_id
    INTO v_mode, v_policy, v_rule_tenant
    FROM public.content_access ca
   WHERE ca.entity_type = _entity_type AND ca.entity_id = _entity_id;

  IF NOT FOUND OR v_mode = 'public' OR v_mode = 'password' OR v_rule_tenant IS DISTINCT FROM _tenant THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  SELECT * INTO v_settings FROM public.metering_settings ms WHERE ms.tenant_id = _tenant;
  IF NOT FOUND OR NOT v_settings.enabled OR v_policy = 'exempt' THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  v_show_counter := v_settings.show_counter;

  IF _uid IS NOT NULL AND public.has_content_access(_entity_type, _entity_id) THEN
    SELECT b.content_pl, b.content_en, b.builder_data, b.blocks_data
      INTO v_content_pl, v_content_en, v_builder, v_blocks
      FROM public.get_entity_content(_entity_type, _entity_id) b;
    v_body_found := FOUND;
    RETURN QUERY SELECT v_body_found, false, 0, 0, 0, false, v_show_counter,
      v_content_pl, v_content_en, v_builder, v_blocks;
    RETURN;
  END IF;

  IF v_policy = 'inherit' THEN
    IF v_mode = 'paid' AND NOT v_settings.meter_paid THEN
      RETURN QUERY SELECT false, false, 0, 0, 0, false, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    IF v_mode = 'members' AND NOT v_settings.meter_members THEN
      RETURN QUERY SELECT false, false, 0, 0, 0, false, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
  END IF;

  IF _uid IS NOT NULL THEN
    v_limit := v_settings.member_monthly_limit;
    v_subject := 'u:' || _uid::text;
  ELSE
    v_limit := v_settings.anon_monthly_limit;
    v_requires_registration := v_settings.anon_monthly_limit <= 0;
    IF _visitor_id IS NULL OR _ip_subject IS NULL OR v_requires_registration THEN
      INSERT INTO public.metering_event_log
        (tenant_id, user_id, visitor_id, entity_type, entity_id, outcome, reason,
         used_before, monthly_limit)
      VALUES
        (_tenant, NULL, _visitor_id, _entity_type::text, _entity_id, 'requires_registration',
         CASE WHEN v_requires_registration THEN 'anon_limit_zero' ELSE 'no_visitor_identity' END,
         0, v_limit);
      RETURN QUERY SELECT false, false, 0, v_limit, GREATEST(v_limit, 0), true, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    v_subject := 'v:' || _visitor_id::text;
    v_ip_limit := v_limit * 5;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant::text || ':' || v_subject, 0));
  IF _uid IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_tenant::text || ':' || _ip_subject, 0));
  END IF;

  IF _uid IS NOT NULL THEN
    SELECT count(*)::integer,
           bool_or(mv.entity_type = _entity_type AND mv.entity_id = _entity_id)
      INTO v_used, v_already
      FROM public.metered_views mv
     WHERE mv.tenant_id = _tenant AND mv.user_id = _uid
       AND mv.period_month = v_period;
  ELSE
    SELECT count(*)::integer,
           bool_or(mv.entity_type = _entity_type AND mv.entity_id = _entity_id)
      INTO v_used, v_already
      FROM public.metered_views mv
     WHERE mv.tenant_id = _tenant AND mv.user_id IS NULL AND mv.visitor_id = _visitor_id
       AND mv.period_month = v_period;
  END IF;
  v_already := COALESCE(v_already, false);

  IF NOT v_already THEN
    IF v_used >= v_limit THEN
      IF _uid IS NULL THEN
        INSERT INTO public.metering_event_log
          (tenant_id, user_id, visitor_id, entity_type, entity_id, outcome, reason,
           used_before, monthly_limit)
        VALUES
          (_tenant, NULL, _visitor_id, _entity_type::text, _entity_id, 'denied',
           'monthly_limit_reached', v_used, v_limit);
      END IF;
      RETURN QUERY SELECT false, false, v_used, v_limit, 0, false, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    IF _uid IS NULL THEN
      SELECT count(DISTINCT (mv.entity_type, mv.entity_id))::integer
        INTO v_ip_used
        FROM public.metered_views mv
       WHERE mv.tenant_id = _tenant AND mv.user_id IS NULL
         AND mv.ip_subject = _ip_subject
         AND mv.period_month = v_period;
      IF v_ip_used >= v_ip_limit AND NOT EXISTS (
        SELECT 1 FROM public.metered_views mv
         WHERE mv.tenant_id = _tenant AND mv.user_id IS NULL
           AND mv.ip_subject = _ip_subject
           AND mv.period_month = v_period
           AND mv.entity_type = _entity_type AND mv.entity_id = _entity_id
      ) THEN
        INSERT INTO public.metering_event_log
          (tenant_id, user_id, visitor_id, entity_type, entity_id, outcome, reason,
           used_before, monthly_limit, metadata)
        VALUES
          (_tenant, NULL, _visitor_id, _entity_type::text, _entity_id, 'denied',
           'ip_limit_reached', v_used, v_limit,
           jsonb_build_object('ip_used', v_ip_used, 'ip_limit', v_ip_limit));
        RETURN QUERY SELECT false, false, v_used, v_limit, 0, true, v_show_counter,
          NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
        RETURN;
      END IF;
    END IF;
    INSERT INTO public.metered_views
      (tenant_id, user_id, visitor_id, entity_type, entity_id, ip_subject)
    VALUES
      (_tenant, _uid,
       CASE WHEN _uid IS NULL THEN _visitor_id ELSE NULL END,
       _entity_type, _entity_id,
       CASE WHEN _uid IS NULL THEN _ip_subject ELSE NULL END)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_insert_count = ROW_COUNT;
    IF v_insert_count > 0 THEN
      v_used := v_used + 1;
    END IF;
  END IF;

  v_remaining := GREATEST(v_limit - v_used, 0);
  IF _uid IS NULL THEN
    SELECT count(DISTINCT (mv.entity_type, mv.entity_id))::integer
      INTO v_ip_used
      FROM public.metered_views mv
     WHERE mv.tenant_id = _tenant AND mv.user_id IS NULL
       AND mv.ip_subject = _ip_subject
       AND mv.period_month = v_period;
    v_remaining := GREATEST(LEAST(v_remaining, v_ip_limit - v_ip_used), 0);
  END IF;

  IF _entity_type = 'post' THEN
    SELECT p.content_pl, p.content_en, p.builder_data, p.blocks_data
      INTO v_content_pl, v_content_en, v_builder, v_blocks
      FROM public.posts p
     WHERE p.id = _entity_id AND p.tenant_id = _tenant
       AND p.status = 'published' AND p.deleted_at IS NULL;
    v_body_found := FOUND;
  ELSE
    SELECT pg.content_pl, pg.content_en, pg.builder_data, NULL::jsonb
      INTO v_content_pl, v_content_en, v_builder, v_blocks
      FROM public.pages pg
     WHERE pg.id = _entity_id AND pg.tenant_id = _tenant
       AND pg.status = 'published' AND pg.deleted_at IS NULL;
    v_body_found := FOUND;
  END IF;

  IF NOT v_body_found THEN
    RETURN QUERY SELECT false, false, v_used, v_limit, v_remaining, false,
      v_show_counter, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true,
    (NOT v_already AND v_insert_count > 0),
    v_used,
    v_limit,
    v_remaining,
    false,
    v_show_counter,
    v_content_pl, v_content_en, v_builder, v_blocks;
END $$;

REVOKE ALL ON FUNCTION public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid) IS
  'Wewnetrzny rdzen meteringu (bez EXECUTE dla klientow): limit miesieczny konta albo goscia, '
  'adresowy sufit gosci (5 x anon_monthly_limit), serializacja pg_advisory_xact_lock per '
  '<najemca>:<podmiot> (i <najemca>:<skrot adresu>) PRZED zliczeniem. Odmowa sufitu adresu: '
  'requires_registration = true (wlasny limit goscia nie wyczerpany); remaining goscia = '
  'min(wlasny limit, sufit adresu). Woluja go consume_metered_view (konto) '
  'i consume_metered_view_visitor (service_role).';

DROP FUNCTION IF EXISTS public.consume_metered_view(public.access_entity_type, uuid, uuid);

CREATE OR REPLACE FUNCTION public.consume_metered_view(
  _entity_type public.access_entity_type,
  _entity_id uuid
)
RETURNS TABLE (
  granted boolean,
  consumed boolean,
  used integer,
  monthly_limit integer,
  remaining integer,
  requires_registration boolean,
  show_counter boolean,
  content_pl text,
  content_en text,
  builder_data jsonb,
  blocks_data jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, true, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT * FROM public._metered_view_consume(
      public.public_tenant_id(), v_uid, NULL::uuid, NULL::text, _entity_type, _entity_id);
END $$;

REVOKE ALL ON FUNCTION public.consume_metered_view(public.access_entity_type, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_metered_view(public.access_entity_type, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.consume_metered_view(public.access_entity_type, uuid) IS
  'Metered paywall dla KONTA (auth.uid()): wydaje body zabramkowanego wpisu/strony w zamian '
  'za slot miesiecznego limitu (metering_settings). Idempotentne per byt/miesiac, serializowane '
  'per konto; uprawnieni (has_content_access) dostaja body bez zuzycia. Gosc: '
  'consume_metered_view_visitor (service_role).';

CREATE OR REPLACE FUNCTION public.consume_metered_view_visitor(
  _tenant uuid,
  _entity_type public.access_entity_type,
  _entity_id uuid,
  _visitor_id uuid,
  _ip_subject text
)
RETURNS TABLE (
  granted boolean,
  consumed boolean,
  used integer,
  monthly_limit integer,
  remaining integer,
  requires_registration boolean,
  show_counter boolean,
  content_pl text,
  content_en text,
  builder_data jsonb,
  blocks_data jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT * FROM public._metered_view_consume(
      _tenant, NULL::uuid, _visitor_id, _ip_subject, _entity_type, _entity_id);
END $$;

REVOKE ALL ON FUNCTION public.consume_metered_view_visitor(uuid, public.access_entity_type, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_metered_view_visitor(uuid, public.access_entity_type, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.consume_metered_view_visitor(uuid, public.access_entity_type, uuid, uuid, text) IS
  'Metered paywall dla GOSCIA - tylko service_role. Najemca z zaufanego hosta, _visitor_id z '
  'cookie HttpOnly z waznym podpisem HMAC, _ip_subject = solony skrot adresu (ip:<32 hex>). '
  'Limit goscia + adresowy sufit, serializacja per gosc i per adres.';

CREATE OR REPLACE FUNCTION public._metering_state(
  _tenant uuid,
  _uid uuid,
  _visitor_id uuid,
  _ip_subject text
)
RETURNS TABLE (
  enabled boolean,
  monthly_limit integer,
  used integer,
  remaining integer,
  requires_registration boolean,
  show_counter boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.metering_settings%ROWTYPE;
  v_limit integer := 0;
  v_used integer := 0;
  v_remaining integer := 0;
  v_ip_used integer := 0;
  v_period date := (date_trunc('month', now()))::date;
BEGIN
  SELECT * INTO v_settings FROM public.metering_settings ms WHERE ms.tenant_id = _tenant;
  IF _tenant IS NULL OR NOT FOUND OR NOT v_settings.enabled THEN
    RETURN QUERY SELECT false, 0, 0, 0, false, false;
    RETURN;
  END IF;

  IF _uid IS NOT NULL THEN
    v_limit := v_settings.member_monthly_limit;
    SELECT count(*)::integer INTO v_used
      FROM public.metered_views mv
     WHERE mv.tenant_id = _tenant AND mv.user_id = _uid AND mv.period_month = v_period;
    v_remaining := v_limit - v_used;
  ELSE
    v_limit := v_settings.anon_monthly_limit;
    IF _visitor_id IS NOT NULL THEN
      SELECT count(*)::integer INTO v_used
        FROM public.metered_views mv
       WHERE mv.tenant_id = _tenant AND mv.user_id IS NULL
         AND mv.visitor_id = _visitor_id AND mv.period_month = v_period;
    END IF;
    v_remaining := v_limit - v_used;
    IF _ip_subject IS NOT NULL AND v_limit > 0 THEN
      SELECT count(DISTINCT (mv.entity_type, mv.entity_id))::integer INTO v_ip_used
        FROM public.metered_views mv
       WHERE mv.tenant_id = _tenant AND mv.user_id IS NULL
         AND mv.ip_subject = _ip_subject AND mv.period_month = v_period;
      v_remaining := LEAST(v_remaining, v_limit * 5 - v_ip_used);
    END IF;
  END IF;

  RETURN QUERY SELECT
    true,
    v_limit,
    v_used,
    GREATEST(v_remaining, 0),
    (_uid IS NULL AND v_settings.anon_monthly_limit <= 0),
    v_settings.show_counter;
END $$;

REVOKE ALL ON FUNCTION public._metering_state(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.metering_state(uuid);

CREATE OR REPLACE FUNCTION public.metering_state()
RETURNS TABLE (
  enabled boolean,
  monthly_limit integer,
  used integer,
  remaining integer,
  requires_registration boolean,
  show_counter boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public._metering_state(public.public_tenant_id(), auth.uid(), NULL::uuid, NULL::text);
$$;

REVOKE ALL ON FUNCTION public.metering_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metering_state() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.metering_state_visitor(
  _tenant uuid,
  _ip_subject text,
  _visitor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  enabled boolean,
  monthly_limit integer,
  used integer,
  remaining integer,
  requires_registration boolean,
  show_counter boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public._metering_state(_tenant, NULL::uuid, _visitor_id, _ip_subject);
$$;

REVOKE ALL ON FUNCTION public.metering_state_visitor(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metering_state_visitor(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public.metering_state() IS
  'Stan miesiecznego limitu KONTA (auth.uid()) bez konsumpcji - licznik "zostalo N".';
COMMENT ON FUNCTION public.metering_state_visitor(uuid, text, uuid) IS
  'Stan limitu GOSCIA bez konsumpcji - tylko service_role (tozsamosc z podpisanego cookie, '
  'najemca z zaufanego hosta); remaining uwzglednia adresowy sufit.';

REVOKE ALL ON FUNCTION public.log_metering_event(text, uuid, text, text, uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_metering_event(text, uuid, text, text, uuid, integer, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.metered_views_scrub_ip(p_limit integer DEFAULT 50000)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50000), 1), 500000);
  v_scrubbed integer;
BEGIN
  WITH doomed AS (
    SELECT mv.id FROM public.metered_views mv
     WHERE mv.ip_subject IS NOT NULL
       AND mv.period_month < (date_trunc('month', now()))::date
     ORDER BY mv.period_month
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.metered_views m
     SET ip_subject = NULL
    FROM doomed d
   WHERE m.id = d.id;
  GET DIAGNOSTICS v_scrubbed = ROW_COUNT;
  RETURN v_scrubbed;
END $$;

REVOKE ALL ON FUNCTION public.metered_views_scrub_ip(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metered_views_scrub_ip(integer) TO service_role;

COMMENT ON FUNCTION public.metered_views_scrub_ip(integer) IS
  'Retencja metered_views.ip_subject: zeruje partiami (SKIP LOCKED) skrot adresu w wierszach '
  'poprzednich okresow - limit adresowy czyta wylacznie biezacy miesiac. Codziennie z pg_cron '
  '(metered-views-scrub-ip, 03:47), gdy rozszerzenie jest dostepne; inaczej na zadanie (service_role).';

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron unavailable - metered_views ip retention runs only on demand';
    RETURN;
  END IF;
  BEGIN
    PERFORM cron.unschedule('metered-views-scrub-ip');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM cron.schedule('metered-views-scrub-ip', '47 3 * * *',
    $job$SELECT public.metered_views_scrub_ip(50000)$job$);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'metered_views: scheduling ip retention job failed (%)', SQLERRM;
END $$;
