-- ============================================================================
-- FIX (P1): Gift Articles - domyslna konfiguracja umozliwiala obejscie paywalla.
--
--   * Domyslne monthly_limit=0 (bez limitu) i link_ttl_days=0 (bezterminowo)
--     oraz brak capu odslon na link -> jeden subskrybent mogl wygenerowac kod
--     dla kazdego wpisu i opublikowac go (social media), udostepniajac caly
--     katalog premium calemu internetowi, bezterminowo.
--   * Wyscig limitu miesiecznego: advisory lock kluczowany na (user:post) nie
--     serializowal rownoleglych create dla ROZNYCH wpisow tego samego nadawcy.
--
-- Naprawa:
--   1) Bezpieczne domyslne (monthly_limit=10, link_ttl_days=30) + nowy cap
--      max_redemptions_per_link (domyslnie 50; 0 = bez limitu).
--   2) redeem_gift_link egzekwuje cap odslon (darczynca zawsze widzi swoj link).
--   3) create_gift_link: fallback bez wiersza ustawien = bezpieczne domyslne,
--      advisory lock per NADAWCA (atomowy limit miesieczny miedzy wpisami).
-- ============================================================================

-- (1) Nowy cap + bezpieczne domyslne dla NOWYCH tenantow.
ALTER TABLE public.gift_article_settings
  ADD COLUMN IF NOT EXISTS max_redemptions_per_link integer NOT NULL DEFAULT 50
    CHECK (max_redemptions_per_link BETWEEN 0 AND 100000);

ALTER TABLE public.gift_article_settings ALTER COLUMN monthly_limit SET DEFAULT 10;
ALTER TABLE public.gift_article_settings ALTER COLUMN link_ttl_days SET DEFAULT 30;

-- Istniejace wiersze z wartosciami "bez limitu" (0) podnosimy do bezpiecznych
-- domyslnych; tenant moze swiadomie zmienic je w panelu. Nie ruszamy wartosci
-- juz swiadomie ustawionych (>0).
UPDATE public.gift_article_settings SET monthly_limit = 10 WHERE monthly_limit = 0;
UPDATE public.gift_article_settings SET link_ttl_days = 30 WHERE link_ttl_days = 0;

-- (2) redeem_gift_link: egzekwuj cap odslon (poza darczynca).
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
  v_cap integer := 50;
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

  SELECT COALESCE(s.max_redemptions_per_link, 50) INTO v_cap
    FROM public.gift_article_settings s WHERE s.tenant_id = v_tenant;
  v_cap := COALESCE(v_cap, 50);

  -- Cap odslon: gdy limit ustawiony (>0) i wyczerpany, kod przestaje odblokowywac
  -- tresc dla ODBIORCOW; darczynca (tworca linku) zawsze widzi swoj artykul.
  IF v_uid IS DISTINCT FROM v_link.created_by THEN
    IF v_cap > 0 AND v_link.redemption_count >= v_cap THEN
      RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
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

-- (3) create_gift_link: bezpieczny fallback + advisory lock per NADAWCA.
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
  v_limit integer := 10;   -- bezpieczny fallback (bez wiersza ustawien)
  v_ttl integer := 30;     -- bezpieczny fallback (bez wiersza ustawien)
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

  -- Lock per NADAWCA: serializuje rownolegle create dla ROZNYCH wpisow tego
  -- samego darczyncy, czyniac kontrole limitu miesiecznego atomowa (i nadal
  -- gwarantuje jeden zywy link per wpis, bo to ten sam uzytkownik).
  PERFORM pg_advisory_xact_lock(hashtext('gift:' || v_uid::text));

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
