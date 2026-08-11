CREATE OR REPLACE FUNCTION public.admin_club_upsert(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_id     uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_slug   text := NULLIF(btrim(p_payload->>'slug'), '');
  v_exists boolean;
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: tenant not resolved' USING ERRCODE = '42501';
  END IF;

  IF v_id IS NULL THEN
    IF v_slug IS NULL OR NULLIF(btrim(p_payload->>'name_pl'), '') IS NULL THEN
      RAISE EXCEPTION 'clubs: slug and name_pl are required' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.clubs c WHERE c.tenant_id = v_tenant AND c.slug = v_slug
    ) THEN
      RAISE EXCEPTION 'clubs: slug already taken' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.clubs (
      tenant_id, slug, name_pl, name_en,
      tagline_pl, tagline_en, description_pl, description_en,
      icon, accent_color, cover_image_url,
      visibility, join_policy, min_tier_rank, attribution_mode,
      who_can_post, moderation_mode, policy_area, specialization_slug,
      rules_pl, rules_en, status, layout, created_by
    ) VALUES (
      v_tenant, v_slug,
      btrim(p_payload->>'name_pl'),
      COALESCE(NULLIF(btrim(p_payload->>'name_en'), ''), btrim(p_payload->>'name_pl')),
      NULLIF(btrim(p_payload->>'tagline_pl'), ''),
      NULLIF(btrim(p_payload->>'tagline_en'), ''),
      NULLIF(btrim(p_payload->>'description_pl'), ''),
      NULLIF(btrim(p_payload->>'description_en'), ''),
      COALESCE(NULLIF(btrim(p_payload->>'icon'), ''), 'MessagesSquare'),
      NULLIF(btrim(p_payload->>'accent_color'), ''),
      NULLIF(btrim(p_payload->>'cover_image_url'), ''),
      COALESCE(NULLIF(p_payload->>'visibility', ''), 'members'),
      COALESCE(NULLIF(p_payload->>'join_policy', ''), 'request'),
      COALESCE((p_payload->>'min_tier_rank')::integer, 0),
      COALESCE(NULLIF(p_payload->>'attribution_mode', ''), 'attributed'),
      COALESCE(NULLIF(p_payload->>'who_can_post', ''), 'moderators'),
      COALESCE(NULLIF(p_payload->>'moderation_mode', ''), 'trusted'),
      NULLIF(btrim(p_payload->>'policy_area'), ''),
      NULLIF(btrim(p_payload->>'specialization_slug'), ''),
      NULLIF(btrim(p_payload->>'rules_pl'), ''),
      NULLIF(btrim(p_payload->>'rules_en'), ''),
      COALESCE(NULLIF(p_payload->>'status', ''), 'draft'),
      COALESCE(NULLIF(p_payload->>'layout', ''), 'list'),
      v_uid
    )
    RETURNING id INTO v_id;

    INSERT INTO public.club_groups (
      tenant_id, club_id, slug, name_pl, name_en, sort_order, status, created_by
    ) VALUES (
      v_tenant, v_id, 'ogolna', 'Ogólna', 'General', 0, 'active', v_uid
    );

  ELSE
    SELECT true INTO v_exists FROM public.clubs
     WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT COALESCE(v_exists, false) THEN
      RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
    END IF;
    IF v_slug IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.clubs c
       WHERE c.tenant_id = v_tenant AND c.slug = v_slug AND c.id <> v_id
    ) THEN
      RAISE EXCEPTION 'clubs: slug already taken' USING ERRCODE = '23505';
    END IF;

    UPDATE public.clubs c SET
      slug            = COALESCE(v_slug, c.slug),
      name_pl         = COALESCE(NULLIF(btrim(p_payload->>'name_pl'), ''), c.name_pl),
      name_en         = COALESCE(NULLIF(btrim(p_payload->>'name_en'), ''), c.name_en),
      tagline_pl      = CASE WHEN p_payload ? 'tagline_pl'
                             THEN NULLIF(btrim(p_payload->>'tagline_pl'), '') ELSE c.tagline_pl END,
      tagline_en      = CASE WHEN p_payload ? 'tagline_en'
                             THEN NULLIF(btrim(p_payload->>'tagline_en'), '') ELSE c.tagline_en END,
      description_pl  = CASE WHEN p_payload ? 'description_pl'
                             THEN NULLIF(btrim(p_payload->>'description_pl'), '') ELSE c.description_pl END,
      description_en  = CASE WHEN p_payload ? 'description_en'
                             THEN NULLIF(btrim(p_payload->>'description_en'), '') ELSE c.description_en END,
      icon            = COALESCE(NULLIF(btrim(p_payload->>'icon'), ''), c.icon),
      accent_color    = CASE WHEN p_payload ? 'accent_color'
                             THEN NULLIF(btrim(p_payload->>'accent_color'), '') ELSE c.accent_color END,
      cover_image_url = CASE WHEN p_payload ? 'cover_image_url'
                             THEN NULLIF(btrim(p_payload->>'cover_image_url'), '') ELSE c.cover_image_url END,
      visibility      = COALESCE(NULLIF(p_payload->>'visibility', ''), c.visibility),
      join_policy     = COALESCE(NULLIF(p_payload->>'join_policy', ''), c.join_policy),
      min_tier_rank   = COALESCE((p_payload->>'min_tier_rank')::integer, c.min_tier_rank),
      attribution_mode = COALESCE(NULLIF(p_payload->>'attribution_mode', ''), c.attribution_mode),
      who_can_post    = COALESCE(NULLIF(p_payload->>'who_can_post', ''), c.who_can_post),
      moderation_mode = COALESCE(NULLIF(p_payload->>'moderation_mode', ''), c.moderation_mode),
      policy_area     = CASE WHEN p_payload ? 'policy_area'
                             THEN NULLIF(btrim(p_payload->>'policy_area'), '') ELSE c.policy_area END,
      specialization_slug = CASE WHEN p_payload ? 'specialization_slug'
                             THEN NULLIF(btrim(p_payload->>'specialization_slug'), '') ELSE c.specialization_slug END,
      rules_pl        = CASE WHEN p_payload ? 'rules_pl'
                             THEN NULLIF(btrim(p_payload->>'rules_pl'), '') ELSE c.rules_pl END,
      rules_en        = CASE WHEN p_payload ? 'rules_en'
                             THEN NULLIF(btrim(p_payload->>'rules_en'), '') ELSE c.rules_en END,
      status          = COALESCE(NULLIF(p_payload->>'status', ''), c.status),
      layout          = COALESCE(NULLIF(p_payload->>'layout', ''), c.layout)
    WHERE c.id = v_id;
  END IF;

  RETURN v_id;
END;
$function$;