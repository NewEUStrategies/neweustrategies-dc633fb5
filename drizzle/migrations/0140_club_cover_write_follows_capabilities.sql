CREATE OR REPLACE FUNCTION public.club_cover_media_path(_url text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT COALESCE(
    substring(btrim(_url) FROM '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/media/([^?#]+)$'),
    substring(btrim(_url) FROM '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?/media/([^?#]+)$')
  );
$$;
REVOKE ALL ON FUNCTION public.club_cover_media_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_cover_media_path(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_can_edit_cover(_club_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_can boolean;
BEGIN
  IF _club_id IS NULL OR _user_id IS NULL OR _user_id IS DISTINCT FROM auth.uid() THEN RETURN FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = _club_id AND c.tenant_id = public.current_tenant_id()) THEN RETURN FALSE; END IF;
  SELECT cap.can_moderate INTO v_can FROM public.club_capabilities(_club_id, NULL::uuid, _user_id) cap;
  RETURN COALESCE(v_can, FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.club_can_edit_cover(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_can_edit_cover(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_is_cover_moderator(_user_id uuid, _object_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_parts text[] := storage.foldername(COALESCE(_object_name, ''));
  v_club  uuid;
BEGIN
  IF _user_id IS NULL THEN RETURN FALSE; END IF;
  IF array_length(v_parts, 1) IS DISTINCT FROM 2
     OR v_parts[1] <> 'club-covers'
     OR v_parts[2] !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN FALSE;
  END IF;
  v_club := v_parts[2]::uuid;
  RETURN public.club_can_edit_cover(v_club, _user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.club_is_cover_moderator(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_is_cover_moderator(uuid, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "club covers moderator select" ON storage.objects;
DROP POLICY IF EXISTS "club covers moderator insert" ON storage.objects;
DROP POLICY IF EXISTS "club covers moderator update" ON storage.objects;
DROP POLICY IF EXISTS "club covers moderator delete" ON storage.objects;
CREATE POLICY "club covers moderator select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND (storage.foldername(name))[1] = 'club-covers' AND public.club_is_cover_moderator(auth.uid(), name));
CREATE POLICY "club covers moderator insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND (storage.foldername(name))[1] = 'club-covers' AND public.club_is_cover_moderator(auth.uid(), name));
CREATE POLICY "club covers moderator update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND (storage.foldername(name))[1] = 'club-covers' AND public.club_is_cover_moderator(auth.uid(), name))
  WITH CHECK (bucket_id = 'media' AND (storage.foldername(name))[1] = 'club-covers' AND public.club_is_cover_moderator(auth.uid(), name));
CREATE POLICY "club covers moderator delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND (storage.foldername(name))[1] = 'club-covers' AND public.club_is_cover_moderator(auth.uid(), name));

CREATE OR REPLACE FUNCTION public.club_set_cover(p_club_id uuid, p_url text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_url    text := NULLIF(btrim(COALESCE(p_url, '')), '');
  v_file   text;
  v_host   text;
  v_domain text;
  v_origin text;
  v_hit    integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.club_can_edit_cover(p_club_id, v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_url IS NOT NULL THEN
    v_file := substring(public.club_cover_media_path(v_url)
                        FROM '^club-covers/' || p_club_id::text || '/([A-Za-z0-9][A-Za-z0-9._-]{0,199})$');
    IF v_file IS NULL OR v_file LIKE '%..%' THEN
      RAISE EXCEPTION 'clubs: invalid cover url' USING ERRCODE = '22023';
    END IF;
    v_host := lower(substring(v_url FROM '^https://([A-Za-z0-9.-]+)(?::[0-9]{1,5})?/media/'));
    SELECT NULLIF(regexp_replace(lower(btrim(COALESCE(t.domain, ''))), '^https?://|/+$', '', 'g'), '')
      INTO v_domain FROM public.tenants t WHERE t.id = v_tenant;
    v_origin := CASE
      WHEN v_host IN ('neweuropeanstrategies.com', 'www.neweuropeanstrategies.com') THEN 'https://' || v_host
      WHEN v_domain IS NOT NULL
           AND v_host IN (v_domain, 'www.' || v_domain, regexp_replace(v_domain, '^www\.', '')) THEN 'https://' || v_host
      ELSE 'https://' || COALESCE(v_domain, 'neweuropeanstrategies.com')
    END;
    v_url := v_origin || '/media/club-covers/' || p_club_id::text || '/' || v_file;
  END IF;
  UPDATE public.clubs c SET cover_image_url = v_url WHERE c.id = p_club_id AND c.tenant_id = v_tenant;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501'; END IF;
  RETURN v_url;
END;
$$;
REVOKE ALL ON FUNCTION public.club_set_cover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_cover(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_set_cover_position(p_club_id uuid, p_position_y smallint)
 RETURNS smallint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid := public.current_tenant_id(); v_val smallint; v_hit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant) THEN RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501'; END IF;
  IF NOT public.club_can_edit_cover(p_club_id, v_uid) THEN RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501'; END IF;
  v_val := GREATEST(0::smallint, LEAST(100::smallint, COALESCE(p_position_y, 50)::smallint));
  UPDATE public.clubs c SET cover_position_y = v_val WHERE c.id = p_club_id AND c.tenant_id = v_tenant;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501'; END IF;
  RETURN v_val;
END;
$function$;

CREATE OR REPLACE FUNCTION public.club_cover_position_reset()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.cover_position_y IS NOT DISTINCT FROM OLD.cover_position_y
     AND COALESCE(public.club_cover_media_path(NEW.cover_image_url), btrim(NEW.cover_image_url))
         IS DISTINCT FROM
         COALESCE(public.club_cover_media_path(OLD.cover_image_url), btrim(OLD.cover_image_url))
  THEN
    NEW.cover_position_y := 50;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.club_cover_position_reset() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_cover_position_reset() TO authenticated, service_role;

DROP TRIGGER IF EXISTS clubs_cover_position_reset_tg ON public.clubs;
CREATE TRIGGER clubs_cover_position_reset_tg
  BEFORE UPDATE OF cover_image_url ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.club_cover_position_reset();

CREATE OR REPLACE FUNCTION public.club_update_settings(p_club_id uuid, p jsonb)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid := public.current_tenant_id(); v_caps record; v_hit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'clubs: sign in required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant) THEN RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
  IF NOT (public.is_club_admin(v_uid) OR v_caps.effective_role = 'lead') THEN RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501'; END IF;
  IF (p ? 'cover_image_url') OR (p ? 'cover_position_y') THEN RAISE EXCEPTION 'clubs: cover is written by club_set_cover' USING ERRCODE = '22023'; END IF;
  IF (p ? 'join_policy') AND COALESCE(p->>'join_policy', '') NOT IN ('open', 'request', 'invite') THEN RAISE EXCEPTION 'clubs: invalid join policy' USING ERRCODE = '22023'; END IF;
  IF (p ? 'who_can_post') AND COALESCE(p->>'who_can_post', '') NOT IN ('members', 'moderators', 'staff_only') THEN RAISE EXCEPTION 'clubs: invalid who_can_post' USING ERRCODE = '22023'; END IF;
  IF (p ? 'layout') AND COALESCE(p->>'layout', '') NOT IN ('list', 'cards', 'magazine') THEN RAISE EXCEPTION 'clubs: invalid layout' USING ERRCODE = '22023'; END IF;
  UPDATE public.clubs c SET
    name_pl = COALESCE(NULLIF(btrim(p->>'name_pl'), ''), c.name_pl),
    name_en = COALESCE(NULLIF(btrim(p->>'name_en'), ''), c.name_en),
    tagline_pl = CASE WHEN p ? 'tagline_pl' THEN NULLIF(btrim(p->>'tagline_pl'), '') ELSE c.tagline_pl END,
    tagline_en = CASE WHEN p ? 'tagline_en' THEN NULLIF(btrim(p->>'tagline_en'), '') ELSE c.tagline_en END,
    description_pl = CASE WHEN p ? 'description_pl' THEN NULLIF(btrim(p->>'description_pl'), '') ELSE c.description_pl END,
    description_en = CASE WHEN p ? 'description_en' THEN NULLIF(btrim(p->>'description_en'), '') ELSE c.description_en END,
    rules_pl = CASE WHEN p ? 'rules_pl' THEN NULLIF(btrim(p->>'rules_pl'), '') ELSE c.rules_pl END,
    rules_en = CASE WHEN p ? 'rules_en' THEN NULLIF(btrim(p->>'rules_en'), '') ELSE c.rules_en END,
    icon = COALESCE(NULLIF(btrim(p->>'icon'), ''), c.icon),
    accent_color = CASE WHEN p ? 'accent_color' THEN NULLIF(btrim(p->>'accent_color'), '') ELSE c.accent_color END,
    policy_area = CASE WHEN p ? 'policy_area' THEN NULLIF(btrim(p->>'policy_area'), '') ELSE c.policy_area END,
    layout = COALESCE(NULLIF(p->>'layout', ''), c.layout),
    who_can_post = COALESCE(NULLIF(p->>'who_can_post', ''), c.who_can_post),
    join_policy = COALESCE(NULLIF(p->>'join_policy', ''), c.join_policy),
    updated_at = now()
  WHERE c.id = p_club_id AND c.tenant_id = v_tenant;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN RETURN false; END IF;
  INSERT INTO public.club_moderation_log (tenant_id, club_id, moderator_id, action, target_type, target_id, reason) VALUES (v_tenant, p_club_id, v_uid, 'club_updated', 'club', p_club_id, left(COALESCE((SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(p) AS k), ''), 500));
  RETURN true;
END;
$function$;

DROP FUNCTION IF EXISTS public.club_is_any_moderator(uuid);