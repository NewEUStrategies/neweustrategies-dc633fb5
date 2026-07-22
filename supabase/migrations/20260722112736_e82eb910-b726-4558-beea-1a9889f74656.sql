-- =============================================================================
-- Gift Articles ("Podaruj artykul" / "Share full article") - wzor NYT.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gift_article_settings (
  tenant_id uuid PRIMARY KEY DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  monthly_limit integer NOT NULL DEFAULT 0
    CHECK (monthly_limit BETWEEN 0 AND 1000),
  link_ttl_days integer NOT NULL DEFAULT 0
    CHECK (link_ttl_days BETWEEN 0 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.gift_article_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gift settings public read" ON public.gift_article_settings;
CREATE POLICY "gift settings public read"
  ON public.gift_article_settings FOR SELECT
  TO anon, authenticated
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "gift settings staff write" ON public.gift_article_settings;
CREATE POLICY "gift settings staff write"
  ON public.gift_article_settings FOR ALL
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  );

GRANT SELECT ON public.gift_article_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gift_article_settings TO authenticated;
GRANT ALL ON public.gift_article_settings TO service_role;

DROP TRIGGER IF EXISTS trg_gift_article_settings_updated ON public.gift_article_settings;
CREATE TRIGGER trg_gift_article_settings_updated
  BEFORE UPDATE ON public.gift_article_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.post_gift_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE
    DEFAULT replace(replace(rtrim(encode(gen_random_bytes(18), 'base64'), '='), '+', '-'), '/', '_'),
  period_month date NOT NULL DEFAULT (date_trunc('month', now()))::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  redemption_count integer NOT NULL DEFAULT 0,
  last_redeemed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS post_gift_links_active_uniq
  ON public.post_gift_links (tenant_id, post_id, created_by)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS post_gift_links_creator_period_idx
  ON public.post_gift_links (tenant_id, created_by, period_month);

ALTER TABLE public.post_gift_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gift links owner read" ON public.post_gift_links;
CREATE POLICY "gift links owner read"
  ON public.post_gift_links FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR (
      tenant_id = current_tenant_id()
      AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    )
  );

REVOKE ALL ON public.post_gift_links FROM anon;
GRANT SELECT ON public.post_gift_links TO authenticated;
GRANT ALL ON public.post_gift_links TO service_role;

CREATE OR REPLACE FUNCTION public.can_gift_articles()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.public_tenant_id();
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.user_subscriptions us
     WHERE us.user_id = v_uid
       AND us.tenant_id = v_tenant
       AND us.status = 'active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
  ) THEN
    RETURN true;
  END IF;

  RETURN public.user_has_tier_feature(v_uid, 'premium_content');
END $$;

