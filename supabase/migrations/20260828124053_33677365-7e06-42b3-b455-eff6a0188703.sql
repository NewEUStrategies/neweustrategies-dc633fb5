CREATE OR REPLACE FUNCTION public.event_my_event_profile_set(p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'slug','')), '');
  v_person_id uuid;
  v_url text := NULLIF(btrim(COALESCE(p_payload->>'social_profile_url','')), '');
  v_photo text := NULLIF(btrim(COALESCE(p_payload->>'photo_url','')), '');
  v_email text := NULLIF(btrim(COALESCE(p_payload->>'email','')), '');
  v_links jsonb := CASE WHEN jsonb_typeof(p_payload->'social_links') = 'object'
                        THEN p_payload->'social_links' ELSE NULL END;
  v_push boolean := COALESCE((p_payload->>'push_account')::boolean, false);
  v_key text;
  v_val text;
  v_clean jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to edit your event profile';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;

  IF v_url IS NOT NULL AND v_url !~* '^https?://' THEN
    RAISE EXCEPTION 'invalid_url: social profile link must start with http(s)';
  END IF;
  IF v_photo IS NOT NULL AND v_photo !~* '^https?://' THEN
    RAISE EXCEPTION 'invalid_url: photo link must start with http(s)';
  END IF;
  IF v_email IS NOT NULL AND v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_email: contact e-mail is malformed';
  END IF;

  IF v_links IS NOT NULL THEN
    FOR v_key, v_val IN SELECT key, value FROM jsonb_each_text(v_links) LOOP
      IF v_key !~ '^(linkedin|x|facebook|instagram|youtube|website)$' THEN
        RAISE EXCEPTION 'invalid_social_key: % is not a supported network', v_key;
      END IF;
      v_val := NULLIF(btrim(COALESCE(v_val, '')), '');
      IF v_val IS NOT NULL THEN
        IF v_val !~* '^https?://' THEN
          RAISE EXCEPTION 'invalid_url: % link must start with http(s)', v_key;
        END IF;
        IF length(v_val) > 400 THEN
          RAISE EXCEPTION 'invalid_url: % link is too long', v_key;
        END IF;
        v_clean := v_clean || jsonb_build_object(v_key, v_val);
      END IF;
    END LOOP;
  END IF;

  SELECT p.id INTO v_person_id
  FROM public.event_people p
  WHERE p.tenant_id = v_tenant AND p.user_id = v_uid
  LIMIT 1;

  IF v_person_id IS NULL THEN
    RAISE EXCEPTION 'not_registered: no event profile for this account';
  END IF;

  UPDATE public.event_people p SET
    first_name = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'first_name','')), ''), p.first_name),
    last_name = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'last_name','')), ''), p.last_name),
    email = CASE WHEN p_payload ? 'email' THEN v_email ELSE p.email END,
    phone = CASE WHEN p_payload ? 'phone' THEN NULLIF(btrim(COALESCE(p_payload->>'phone','')), '') ELSE p.phone END,
    email_visible = CASE WHEN p_payload ? 'email_visible' THEN COALESCE((p_payload->>'email_visible')::boolean, false) ELSE p.email_visible END,
    phone_visible = CASE WHEN p_payload ? 'phone_visible' THEN COALESCE((p_payload->>'phone_visible')::boolean, false) ELSE p.phone_visible END,
    job_title = CASE WHEN p_payload ? 'job_title' THEN NULLIF(btrim(COALESCE(p_payload->>'job_title','')), '') ELSE p.job_title END,
    company_text = CASE WHEN p_payload ? 'company_text' THEN NULLIF(btrim(COALESCE(p_payload->>'company_text','')), '') ELSE p.company_text END,
    industry = CASE WHEN p_payload ? 'industry' THEN NULLIF(btrim(COALESCE(p_payload->>'industry','')), '') ELSE p.industry END,
    specialization = CASE WHEN p_payload ? 'specialization' THEN NULLIF(btrim(COALESCE(p_payload->>'specialization','')), '') ELSE p.specialization END,
    seeking_pl = CASE WHEN p_payload ? 'seeking_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'seeking_pl','')), '') ELSE p.seeking_pl END,
    seeking_en = CASE WHEN p_payload ? 'seeking_en' THEN NULLIF(btrim(COALESCE(p_payload->>'seeking_en','')), '') ELSE p.seeking_en END,
    offering_pl = CASE WHEN p_payload ? 'offering_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'offering_pl','')), '') ELSE p.offering_pl END,
    offering_en = CASE WHEN p_payload ? 'offering_en' THEN NULLIF(btrim(COALESCE(p_payload->>'offering_en','')), '') ELSE p.offering_en END,
    social_profile_url = CASE WHEN p_payload ? 'social_profile_url' THEN v_url ELSE p.social_profile_url END,
    social_links = CASE WHEN v_links IS NOT NULL THEN v_clean ELSE p.social_links END,
    photo_url = CASE WHEN p_payload ? 'photo_url' THEN v_photo ELSE p.photo_url END,
    bio_pl = CASE WHEN p_payload ? 'bio_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_pl','')), '') ELSE p.bio_pl END,
    bio_en = CASE WHEN p_payload ? 'bio_en' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_en','')), '') ELSE p.bio_en END,
    updated_at = now()
  WHERE p.id = v_person_id AND p.tenant_id = v_tenant AND p.user_id = v_uid;

  -- SYNCHRONIZACJA WSTECZ DO KONTA PLATFORMY (opcjonalna, na zadanie wolajacego).
  -- Ruszamy WYLACZNIE wiersz `auth.uid()` i wylacznie klucze przyslane w tym
  -- zapisie; adres logowania (`profiles.email`) zostaje nietkniety, bo nalezy
  -- do warstwy uwierzytelnienia, a nie do wizytowki.
  IF v_push THEN
    UPDATE public.profiles pr SET
      first_name = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'first_name','')), ''), pr.first_name),
      last_name = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'last_name','')), ''), pr.last_name),
      phone = CASE WHEN p_payload ? 'phone' THEN NULLIF(btrim(COALESCE(p_payload->>'phone','')), '') ELSE pr.phone END,
      job_title = CASE WHEN p_payload ? 'job_title' THEN NULLIF(btrim(COALESCE(p_payload->>'job_title','')), '') ELSE pr.job_title END,
      current_company = CASE WHEN p_payload ? 'company_text' THEN NULLIF(btrim(COALESCE(p_payload->>'company_text','')), '') ELSE pr.current_company END,
      specialization = CASE WHEN p_payload ? 'specialization' THEN NULLIF(btrim(COALESCE(p_payload->>'specialization','')), '') ELSE pr.specialization END,
      seeking_pl = CASE WHEN p_payload ? 'seeking_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'seeking_pl','')), '') ELSE pr.seeking_pl END,
      seeking_en = CASE WHEN p_payload ? 'seeking_en' THEN NULLIF(btrim(COALESCE(p_payload->>'seeking_en','')), '') ELSE pr.seeking_en END,
      offering_pl = CASE WHEN p_payload ? 'offering_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'offering_pl','')), '') ELSE pr.offering_pl END,
      offering_en = CASE WHEN p_payload ? 'offering_en' THEN NULLIF(btrim(COALESCE(p_payload->>'offering_en','')), '') ELSE pr.offering_en END,
      bio_pl = CASE WHEN p_payload ? 'bio_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_pl','')), '') ELSE pr.bio_pl END,
      bio_en = CASE WHEN p_payload ? 'bio_en' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_en','')), '') ELSE pr.bio_en END,
      avatar_url = CASE WHEN p_payload ? 'photo_url' AND v_photo IS NOT NULL THEN v_photo ELSE pr.avatar_url END,
      linkedin_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'linkedin','')), '') ELSE pr.linkedin_url END,
      twitter_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'x','')), '') ELSE pr.twitter_url END,
      facebook_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'facebook','')), '') ELSE pr.facebook_url END,
      instagram_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'instagram','')), '') ELSE pr.instagram_url END,
      website_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'website','')), '') ELSE pr.website_url END,
      updated_at = now()
    WHERE pr.id = v_uid AND pr.tenant_id = v_tenant;
  END IF;

  RETURN public.event_my_event_profile(jsonb_build_object('slug', COALESCE(v_slug, '')));
END;
$function$;