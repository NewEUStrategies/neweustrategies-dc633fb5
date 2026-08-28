CREATE OR REPLACE FUNCTION public.event_my_agenda(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'slug','')), '');
  v_event uuid;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see your agenda';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_slug: event slug is required';
  END IF;

  SELECT e.id INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug
  LIMIT 1;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('sessions', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.starts_at NULLS LAST, x.title_pl), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      s.id AS session_id,
      s.title_pl,
      s.title_en,
      s.starts_at,
      s.ends_at,
      s.format,
      s.stream_url,
      r.name_pl AS room_name_pl,
      r.name_en AS room_name_en,
      t.id AS track_id,
      t.name_pl AS track_name_pl,
      t.name_en AS track_name_en,
      g.status AS signup_status,
      g.registered_at
    FROM public.event_session_signups g
    JOIN public.event_sessions s
      ON s.id = g.session_id AND s.tenant_id = g.tenant_id
    LEFT JOIN public.event_rooms r
      ON r.id = s.room_id AND r.tenant_id = s.tenant_id
    LEFT JOIN public.event_tracks t
      ON t.id = s.track_id AND t.tenant_id = s.tenant_id
    WHERE g.tenant_id = v_tenant
      AND g.event_id = v_event
      AND g.user_id = v_uid
      AND COALESCE(g.status, 'registered') <> 'cancelled'
  ) x;

  RETURN jsonb_build_object('sessions', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.event_my_agenda(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_my_agenda(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_my_agenda(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.event_my_event_profile(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'slug','')), '');
  v_event uuid;
  v_person record;
  v_reg record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see your event profile';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_slug: event slug is required';
  END IF;

  SELECT e.id INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug
  LIMIT 1;

  SELECT p.* INTO v_person
  FROM public.event_people p
  WHERE p.tenant_id = v_tenant AND p.user_id = v_uid
  LIMIT 1;

  IF v_event IS NOT NULL AND v_person.id IS NOT NULL THEN
    SELECT r.id, r.status, r.payment_status, r.directory_opt_out, r.notify_email, r.notify_sms
      INTO v_reg
    FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant AND r.event_id = v_event AND r.person_id = v_person.id
    ORDER BY r.created_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'profile', CASE WHEN v_person.id IS NULL THEN NULL ELSE jsonb_build_object(
      'person_id', v_person.id,
      'first_name', v_person.first_name,
      'last_name', v_person.last_name,
      'email', v_person.email,
      'phone', v_person.phone,
      'job_title', v_person.job_title,
      'company_text', v_person.company_text,
      'social_profile_url', v_person.social_profile_url,
      'photo_url', v_person.photo_url,
      'bio_pl', v_person.bio_pl,
      'bio_en', v_person.bio_en
    ) END,
    'registration', CASE WHEN v_reg.id IS NULL THEN NULL ELSE jsonb_build_object(
      'registration_id', v_reg.id,
      'status', v_reg.status,
      'payment_status', v_reg.payment_status,
      'directory_opt_out', v_reg.directory_opt_out,
      'notify_email', v_reg.notify_email,
      'notify_sms', v_reg.notify_sms
    ) END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.event_my_event_profile(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_my_event_profile(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_my_event_profile(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.event_my_event_profile_set(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'slug','')), '');
  v_person_id uuid;
  v_url text := NULLIF(btrim(COALESCE(p_payload->>'social_profile_url','')), '');
  v_photo text := NULLIF(btrim(COALESCE(p_payload->>'photo_url','')), '');
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
    phone = CASE WHEN p_payload ? 'phone' THEN NULLIF(btrim(COALESCE(p_payload->>'phone','')), '') ELSE p.phone END,
    job_title = CASE WHEN p_payload ? 'job_title' THEN NULLIF(btrim(COALESCE(p_payload->>'job_title','')), '') ELSE p.job_title END,
    company_text = CASE WHEN p_payload ? 'company_text' THEN NULLIF(btrim(COALESCE(p_payload->>'company_text','')), '') ELSE p.company_text END,
    social_profile_url = CASE WHEN p_payload ? 'social_profile_url' THEN v_url ELSE p.social_profile_url END,
    photo_url = CASE WHEN p_payload ? 'photo_url' THEN v_photo ELSE p.photo_url END,
    bio_pl = CASE WHEN p_payload ? 'bio_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_pl','')), '') ELSE p.bio_pl END,
    bio_en = CASE WHEN p_payload ? 'bio_en' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_en','')), '') ELSE p.bio_en END,
    updated_at = now()
  WHERE p.id = v_person_id AND p.tenant_id = v_tenant AND p.user_id = v_uid;

  RETURN public.event_my_event_profile(jsonb_build_object('slug', COALESCE(v_slug, '')));
END;
$function$;

REVOKE ALL ON FUNCTION public.event_my_event_profile_set(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_my_event_profile_set(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_my_event_profile_set(jsonb) TO service_role;