REVOKE ALL ON FUNCTION public.can_gift_articles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_gift_articles() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gift_article_state(_post_id uuid)
RETURNS TABLE (
  enabled boolean,
  can_gift boolean,
  requires_auth boolean,
  requires_subscription boolean,
  used integer,
  monthly_limit integer,
  remaining integer,
  existing_code text,
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.public_tenant_id();
  v_settings public.gift_article_settings%ROWTYPE;
  v_enabled boolean := true;
  v_limit integer := 0;
  v_can boolean := false;
  v_used integer := 0;
  v_code text;
  v_expires timestamptz;
  v_period date := (date_trunc('month', now()))::date;
BEGIN
  SELECT * INTO v_settings FROM public.gift_article_settings s WHERE s.tenant_id = v_tenant;
  IF FOUND THEN
    v_enabled := v_settings.enabled;
    v_limit := v_settings.monthly_limit;
  END IF;

  IF NOT v_enabled THEN
    RETURN QUERY SELECT false, false, false, false, 0, 0, 0, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_uid IS NULL THEN
    RETURN QUERY SELECT true, false, true, false, 0, v_limit, 0, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  v_can := public.can_gift_articles();
  IF NOT v_can THEN
    RETURN QUERY SELECT true, false, false, true, 0, v_limit, 0, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_used
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.created_by = v_uid
     AND l.period_month = v_period
     AND l.revoked_at IS NULL;

  SELECT l.code, l.expires_at INTO v_code, v_expires
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.post_id = _post_id
     AND l.created_by = v_uid
     AND l.revoked_at IS NULL
     AND (l.expires_at IS NULL OR l.expires_at > now());

  RETURN QUERY SELECT
    true,
    true,
    false,
    false,
    v_used,
    v_limit,
    CASE WHEN v_limit > 0 THEN GREATEST(v_limit - v_used, 0) ELSE NULL::integer END,
    v_code,
    v_expires;
END $$;

REVOKE ALL ON FUNCTION public.gift_article_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gift_article_state(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_gift_link(_post_id uuid)
RETURNS TABLE (
  code text,
  expires_at timestamptz,
  used integer,
  monthly_limit integer,
  remaining integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.public_tenant_id();
  v_settings public.gift_article_settings%ROWTYPE;
  v_enabled boolean := true;
  v_limit integer := 0;
  v_ttl integer := 0;
  v_used integer := 0;
  v_existing public.post_gift_links%ROWTYPE;
  v_new_code text;
  v_new_expires timestamptz;
  v_period date := (date_trunc('month', now()))::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'gift_auth_required';
  END IF;

  SELECT * INTO v_settings FROM public.gift_article_settings s WHERE s.tenant_id = v_tenant;
  IF FOUND THEN
    v_enabled := v_settings.enabled;
    v_limit := v_settings.monthly_limit;
    v_ttl := v_settings.link_ttl_days;
  END IF;

  IF NOT v_enabled THEN
    RAISE EXCEPTION 'gift_disabled';
  END IF;

  IF NOT public.can_gift_articles() THEN
    RAISE EXCEPTION 'gift_subscription_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.posts p
     WHERE p.id = _post_id
       AND p.tenant_id = v_tenant
       AND p.status = 'published'
       AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'gift_post_not_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.content_access ca
     WHERE ca.entity_type = 'post'
       AND ca.entity_id = _post_id
       AND ca.mode = 'password'
  ) THEN
    RAISE EXCEPTION 'gift_post_not_found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text || ':' || _post_id::text));

  SELECT * INTO v_existing
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.post_id = _post_id
     AND l.created_by = v_uid
     AND l.revoked_at IS NULL;

  IF FOUND AND (v_existing.expires_at IS NULL OR v_existing.expires_at > now()) THEN
    SELECT count(*)::integer INTO v_used
      FROM public.post_gift_links l
     WHERE l.tenant_id = v_tenant
       AND l.created_by = v_uid
       AND l.period_month = v_period
       AND l.revoked_at IS NULL;
    RETURN QUERY SELECT
      v_existing.code,
      v_existing.expires_at,
      v_used,
      v_limit,
      CASE WHEN v_limit > 0 THEN GREATEST(v_limit - v_used, 0) ELSE NULL::integer END;
    RETURN;
  END IF;

  IF FOUND THEN
    UPDATE public.post_gift_links SET revoked_at = now() WHERE id = v_existing.id;
  END IF;

  SELECT count(*)::integer INTO v_used
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.created_by = v_uid
     AND l.period_month = v_period
     AND l.revoked_at IS NULL;

  IF v_limit > 0 AND v_used >= v_limit THEN
    RAISE EXCEPTION 'gift_limit_reached';
  END IF;

  v_new_expires := CASE WHEN v_ttl > 0 THEN now() + make_interval(days => v_ttl) END;

  INSERT INTO public.post_gift_links (tenant_id, post_id, created_by, expires_at)
  VALUES (v_tenant, _post_id, v_uid, v_new_expires)
  RETURNING post_gift_links.code INTO v_new_code;

  RETURN QUERY SELECT
    v_new_code,
    v_new_expires,
    v_used + 1,
    v_limit,
    CASE WHEN v_limit > 0 THEN GREATEST(v_limit - (v_used + 1), 0) ELSE NULL::integer END;
END $$;

REVOKE ALL ON FUNCTION public.create_gift_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_gift_link(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.redeem_gift_link(_post_id uuid, _code text)
RETURNS TABLE (
  valid boolean,
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
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_link public.post_gift_links%ROWTYPE;
BEGIN
  SELECT * INTO v_link
    FROM public.post_gift_links l
   WHERE l.code = _code
     AND l.tenant_id = v_tenant
     AND l.post_id = _post_id
     AND l.revoked_at IS NULL
     AND (l.expires_at IS NULL OR l.expires_at > now());

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.content_access ca
     WHERE ca.entity_type = 'post'
       AND ca.entity_id = _post_id
       AND ca.mode = 'password'
  ) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  IF v_uid IS DISTINCT FROM v_link.created_by THEN
    UPDATE public.post_gift_links
       SET redemption_count = redemption_count + 1,
           last_redeemed_at = now()
     WHERE id = v_link.id;
  END IF;

  RETURN QUERY
    SELECT true, p.content_pl, p.content_en, p.builder_data, p.blocks_data
      FROM public.posts p
     WHERE p.id = _post_id
       AND p.tenant_id = v_tenant
       AND p.status = 'published'
       AND p.deleted_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.redeem_gift_link(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_gift_link(uuid, text) TO anon, authenticated, service_role;