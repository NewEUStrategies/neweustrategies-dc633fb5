
ALTER TABLE public.event_sponsor_tiers
  ADD COLUMN IF NOT EXISTS layout text NOT NULL DEFAULT 'grid'
  CHECK (layout IN ('banner','grid'));

ALTER TABLE public.event_sponsors
  ADD COLUMN IF NOT EXISTS link_mode text NOT NULL DEFAULT 'exhibitor'
    CHECK (link_mode IN ('exhibitor','external','none')),
  ADD COLUMN IF NOT EXISTS link_url text
    CHECK (link_url IS NULL OR link_url ~* '^https://[^\s]{3,2000}$');

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_tier_set_layout(_id uuid, _layout text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF _layout NOT IN ('banner','grid') THEN RAISE EXCEPTION 'invalid_layout'; END IF;
  IF _layout = 'banner' AND (SELECT count(*) FROM public.event_sponsors s WHERE s.tier_id = _id) > 1 THEN
    RAISE EXCEPTION 'banner_single_image';
  END IF;
  UPDATE public.event_sponsor_tiers SET layout = _layout, updated_at = now()
   WHERE id = _id AND tenant_id = v_tenant;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_set_link(_id uuid, _mode text, _url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF _mode NOT IN ('exhibitor','external','none') THEN RAISE EXCEPTION 'invalid_link_mode'; END IF;
  IF _mode = 'external' AND (_url IS NULL OR _url !~* '^https://[^\s]{3,2000}$') THEN
    RAISE EXCEPTION 'invalid_link_url';
  END IF;
  UPDATE public.event_sponsors
     SET link_mode = _mode,
         link_url = CASE WHEN _mode = 'external' THEN _url ELSE NULL END,
         updated_at = now()
   WHERE id = _id AND tenant_id = v_tenant;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_links(p_event_id uuid)
RETURNS TABLE(id uuid, link_mode text, link_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY SELECT s.id, s.link_mode, s.link_url FROM public.event_sponsors s
   WHERE s.event_id = p_event_id AND s.tenant_id = v_tenant;
END $$;

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_tier_layouts(p_event_id uuid)
RETURNS TABLE(id uuid, layout text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY SELECT t.id, t.layout FROM public.event_sponsor_tiers t
   WHERE t.event_id = p_event_id AND t.tenant_id = v_tenant;
END $$;

CREATE TABLE public.event_home_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  image_url text NOT NULL CHECK (image_url ~* '^https://'),
  image_mobile_url text CHECK (image_mobile_url IS NULL OR image_mobile_url ~* '^https://'),
  link_url text CHECK (link_url IS NULL OR link_url ~* '^https://[^\s]{3,2000}$'),
  alt_text text NOT NULL DEFAULT '' CHECK (length(alt_text) <= 300),
  group_ids uuid[] NOT NULL DEFAULT '{}',
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX event_home_ads_event_idx ON public.event_home_ads(event_id, is_active);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_home_ads TO authenticated;
GRANT ALL ON public.event_home_ads TO service_role;
ALTER TABLE public.event_home_ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_home_ads admin tenant" ON public.event_home_ads FOR ALL TO authenticated
  USING (tenant_id = public._caller_tenant() AND (public.has_role(auth.uid(),'admin') OR public.is_super_admin(auth.uid())))
  WITH CHECK (tenant_id = public._caller_tenant() AND (public.has_role(auth.uid(),'admin') OR public.is_super_admin(auth.uid())));

CREATE TABLE public.event_home_ad_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  ad_id uuid NOT NULL REFERENCES public.event_home_ads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('view','click')),
  session_hash text NOT NULL CHECK (length(session_hash) BETWEEN 8 AND 128),
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_id, kind, session_hash, day)
);
GRANT SELECT ON public.event_home_ad_events TO authenticated;
GRANT ALL ON public.event_home_ad_events TO service_role;
ALTER TABLE public.event_home_ad_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_home_ad_events admin read" ON public.event_home_ad_events FOR SELECT TO authenticated
  USING (tenant_id = public._caller_tenant() AND (public.has_role(auth.uid(),'admin') OR public.is_super_admin(auth.uid())));

CREATE OR REPLACE FUNCTION public.admin_event_home_ads_list(p_event_id uuid)
RETURNS TABLE(id uuid, image_url text, image_mobile_url text, link_url text, alt_text text,
  group_ids uuid[], starts_at timestamptz, ends_at timestamptz, is_active boolean, sort_order integer,
  views bigint, clicks bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT a.id, a.image_url, a.image_mobile_url, a.link_url, a.alt_text, a.group_ids, a.starts_at, a.ends_at,
         a.is_active, a.sort_order,
         (SELECT count(*) FROM public.event_home_ad_events e WHERE e.ad_id = a.id AND e.kind = 'view'),
         (SELECT count(*) FROM public.event_home_ad_events e WHERE e.ad_id = a.id AND e.kind = 'click')
    FROM public.event_home_ads a
   WHERE a.event_id = p_event_id AND a.tenant_id = v_tenant
   ORDER BY a.sort_order, a.created_at;
END $$;

CREATE OR REPLACE FUNCTION public.admin_event_home_ad_save(p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := nullif(p_payload->>'id','')::uuid;
  v_event uuid := nullif(p_payload->>'event_id','')::uuid;
  v_groups uuid[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'group_ids','[]'::jsonb))::uuid), '{}');
