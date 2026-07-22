
-- =============================================================================
-- Gift Articles - audyt zdarzen (created / redeemed / revoked).
-- Trigger na post_gift_links pisze do gift_events; nie ruszamy istniejacych
-- RPC (create_gift_link / redeem_gift_link) - audyt "z boku" jest odporny na
-- zmiany logiki biznesowej. Panel admina czyta przez SECURITY DEFINER RPC.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gift_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  link_id uuid REFERENCES public.post_gift_links(id) ON DELETE SET NULL,
  post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('created','redeemed','revoked','expired')),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gift_events_tenant_created_idx
  ON public.gift_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gift_events_link_idx
  ON public.gift_events (link_id);
CREATE INDEX IF NOT EXISTS gift_events_post_idx
  ON public.gift_events (post_id);

GRANT SELECT ON public.gift_events TO authenticated;
GRANT ALL ON public.gift_events TO service_role;

ALTER TABLE public.gift_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gift events staff read" ON public.gift_events;
CREATE POLICY "gift events staff read"
  ON public.gift_events FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  );

-- Trigger audytu: created / redeemed (redemption_count wzrasta) / revoked.
CREATE OR REPLACE FUNCTION public.gift_links_audit_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.gift_events (tenant_id, link_id, post_id, event_type, actor_id, code)
    VALUES (NEW.tenant_id, NEW.id, NEW.post_id, 'created', NEW.created_by, NEW.code);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Cofniecie linku (rotacja lub akcja admina).
    IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
      INSERT INTO public.gift_events (tenant_id, link_id, post_id, event_type, actor_id, code)
      VALUES (NEW.tenant_id, NEW.id, NEW.post_id, 'revoked', auth.uid(), NEW.code);
    END IF;

    -- Kazdy nowy redemption jako osobne zdarzenie (delta liczonych odslon).
    IF NEW.redemption_count > COALESCE(OLD.redemption_count, 0) THEN
      INSERT INTO public.gift_events (tenant_id, link_id, post_id, event_type, actor_id, code, metadata)
      VALUES (
        NEW.tenant_id, NEW.id, NEW.post_id, 'redeemed', auth.uid(), NEW.code,
        jsonb_build_object('count', NEW.redemption_count)
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gift_links_audit ON public.post_gift_links;
CREATE TRIGGER trg_gift_links_audit
  AFTER INSERT OR UPDATE ON public.post_gift_links
  FOR EACH ROW EXECUTE FUNCTION public.gift_links_audit_tg();

-- -----------------------------------------------------------------------------
-- RPC: revoke_gift_link_admin - admin cofa dowolny link w swoim tenant.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_gift_link_admin(_link_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;
  IF NOT (has_role(v_uid, 'admin'::app_role) OR has_role(v_uid, 'editor'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.post_gift_links
     SET revoked_at = now()
   WHERE id = _link_id
     AND tenant_id = v_tenant
     AND revoked_at IS NULL;

  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.revoke_gift_link_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_gift_link_admin(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPC: list_gift_links_admin - stronicowana lista linkow w tenancie.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_gift_links_admin(
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0,
  _status text DEFAULT 'all',       -- 'all' | 'active' | 'revoked' | 'expired'
  _post_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  post_id uuid,
  post_title text,
  post_slug text,
  created_by uuid,
  creator_email text,
  creator_name text,
  code text,
  created_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  redemption_count integer,
  last_redeemed_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_uid uuid := auth.uid();
  v_total bigint;
BEGIN
  IF v_uid IS NULL OR NOT (
    has_role(v_uid, 'admin'::app_role) OR has_role(v_uid, 'editor'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND (_post_id IS NULL OR l.post_id = _post_id)
     AND (
       _status = 'all'
       OR (_status = 'active'  AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > now()))
       OR (_status = 'revoked' AND l.revoked_at IS NOT NULL)
       OR (_status = 'expired' AND l.revoked_at IS NULL AND l.expires_at IS NOT NULL AND l.expires_at <= now())
     );

  RETURN QUERY
  SELECT
    l.id,
    l.post_id,
    COALESCE(p.title_pl, p.title_en, '') AS post_title,
    p.slug AS post_slug,
    l.created_by,
    u.email::text AS creator_email,
    COALESCE(pr.display_name, pr.first_name || ' ' || pr.last_name, u.email::text) AS creator_name,
    l.code,
    l.created_at,
    l.expires_at,
    l.revoked_at,
    l.redemption_count,
    l.last_redeemed_at,
    v_total
  FROM public.post_gift_links l
  LEFT JOIN public.posts p ON p.id = l.post_id
  LEFT JOIN auth.users u ON u.id = l.created_by
  LEFT JOIN public.profiles pr ON pr.id = l.created_by
  WHERE l.tenant_id = v_tenant
    AND (_post_id IS NULL OR l.post_id = _post_id)
    AND (
      _status = 'all'
      OR (_status = 'active'  AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > now()))
      OR (_status = 'revoked' AND l.revoked_at IS NOT NULL)
      OR (_status = 'expired' AND l.revoked_at IS NULL AND l.expires_at IS NOT NULL AND l.expires_at <= now())
    )
  ORDER BY l.created_at DESC
  LIMIT GREATEST(_limit, 1)
  OFFSET GREATEST(_offset, 0);
END $$;

REVOKE ALL ON FUNCTION public.list_gift_links_admin(integer, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_gift_links_admin(integer, integer, text, uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPC: list_gift_events_admin - stronicowany audit log.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_gift_events_admin(
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0,
  _event_type text DEFAULT 'all',
  _link_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  event_type text,
  link_id uuid,
  post_id uuid,
  post_title text,
  actor_id uuid,
  actor_email text,
  actor_name text,
  code text,
  metadata jsonb,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_uid uuid := auth.uid();
  v_total bigint;
BEGIN
  IF v_uid IS NULL OR NOT (
    has_role(v_uid, 'admin'::app_role) OR has_role(v_uid, 'editor'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.gift_events e
   WHERE e.tenant_id = v_tenant
     AND (_event_type = 'all' OR e.event_type = _event_type)
     AND (_link_id IS NULL OR e.link_id = _link_id);

  RETURN QUERY
  SELECT
    e.id,
    e.event_type,
    e.link_id,
    e.post_id,
    COALESCE(p.title_pl, p.title_en, '') AS post_title,
    e.actor_id,
    u.email::text AS actor_email,
    COALESCE(pr.display_name, pr.first_name || ' ' || pr.last_name, u.email::text) AS actor_name,
    e.code,
    e.metadata,
    e.created_at,
    v_total
  FROM public.gift_events e
  LEFT JOIN public.posts p ON p.id = e.post_id
  LEFT JOIN auth.users u ON u.id = e.actor_id
  LEFT JOIN public.profiles pr ON pr.id = e.actor_id
  WHERE e.tenant_id = v_tenant
    AND (_event_type = 'all' OR e.event_type = _event_type)
    AND (_link_id IS NULL OR e.link_id = _link_id)
  ORDER BY e.created_at DESC
  LIMIT GREATEST(_limit, 1)
  OFFSET GREATEST(_offset, 0);
END $$;

REVOKE ALL ON FUNCTION public.list_gift_events_admin(integer, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_gift_events_admin(integer, integer, text, uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPC: get_gift_stats_admin - dashboard counters (created, redeemed, active).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_gift_stats_admin()
RETURNS TABLE (
  active_links integer,
  revoked_links integer,
  expired_links integer,
  total_created integer,
  total_redeemed integer,
  created_this_month integer,
  redeemed_this_month integer,
  unique_gifters integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_uid uuid := auth.uid();
  v_period date := (date_trunc('month', now()))::date;
BEGIN
  IF v_uid IS NULL OR NOT (
    has_role(v_uid, 'admin'::app_role) OR has_role(v_uid, 'editor'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*)::integer FROM public.post_gift_links l
      WHERE l.tenant_id = v_tenant AND l.revoked_at IS NULL
        AND (l.expires_at IS NULL OR l.expires_at > now())),
    (SELECT count(*)::integer FROM public.post_gift_links l
      WHERE l.tenant_id = v_tenant AND l.revoked_at IS NOT NULL),
    (SELECT count(*)::integer FROM public.post_gift_links l
      WHERE l.tenant_id = v_tenant AND l.revoked_at IS NULL
        AND l.expires_at IS NOT NULL AND l.expires_at <= now()),
    (SELECT count(*)::integer FROM public.gift_events e
      WHERE e.tenant_id = v_tenant AND e.event_type = 'created'),
    (SELECT count(*)::integer FROM public.gift_events e
      WHERE e.tenant_id = v_tenant AND e.event_type = 'redeemed'),
    (SELECT count(*)::integer FROM public.post_gift_links l
      WHERE l.tenant_id = v_tenant AND l.period_month = v_period AND l.revoked_at IS NULL),
    (SELECT count(*)::integer FROM public.gift_events e
      WHERE e.tenant_id = v_tenant AND e.event_type = 'redeemed'
        AND e.created_at >= v_period),
    (SELECT count(DISTINCT l.created_by)::integer FROM public.post_gift_links l
      WHERE l.tenant_id = v_tenant);
END $$;

REVOKE ALL ON FUNCTION public.get_gift_stats_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gift_stats_admin() TO authenticated, service_role;
