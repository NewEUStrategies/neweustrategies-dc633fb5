ALTER TABLE public.gift_article_settings
  ADD COLUMN IF NOT EXISTS eligibility text NOT NULL DEFAULT 'registered'
    CHECK (eligibility IN ('registered', 'subscribers'));

ALTER TABLE public.gift_article_settings
  ALTER COLUMN max_redemptions_per_link SET DEFAULT 5;

UPDATE public.gift_article_settings SET max_redemptions_per_link = 5
 WHERE max_redemptions_per_link = 50;

UPDATE public.gift_article_settings SET eligibility = 'registered'
 WHERE eligibility IS DISTINCT FROM 'registered';

COMMENT ON COLUMN public.gift_article_settings.eligibility IS
  'Kto moze wygenerowac link "Udostepnij pelny artykul": registered = kazde '
  'konto tego tenanta, subscribers = tylko aktywna subskrypcja / warstwa '
  'premium_content (can_gift_articles).';

COMMENT ON COLUMN public.gift_article_settings.max_redemptions_per_link IS
  'Domyslny budzet klikniec dla NOWYCH linkow (0 = bez limitu). Wartosc jest '
  'zamrazana na linku przy tworzeniu (post_gift_links.max_redemptions) - '
  'zmiana ustawienia nie rusza linkow juz udostepnionych.';

ALTER TABLE public.post_gift_links
  ADD COLUMN IF NOT EXISTS max_redemptions integer NOT NULL DEFAULT 0
    CHECK (max_redemptions BETWEEN 0 AND 100000);

UPDATE public.post_gift_links l
   SET max_redemptions = COALESCE(
         (SELECT s.max_redemptions_per_link
            FROM public.gift_article_settings s
           WHERE s.tenant_id = l.tenant_id),
         5)
 WHERE l.max_redemptions = 0;

COMMENT ON COLUMN public.post_gift_links.max_redemptions IS
  'Budzet klikniec zamrozony w chwili utworzenia linku (0 = bez limitu). '
  'redeem_gift_link egzekwuje wlasnie te wartosc, nie biezace ustawienia.';

CREATE TABLE IF NOT EXISTS public.post_gift_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  link_id uuid NOT NULL REFERENCES public.post_gift_links(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  recipient_key text NOT NULL,
  recipient_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  hits integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS post_gift_redemptions_slot_uniq
  ON public.post_gift_redemptions (link_id, recipient_key);
CREATE INDEX IF NOT EXISTS post_gift_redemptions_tenant_post_idx
  ON public.post_gift_redemptions (tenant_id, post_id);

ALTER TABLE public.post_gift_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gift redemptions staff read" ON public.post_gift_redemptions;
CREATE POLICY "gift redemptions staff read"
  ON public.post_gift_redemptions FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  );

REVOKE ALL ON public.post_gift_redemptions FROM anon;
GRANT SELECT ON public.post_gift_redemptions TO authenticated;
GRANT ALL ON public.post_gift_redemptions TO service_role;

COMMENT ON TABLE public.post_gift_redemptions IS
  'Rejestr odbiorcow linku podarunkowego: jeden wiersz = jeden zuzyty slot '
  'budzetu klikniec. Powtorne wejscie tej samej tozsamosci podbija hits, ale '
  'NIE konsumuje kolejnego slotu.';

ALTER TABLE public.gift_events DROP CONSTRAINT IF EXISTS gift_events_event_type_check;
ALTER TABLE public.gift_events ADD CONSTRAINT gift_events_event_type_check
  CHECK (event_type IN ('created', 'redeemed', 'revoked', 'expired', 'exhausted'));

CREATE OR REPLACE FUNCTION public.gift_share_eligibility()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.eligibility
       FROM public.gift_article_settings s
      WHERE s.tenant_id = public.public_tenant_id()),
    'registered'
  );
$$;