BEGIN
  IF v_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_event AND e.tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'event_not_found';
    END IF;
  ELSE
    SELECT a.event_id INTO v_event FROM public.event_home_ads a WHERE a.id = v_id AND a.tenant_id = v_tenant;
    IF v_event IS NULL THEN RAISE EXCEPTION 'ad_not_found'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_groups) g WHERE NOT EXISTS
      (SELECT 1 FROM public.event_groups eg WHERE eg.id = g AND eg.event_id = v_event AND eg.tenant_id = v_tenant)) THEN
    RAISE EXCEPTION 'invalid_group';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.event_home_ads(tenant_id, event_id, image_url, image_mobile_url, link_url, alt_text,
      group_ids, starts_at, ends_at, is_active, sort_order, created_by)
    VALUES (v_tenant, v_event, p_payload->>'image_url', nullif(p_payload->>'image_mobile_url',''),
      nullif(p_payload->>'link_url',''), COALESCE(p_payload->>'alt_text',''), v_groups,
      nullif(p_payload->>'starts_at','')::timestamptz, nullif(p_payload->>'ends_at','')::timestamptz,
      COALESCE((p_payload->>'is_active')::boolean, true), COALESCE((p_payload->>'sort_order')::int, 0), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_home_ads SET
      image_url = p_payload->>'image_url',
      image_mobile_url = nullif(p_payload->>'image_mobile_url',''),
      link_url = nullif(p_payload->>'link_url',''),
      alt_text = COALESCE(p_payload->>'alt_text',''),
      group_ids = v_groups,
      starts_at = nullif(p_payload->>'starts_at','')::timestamptz,
      ends_at = nullif(p_payload->>'ends_at','')::timestamptz,
      is_active = COALESCE((p_payload->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_event_home_ad_delete(_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  DELETE FROM public.event_home_ads WHERE id = _id AND tenant_id = v_tenant;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.event_home_ads_for_viewer(p_slug text)
RETURNS TABLE(id uuid, image_url text, image_mobile_url text, link_url text, alt_text text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.image_url, a.image_mobile_url, a.link_url, a.alt_text
    FROM public.events ev
    JOIN public.event_home_ads a ON a.event_id = ev.id AND a.tenant_id = ev.tenant_id
   WHERE ev.slug = p_slug AND ev.status = 'published'
     AND ev.tenant_id = public.current_tenant_id()
     AND a.is_active
     AND (a.starts_at IS NULL OR a.starts_at <= now())
     AND (a.ends_at IS NULL OR a.ends_at > now())
     AND (cardinality(a.group_ids) = 0 OR EXISTS (
       SELECT 1 FROM public.event_group_members m
         JOIN public.event_people p ON p.id = m.person_id
        WHERE m.event_id = ev.id AND m.group_id = ANY(a.group_ids)
          AND auth.uid() IS NOT NULL AND p.user_id = auth.uid()))
   ORDER BY random()
   LIMIT 5;
$$;
GRANT EXECUTE ON FUNCTION public.event_home_ads_for_viewer(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.event_home_ad_track(p_ad_id uuid, p_kind text, p_session text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid;
BEGIN
  IF p_kind NOT IN ('view','click') OR p_session IS NULL OR length(p_session) NOT BETWEEN 8 AND 128 THEN
    RETURN false;
  END IF;
  SELECT a.tenant_id INTO v_tenant FROM public.event_home_ads a
   WHERE a.id = p_ad_id AND a.is_active AND a.tenant_id = public.current_tenant_id();
  IF v_tenant IS NULL THEN RETURN false; END IF;
  INSERT INTO public.event_home_ad_events(tenant_id, ad_id, kind, session_hash)
  VALUES (v_tenant, p_ad_id, p_kind, md5(p_session))
  ON CONFLICT DO NOTHING;
  RETURN FOUND;
END $$;
GRANT EXECUTE ON FUNCTION public.event_home_ad_track(uuid, text, text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_event_home_ads_list(uuid), public.admin_event_home_ad_save(jsonb),
  public.admin_event_home_ad_delete(uuid), public.admin_event_sponsor_set_link(uuid,text,text),
  public.admin_event_sponsor_tier_set_layout(uuid,text), public.admin_event_sponsor_links(uuid),
  public.admin_event_sponsor_tier_layouts(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_event_home_ads_list(uuid), public.admin_event_home_ad_save(jsonb),
  public.admin_event_home_ad_delete(uuid), public.admin_event_sponsor_set_link(uuid,text,text),
  public.admin_event_sponsor_tier_set_layout(uuid,text), public.admin_event_sponsor_links(uuid),
  public.admin_event_sponsor_tier_layouts(uuid) TO authenticated;
