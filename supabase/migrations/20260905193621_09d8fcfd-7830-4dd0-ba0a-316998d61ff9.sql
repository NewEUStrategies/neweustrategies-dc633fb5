-- 1. Pomocniczy slugify dla klubów (bez zależności od modułu wydarzeń).
CREATE OR REPLACE FUNCTION public._club_slugify(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    NULLIF(
      btrim(
        regexp_replace(
          lower(
            translate(
              COALESCE(p_text, ''),
              'ąćęłńóśźżĄĆĘŁŃÓŚŹŻäöüßÄÖÜéèêáàíúůçÇ',
              'acelnoszzACELNOSZZaousAOUeeeaaiuucC'
            )
          ),
          '[^a-z0-9]+', '-', 'g'
        ),
        '-'
      ),
      ''
    ),
    'klub'
  );
$$;

-- 2. Unikalny slug klubu w obrębie tenanta.
CREATE OR REPLACE FUNCTION public._club_unique_slug(_tenant_id uuid, p_base text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_base text := left(public._club_slugify(p_base), 80);
  v_slug text := v_base;
  v_n    integer := 1;
BEGIN
  WHILE EXISTS (
    SELECT 1 FROM public.clubs c WHERE c.tenant_id = _tenant_id AND c.slug = v_slug
  ) LOOP
    v_n := v_n + 1;
    v_slug := left(v_base, 74) || '-' || v_n::text;
  END LOOP;
  RETURN v_slug;
END;
$$;

-- 3. Zgłoszenie klubu przez członka - klub powstaje jako SZKIC do zatwierdzenia.
CREATE OR REPLACE FUNCTION public.club_propose(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_tenant  uuid := public.current_tenant_id();
  v_name_pl text := NULLIF(btrim(p->>'name_pl'), '');
  v_name_en text := NULLIF(btrim(p->>'name_en'), '');
  v_join    text := COALESCE(NULLIF(p->>'join_policy', ''), 'request');
  v_recent  integer;
  v_slug    text;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: sign in required' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: tenant not resolved' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles pr WHERE pr.id = v_uid AND pr.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_name_pl IS NULL OR char_length(v_name_pl) < 2 THEN
    RAISE EXCEPTION 'clubs: name_pl is required' USING ERRCODE = '22023';
  END IF;
  IF v_join NOT IN ('open', 'request', 'invite') THEN
    RAISE EXCEPTION 'clubs: invalid join policy' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_recent
    FROM public.clubs c
   WHERE c.tenant_id = v_tenant
     AND c.created_by = v_uid
     AND c.created_at > now() - interval '24 hours';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'clubs: proposal quota exceeded' USING ERRCODE = '53400';
  END IF;

  v_slug := public._club_unique_slug(v_tenant, v_name_pl);

  INSERT INTO public.clubs (
    tenant_id, slug, name_pl, name_en, tagline_pl, tagline_en,
    description_pl, description_en, policy_area, specialization_slug,
    visibility, join_policy, status, created_by
  ) VALUES (
    v_tenant, v_slug, v_name_pl, COALESCE(v_name_en, v_name_pl),
    NULLIF(btrim(p->>'tagline_pl'), ''),
    NULLIF(btrim(p->>'tagline_en'), ''),
    NULLIF(btrim(p->>'description_pl'), ''),
    NULLIF(btrim(p->>'description_en'), ''),
    NULLIF(btrim(p->>'policy_area'), ''),
    NULLIF(btrim(p->>'specialization_slug'), ''),
    'members', v_join, 'draft', v_uid
  )
  RETURNING id INTO v_id;

  INSERT INTO public.club_groups (
    tenant_id, club_id, slug, name_pl, name_en, sort_order, status, created_by
  ) VALUES (v_tenant, v_id, 'ogolna', 'Ogólna', 'General', 0, 'active', v_uid);

  INSERT INTO public.club_members (
    tenant_id, club_id, user_id, role, status, invite_source, joined_at
  ) VALUES (v_tenant, v_id, v_uid, 'lead', 'active', 'proposal', now())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  ) VALUES (
    v_tenant, v_id, v_uid, 'club_proposed', 'club', v_id,
    left(COALESCE(NULLIF(btrim(p->>'motivation'), ''), v_name_pl), 500)
  );

  RETURN jsonb_build_object('id', v_id, 'slug', v_slug, 'status', 'draft');
END;
$$;

REVOKE ALL ON FUNCTION public.club_propose(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_propose(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.club_propose(jsonb) TO service_role;

-- 4. Moje zgłoszenia klubów wraz ze statusem.
CREATE OR REPLACE FUNCTION public.club_my_proposals()
RETURNS TABLE (
  id uuid,
  slug text,
  name_pl text,
  name_en text,
  status text,
  policy_area text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT c.id, c.slug, c.name_pl, c.name_en, c.status, c.policy_area, c.created_at
    FROM public.clubs c
   WHERE c.tenant_id = public.current_tenant_id()
     AND c.created_by = auth.uid()
     AND auth.uid() IS NOT NULL
   ORDER BY c.created_at DESC
   LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.club_my_proposals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_my_proposals() TO authenticated;
GRANT EXECUTE ON FUNCTION public.club_my_proposals() TO service_role;

-- 5. Edycja danych klubu przez prowadzącego (widoczność i status zostają u administracji).
CREATE OR REPLACE FUNCTION public.club_update_settings(p_club_id uuid, p jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_caps   record;
  v_hit    integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: sign in required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
  IF NOT (public.is_club_admin(v_uid) OR v_caps.effective_role = 'lead') THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF (p ? 'join_policy') AND COALESCE(p->>'join_policy', '') NOT IN ('open', 'request', 'invite') THEN
    RAISE EXCEPTION 'clubs: invalid join policy' USING ERRCODE = '22023';
  END IF;
  IF (p ? 'who_can_post')
     AND COALESCE(p->>'who_can_post', '') NOT IN ('members', 'moderators', 'staff_only') THEN
    RAISE EXCEPTION 'clubs: invalid who_can_post' USING ERRCODE = '22023';
  END IF;
  IF (p ? 'layout') AND COALESCE(p->>'layout', '') NOT IN ('list', 'cards', 'magazine') THEN
    RAISE EXCEPTION 'clubs: invalid layout' USING ERRCODE = '22023';
  END IF;

  UPDATE public.clubs c SET
    name_pl        = COALESCE(NULLIF(btrim(p->>'name_pl'), ''), c.name_pl),
    name_en        = COALESCE(NULLIF(btrim(p->>'name_en'), ''), c.name_en),
    tagline_pl     = CASE WHEN p ? 'tagline_pl'
                          THEN NULLIF(btrim(p->>'tagline_pl'), '') ELSE c.tagline_pl END,
    tagline_en     = CASE WHEN p ? 'tagline_en'
                          THEN NULLIF(btrim(p->>'tagline_en'), '') ELSE c.tagline_en END,
    description_pl = CASE WHEN p ? 'description_pl'
                          THEN NULLIF(btrim(p->>'description_pl'), '') ELSE c.description_pl END,
    description_en = CASE WHEN p ? 'description_en'
                          THEN NULLIF(btrim(p->>'description_en'), '') ELSE c.description_en END,
    rules_pl       = CASE WHEN p ? 'rules_pl'
                          THEN NULLIF(btrim(p->>'rules_pl'), '') ELSE c.rules_pl END,
    rules_en       = CASE WHEN p ? 'rules_en'
                          THEN NULLIF(btrim(p->>'rules_en'), '') ELSE c.rules_en END,
    icon           = COALESCE(NULLIF(btrim(p->>'icon'), ''), c.icon),
    accent_color   = CASE WHEN p ? 'accent_color'
                          THEN NULLIF(btrim(p->>'accent_color'), '') ELSE c.accent_color END,
    cover_image_url = CASE WHEN p ? 'cover_image_url'
                          THEN NULLIF(btrim(p->>'cover_image_url'), '') ELSE c.cover_image_url END,
    policy_area    = CASE WHEN p ? 'policy_area'
                          THEN NULLIF(btrim(p->>'policy_area'), '') ELSE c.policy_area END,
    layout         = COALESCE(NULLIF(p->>'layout', ''), c.layout),
    who_can_post   = COALESCE(NULLIF(p->>'who_can_post', ''), c.who_can_post),
    join_policy    = COALESCE(NULLIF(p->>'join_policy', ''), c.join_policy),
    updated_at     = now()
  WHERE c.id = p_club_id AND c.tenant_id = v_tenant;

  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  ) VALUES (
    v_tenant, p_club_id, v_uid, 'club_updated', 'club', p_club_id,
    left(COALESCE((SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(p) AS k), ''), 500)
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.club_update_settings(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_update_settings(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.club_update_settings(uuid, jsonb) TO service_role;