REVOKE ALL ON FUNCTION public.gift_share_eligibility() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gift_share_eligibility() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_share_full_article()
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
  IF public.current_tenant_id() IS DISTINCT FROM v_tenant THEN
    RETURN false;
  END IF;
  IF public.gift_share_eligibility() = 'subscribers' THEN
    RETURN public.can_gift_articles();
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.can_share_full_article() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_share_full_article() TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.gift_article_state(uuid);
CREATE FUNCTION public.gift_article_state(_post_id uuid)
RETURNS TABLE (
  enabled boolean,
  can_gift boolean,
  requires_auth boolean,
  requires_subscription boolean,
  used integer,
  monthly_limit integer,
  remaining integer,
  existing_code text,
  expires_at timestamptz,
  eligibility text,
  max_redemptions integer,
  redemption_count integer,
  redemptions_remaining integer
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
  v_limit integer := 10;
  v_cap integer := 5;
  v_eligibility text := public.gift_share_eligibility();
  v_used integer := 0;
  v_link public.post_gift_links%ROWTYPE;
BEGIN
  SELECT * INTO v_settings FROM public.gift_article_settings s WHERE s.tenant_id = v_tenant;
  IF FOUND THEN
    v_enabled := v_settings.enabled;
    v_limit := v_settings.monthly_limit;
    v_cap := v_settings.max_redemptions_per_link;
  END IF;
  IF NOT v_enabled THEN
    RETURN QUERY SELECT false, false, false, false, 0, 0, 0,
      NULL::text, NULL::timestamptz, v_eligibility, 0, 0, 0;
    RETURN;
  END IF;
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT true, false, true, false, 0, v_limit, 0,
      NULL::text, NULL::timestamptz, v_eligibility, v_cap, 0, v_cap;
    RETURN;
  END IF;
  IF NOT public.can_share_full_article() THEN
    RETURN QUERY SELECT
      true,
      false,
      v_eligibility <> 'subscribers',
      v_eligibility = 'subscribers',
      0, v_limit, 0, NULL::text, NULL::timestamptz, v_eligibility, v_cap, 0, v_cap;
    RETURN;
  END IF;
  SELECT count(DISTINCT l.post_id)::integer INTO v_used
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.created_by = v_uid
     AND l.period_month = (date_trunc('month', now()))::date;
  SELECT * INTO v_link
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
    v_link.code,
    v_link.expires_at,
    v_eligibility,
    COALESCE(v_link.max_redemptions, v_cap),
    COALESCE(v_link.redemption_count, 0),
    CASE
      WHEN COALESCE(v_link.max_redemptions, v_cap) > 0
        THEN GREATEST(COALESCE(v_link.max_redemptions, v_cap) - COALESCE(v_link.redemption_count, 0), 0)
      ELSE NULL::integer
    END;
END $$;

REVOKE ALL ON FUNCTION public.gift_article_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gift_article_state(uuid) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.create_gift_link(uuid);
CREATE FUNCTION public.create_gift_link(_post_id uuid)
RETURNS TABLE (
  code text,
  expires_at timestamptz,
  used integer,
  monthly_limit integer,
  remaining integer,
  max_redemptions integer,
  redemption_count integer,
  redemptions_remaining integer
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
  v_limit integer := 10;
  v_ttl integer := 30;
  v_cap integer := 5;
  v_used integer := 0;
  v_carry integer := 0;
  v_existing public.post_gift_links%ROWTYPE;
  v_new public.post_gift_links%ROWTYPE;
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
    v_cap := v_settings.max_redemptions_per_link;
  END IF;
  IF NOT v_enabled THEN
    RAISE EXCEPTION 'gift_disabled';
  END IF;
  IF NOT public.can_share_full_article() THEN
    IF public.gift_share_eligibility() = 'subscribers' THEN
      RAISE EXCEPTION 'gift_subscription_required';
    END IF;
    RAISE EXCEPTION 'gift_auth_required';
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
  IF NOT EXISTS (
    SELECT 1 FROM public.content_access ca
     WHERE ca.entity_type = 'post'
       AND ca.entity_id = _post_id
       AND ca.mode IN ('members', 'paid')
  ) THEN
    RAISE EXCEPTION 'gift_post_not_gated';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gift:' || v_uid::text));
  SELECT * INTO v_existing
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.post_id = _post_id
     AND l.created_by = v_uid
     AND l.revoked_at IS NULL;
  SELECT count(DISTINCT l.post_id)::integer INTO v_used
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.created_by = v_uid
     AND l.period_month = v_period;
  IF v_existing.id IS NOT NULL
     AND (v_existing.expires_at IS NULL OR v_existing.expires_at > now()) THEN
    RETURN QUERY SELECT
      v_existing.code,
      v_existing.expires_at,
      v_used,
      v_limit,
      CASE WHEN v_limit > 0 THEN GREATEST(v_limit - v_used, 0) ELSE NULL::integer END,
      v_existing.max_redemptions,
      v_existing.redemption_count,
      CASE
        WHEN v_existing.max_redemptions > 0
          THEN GREATEST(v_existing.max_redemptions - v_existing.redemption_count, 0)
        ELSE NULL::integer
      END;
    RETURN;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.post_gift_links SET revoked_at = now() WHERE id = v_existing.id;
  END IF;
  IF v_limit > 0
     AND v_used >= v_limit
     AND NOT EXISTS (
       SELECT 1 FROM public.post_gift_links l
        WHERE l.tenant_id = v_tenant
          AND l.created_by = v_uid
          AND l.post_id = _post_id
          AND l.period_month = v_period
     ) THEN
    RAISE EXCEPTION 'gift_limit_reached';
  END IF;
  SELECT COALESCE(MAX(l.redemption_count), 0) INTO v_carry
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.created_by = v_uid
     AND l.post_id = _post_id
     AND l.period_month = v_period;
  INSERT INTO public.post_gift_links (
    tenant_id, post_id, created_by, expires_at, max_redemptions, redemption_count
  )
  VALUES (
    v_tenant,
    _post_id,
    v_uid,
    CASE WHEN v_ttl > 0 THEN now() + make_interval(days => v_ttl) END,
    GREATEST(COALESCE(v_cap, 5), 0),
    v_carry
  )
  RETURNING * INTO v_new;
  SELECT count(DISTINCT l.post_id)::integer INTO v_used
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.created_by = v_uid
     AND l.period_month = v_period;
  RETURN QUERY SELECT
    v_new.code,
    v_new.expires_at,
    v_used,
    v_limit,
    CASE WHEN v_limit > 0 THEN GREATEST(v_limit - v_used, 0) ELSE NULL::integer END,
    v_new.max_redemptions,
    v_new.redemption_count,
    CASE
      WHEN v_new.max_redemptions > 0
        THEN GREATEST(v_new.max_redemptions - v_new.redemption_count, 0)
      ELSE NULL::integer
    END;
END $$;

REVOKE ALL ON FUNCTION public.create_gift_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_gift_link(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.redeem_gift_link(uuid, text);
-- Wariant TRZYARGUMENTOWY tworzy juz 20260806170000_share_full_article_click_budget.sql,
-- wiec samo zdjecie starej dwuargumentowej nie wystarcza: CREATE FUNCTION (bez
-- OR REPLACE) trafia w istniejaca sygnature i wywala replay bledem 42723.
-- Na bazie, ktora te migracje juz wykonala, DROP IF EXISTS jest bez skutku.
DROP FUNCTION IF EXISTS public.redeem_gift_link(uuid, text, uuid);
CREATE FUNCTION public.redeem_gift_link(
  _post_id uuid,
  _code text,
  _visitor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  valid boolean,
  reason text,
  redemption_count integer,
  max_redemptions integer,
  redemptions_remaining integer,
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
  v_cap integer := 0;
  v_count integer := 0;
  v_key text;
  v_reason text := 'ok';
  v_seen boolean := false;
BEGIN
  SELECT * INTO v_link
    FROM public.post_gift_links l
   WHERE l.code = _code
     AND l.tenant_id = v_tenant
     AND l.post_id = _post_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invalid'::text, 0, 0, 0,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  v_cap := GREATEST(COALESCE(v_link.max_redemptions, 0), 0);
  v_count := COALESCE(v_link.redemption_count, 0);
  IF EXISTS (
    SELECT 1 FROM public.content_access ca
     WHERE ca.entity_type = 'post'
       AND ca.entity_id = _post_id
       AND ca.mode = 'password'
  ) THEN
    RETURN QUERY SELECT false, 'invalid'::text, v_count, v_cap, 0,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'revoked'::text, v_count, v_cap, 0,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at <= now() THEN
    RETURN QUERY SELECT false, 'expired'::text, v_count, v_cap, 0,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  IF v_uid IS NOT DISTINCT FROM v_link.created_by THEN
    v_reason := 'owner';
  ELSIF public.has_content_access('post'::public.access_entity_type, _post_id) THEN
    v_reason := 'entitled';
  ELSE
    v_key := CASE
      WHEN v_uid IS NOT NULL THEN 'u:' || v_uid::text
      WHEN _visitor_id IS NOT NULL THEN 'v:' || _visitor_id::text
      ELSE NULL
    END;
    PERFORM pg_advisory_xact_lock(hashtext('gift:redeem:' || v_link.id::text));
    IF v_key IS NOT NULL THEN
      UPDATE public.post_gift_redemptions r
         SET last_seen_at = now(), hits = r.hits + 1
       WHERE r.link_id = v_link.id
         AND r.recipient_key = v_key;
      v_seen := FOUND;
    END IF;
    IF NOT v_seen THEN
      SELECT l.redemption_count INTO v_count
        FROM public.post_gift_links l
       WHERE l.id = v_link.id
         FOR UPDATE;
      IF v_cap > 0 AND v_count >= v_cap THEN
        INSERT INTO public.gift_events (
          tenant_id, link_id, post_id, event_type, actor_id, code, metadata
        )
        VALUES (
          v_tenant, v_link.id, _post_id, 'exhausted', v_uid, v_link.code,
          jsonb_build_object('cap', v_cap, 'count', v_count)
        );
        RETURN QUERY SELECT false, 'exhausted'::text, v_count, v_cap, 0,
          NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
        RETURN;
      END IF;
      IF v_key IS NOT NULL THEN
        INSERT INTO public.post_gift_redemptions (
          tenant_id, link_id, post_id, recipient_key, recipient_id
        )
        VALUES (v_tenant, v_link.id, _post_id, v_key, v_uid)
        ON CONFLICT (link_id, recipient_key) DO NOTHING;
      END IF;
      UPDATE public.post_gift_links l
         SET redemption_count = l.redemption_count + 1,
             last_redeemed_at = now()
       WHERE l.id = v_link.id
      RETURNING l.redemption_count INTO v_count;
    ELSE
      SELECT l.redemption_count INTO v_count
        FROM public.post_gift_links l
       WHERE l.id = v_link.id;
    END IF;
  END IF;
  RETURN QUERY
    SELECT
      true,
      v_reason,
      v_count,
      v_cap,
      CASE WHEN v_cap > 0 THEN GREATEST(v_cap - v_count, 0) ELSE NULL::integer END,
      p.content_pl,
      p.content_en,
      p.builder_data,
      p.blocks_data
    FROM public.posts p
   WHERE p.id = _post_id
     AND p.tenant_id = v_tenant
     AND p.status = 'published'
     AND p.deleted_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.redeem_gift_link(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_gift_link(uuid, text, uuid) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.list_gift_links_admin(integer, integer, text, uuid);
CREATE FUNCTION public.list_gift_links_admin(
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0,
  _status text DEFAULT 'all',
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
  max_redemptions integer,
  unique_recipients integer,
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
    l.max_redemptions,
    (SELECT count(*)::integer FROM public.post_gift_redemptions r WHERE r.link_id = l.id),
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

DROP FUNCTION IF EXISTS public.get_gift_stats_admin();
CREATE FUNCTION public.get_gift_stats_admin()
RETURNS TABLE (
  active_links integer,
  revoked_links integer,
  expired_links integer,
  exhausted_links integer,
  total_created integer,
  total_redeemed integer,
  created_this_month integer,
  redeemed_this_month integer,
  unique_gifters integer,
  unique_recipients integer
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
    (SELECT count(*)::integer FROM public.post_gift_links l
      WHERE l.tenant_id = v_tenant AND l.max_redemptions > 0
        AND l.redemption_count >= l.max_redemptions),
    (SELECT count(*)::integer FROM public.gift_events e
      WHERE e.tenant_id = v_tenant AND e.event_type = 'created'),
    (SELECT count(*)::integer FROM public.gift_events e
      WHERE e.tenant_id = v_tenant AND e.event_type = 'redeemed'),
    (SELECT count(DISTINCT l.post_id)::integer FROM public.post_gift_links l
      WHERE l.tenant_id = v_tenant AND l.period_month = v_period),
    (SELECT count(*)::integer FROM public.gift_events e
      WHERE e.tenant_id = v_tenant AND e.event_type = 'redeemed'
        AND e.created_at >= v_period),
    (SELECT count(DISTINCT l.created_by)::integer FROM public.post_gift_links l
      WHERE l.tenant_id = v_tenant),
    (SELECT count(DISTINCT r.recipient_key)::integer FROM public.post_gift_redemptions r
      WHERE r.tenant_id = v_tenant);
END $$;

REVOKE ALL ON FUNCTION public.get_gift_stats_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gift_stats_admin() TO authenticated, service_role;

COMMENT ON FUNCTION public.gift_share_eligibility() IS
  'Tryb uprawnienia do udostepniania pelnego artykulu w tenancie hosta: '
  '"registered" (domyslnie) albo "subscribers".';

COMMENT ON FUNCTION public.can_share_full_article() IS
  'true, gdy biezace konto moze wygenerowac link "Udostepnij pelny artykul": '
  'musi nalezec do tenanta przegladanego serwisu (tenant domowy z profilu), a '
  'przy eligibility=subscribers dodatkowo spelniac can_gift_articles(). '
  'Anonim zawsze false.';

COMMENT ON FUNCTION public.gift_article_state(uuid) IS
  'Stan popovera udostepniania: enabled / uprawnienie / limit miesieczny '
  '(liczony po ARTYKULACH) + istniejacy link wraz z budzetem klikniec. '
  'Czysty odczyt - nic nie tworzy i nie konsumuje.';

COMMENT ON FUNCTION public.create_gift_link(uuid) IS
  'Get-or-create linku do pelnego artykulu. Wymaga can_share_full_article() i '
  'tresci ZA PAYWALLEM (mode members/paid). Zamraza budzet klikniec na linku i '
  'przenosi zuzycie przy rotacji. Bledy: gift_auth_required / gift_disabled / '
  'gift_subscription_required / gift_post_not_found / gift_post_not_gated / '
  'gift_limit_reached.';

COMMENT ON FUNCTION public.redeem_gift_link(uuid, text, uuid) IS
  'Odblokowanie artykulu linkiem. Zwraca reason: ok | owner | entitled | '
  'invalid | revoked | expired | exhausted. Slot budzetu zuzywa wylacznie NOWY '
  'odbiorca (dedup po link + tozsamosc: konto albo uuid goscia); darczynca i '
  'czytelnik z wlasnym uprawnieniem nie konsumuja budzetu.';