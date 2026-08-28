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
  v_acc record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required: sign in to see your event profile'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'invalid_tenant: unknown host'; END IF;
  IF v_slug IS NULL THEN RAISE EXCEPTION 'invalid_slug: event slug is required'; END IF;

  SELECT e.id INTO v_event FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug LIMIT 1;

  SELECT p.* INTO v_person FROM public.event_people p
  WHERE p.tenant_id = v_tenant AND p.user_id = v_uid LIMIT 1;

  SELECT pr.* INTO v_acc FROM public.profiles pr
  WHERE pr.id = v_uid AND pr.tenant_id = v_tenant LIMIT 1;

  IF v_event IS NOT NULL AND v_person.id IS NOT NULL THEN
    SELECT r.id, r.status, r.payment_status, r.directory_opt_out, r.notify_email, r.notify_sms
    INTO v_reg FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant AND r.event_id = v_event AND r.person_id = v_person.id
    ORDER BY r.created_at DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'profile', CASE WHEN v_person.id IS NULL THEN NULL ELSE jsonb_build_object(
      'person_id', v_person.id, 'first_name', v_person.first_name, 'last_name', v_person.last_name,
      'email', v_person.email, 'phone', v_person.phone, 'email_visible', v_person.email_visible,
      'phone_visible', v_person.phone_visible, 'job_title', v_person.job_title,
      'company_id', v_person.company_id, 'company_text', v_person.company_text,
      'industry', v_person.industry, 'specialization', v_person.specialization,
      'seeking_pl', v_person.seeking_pl, 'seeking_en', v_person.seeking_en,
      'offering_pl', v_person.offering_pl, 'offering_en', v_person.offering_en,
      'social_profile_url', v_person.social_profile_url,
      'social_links', COALESCE(v_person.social_links, '{}'::jsonb),
      'photo_url', v_person.photo_url, 'bio_pl', v_person.bio_pl, 'bio_en', v_person.bio_en
    ) END,
    'account', CASE WHEN v_acc.id IS NULL THEN NULL ELSE jsonb_build_object(
      'first_name', v_acc.first_name, 'last_name', v_acc.last_name,
      'email', COALESCE(v_acc.contact_email, v_acc.email), 'phone', v_acc.phone,
      'job_title', v_acc.job_title, 'company_id', v_acc.current_company_id,
      'company_text', v_acc.current_company, 'specialization', v_acc.specialization,
      'seeking_pl', v_acc.seeking_pl, 'seeking_en', v_acc.seeking_en,
      'offering_pl', v_acc.offering_pl, 'offering_en', v_acc.offering_en,
      'photo_url', CASE WHEN v_acc.hide_avatar THEN NULL ELSE v_acc.avatar_url END,
      'bio_pl', v_acc.bio_pl, 'bio_en', v_acc.bio_en,
      'social_links', jsonb_strip_nulls(jsonb_build_object(
        'linkedin', v_acc.linkedin_url, 'x', v_acc.twitter_url,
        'facebook', v_acc.facebook_url, 'instagram', v_acc.instagram_url,
        'website', v_acc.website_url
      ))
    ) END,
    'registration', CASE WHEN v_reg.id IS NULL THEN NULL ELSE jsonb_build_object(
      'registration_id', v_reg.id, 'status', v_reg.status, 'payment_status', v_reg.payment_status,
      'directory_opt_out', v_reg.directory_opt_out, 'notify_email', v_reg.notify_email,
      'notify_sms', v_reg.notify_sms
    ) END
  );
END;
$function$;

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
  v_company_id uuid := NULLIF(p_payload->>'company_id', '')::uuid;
  v_url text := NULLIF(btrim(COALESCE(p_payload->>'social_profile_url','')), '');
  v_photo text := NULLIF(btrim(COALESCE(p_payload->>'photo_url','')), '');
  v_email text := NULLIF(btrim(COALESCE(p_payload->>'email','')), '');
  v_links jsonb := CASE WHEN jsonb_typeof(p_payload->'social_links') = 'object' THEN p_payload->'social_links' ELSE NULL END;
  v_push boolean := COALESCE((p_payload->>'push_account')::boolean, false);
  v_key text;
  v_val text;
  v_clean jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required: sign in to edit your event profile'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'invalid_tenant: unknown host'; END IF;
  IF v_slug IS NULL THEN RAISE EXCEPTION 'invalid_slug: event slug is required'; END IF;
  IF v_url IS NOT NULL AND v_url !~* '^https?://' THEN RAISE EXCEPTION 'invalid_url: social profile link must start with http(s)'; END IF;
  IF v_photo IS NOT NULL AND v_photo !~* '^https?://' THEN RAISE EXCEPTION 'invalid_url: photo link must start with http(s)'; END IF;
  IF v_email IS NOT NULL AND v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'invalid_email: contact e-mail is malformed'; END IF;

  IF v_company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.crm_companies c WHERE c.tenant_id = v_tenant AND c.id = v_company_id
  ) THEN RAISE EXCEPTION 'invalid_company: organisation is outside the current tenant'; END IF;

  IF v_links IS NOT NULL THEN
    FOR v_key, v_val IN SELECT key, value FROM jsonb_each_text(v_links) LOOP
      IF v_key !~ '^(linkedin|x|facebook|instagram|youtube|website)$' THEN RAISE EXCEPTION 'invalid_social_key: % is not supported', v_key; END IF;
      v_val := NULLIF(btrim(COALESCE(v_val, '')), '');
      IF v_val IS NOT NULL THEN
        IF v_val !~* '^https?://' OR length(v_val) > 400 THEN RAISE EXCEPTION 'invalid_url: % link is invalid', v_key; END IF;
        v_clean := v_clean || jsonb_build_object(v_key, v_val);
      END IF;
    END LOOP;
  END IF;

  SELECT p.id INTO v_person_id FROM public.event_people p
  WHERE p.tenant_id = v_tenant AND p.user_id = v_uid LIMIT 1;

  IF v_person_id IS NULL AND NOT v_push THEN
    RAISE EXCEPTION 'not_registered: no event profile for this account';
  END IF;

  IF v_person_id IS NOT NULL THEN
    UPDATE public.event_people p SET
      first_name = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'first_name','')), ''), p.first_name),
      last_name = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'last_name','')), ''), p.last_name),
      email = CASE WHEN p_payload ? 'email' THEN v_email ELSE p.email END,
      phone = CASE WHEN p_payload ? 'phone' THEN NULLIF(btrim(COALESCE(p_payload->>'phone','')), '') ELSE p.phone END,
      email_visible = CASE WHEN p_payload ? 'email_visible' THEN COALESCE((p_payload->>'email_visible')::boolean, false) ELSE p.email_visible END,
      phone_visible = CASE WHEN p_payload ? 'phone_visible' THEN COALESCE((p_payload->>'phone_visible')::boolean, false) ELSE p.phone_visible END,
      job_title = CASE WHEN p_payload ? 'job_title' THEN NULLIF(btrim(COALESCE(p_payload->>'job_title','')), '') ELSE p.job_title END,
      company_id = CASE WHEN p_payload ? 'company_id' THEN v_company_id ELSE p.company_id END,
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
  END IF;

  IF v_push THEN
    UPDATE public.profiles pr SET
      first_name = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'first_name','')), ''), pr.first_name),
      last_name = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'last_name','')), ''), pr.last_name),
      phone = CASE WHEN p_payload ? 'phone' THEN NULLIF(btrim(COALESCE(p_payload->>'phone','')), '') ELSE pr.phone END,
      job_title = CASE WHEN p_payload ? 'job_title' THEN NULLIF(btrim(COALESCE(p_payload->>'job_title','')), '') ELSE pr.job_title END,
      current_company_id = CASE WHEN p_payload ? 'company_id' THEN v_company_id ELSE pr.current_company_id END,
      current_company = CASE WHEN p_payload ? 'company_text' THEN NULLIF(btrim(COALESCE(p_payload->>'company_text','')), '') ELSE pr.current_company END,
      specialization = CASE WHEN p_payload ? 'specialization' THEN NULLIF(btrim(COALESCE(p_payload->>'specialization','')), '') ELSE pr.specialization END,
      seeking_pl = CASE WHEN p_payload ? 'seeking_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'seeking_pl','')), '') ELSE pr.seeking_pl END,
      seeking_en = CASE WHEN p_payload ? 'seeking_en' THEN NULLIF(btrim(COALESCE(p_payload->>'seeking_en','')), '') ELSE pr.seeking_en END,
      offering_pl = CASE WHEN p_payload ? 'offering_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'offering_pl','')), '') ELSE pr.offering_pl END,
      offering_en = CASE WHEN p_payload ? 'offering_en' THEN NULLIF(btrim(COALESCE(p_payload->>'offering_en','')), '') ELSE pr.offering_en END,
      bio_pl = CASE WHEN p_payload ? 'bio_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_pl','')), '') ELSE pr.bio_pl END,
      bio_en = CASE WHEN p_payload ? 'bio_en' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_en','')), '') ELSE pr.bio_en END,
      avatar_url = CASE WHEN p_payload ? 'photo_url' THEN v_photo ELSE pr.avatar_url END,
      linkedin_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'linkedin','')), '') ELSE pr.linkedin_url END,
      twitter_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'x','')), '') ELSE pr.twitter_url END,
      facebook_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'facebook','')), '') ELSE pr.facebook_url END,
      instagram_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'instagram','')), '') ELSE pr.instagram_url END,
      website_url = CASE WHEN v_links IS NOT NULL THEN NULLIF(btrim(COALESCE(v_clean->>'website','')), '') ELSE pr.website_url END,
      updated_at = now()
    WHERE pr.id = v_uid AND pr.tenant_id = v_tenant;
  END IF;

  RETURN public.event_my_event_profile(jsonb_build_object('slug', v_slug));
END;
$function$;

CREATE OR REPLACE FUNCTION public.event_attendees(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_q text := NULLIF(btrim(COALESCE(p_payload->>'q', '')), '');
  v_group_id uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit', '')::integer, 24), 1), 100);
  v_offset integer := GREATEST(COALESCE(NULLIF(p_payload->>'offset', '')::integer, 0), 0);
  v_event public.events;
  v_me uuid;
  v_chatham boolean := false;
  v_discoverable boolean := false;
  v_opt_out boolean := false;
  v_blocked text;
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_groups jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required: sign in to see who is attending'; END IF;
  IF v_tenant IS NULL OR (v_slug IS NULL AND v_event_id IS NULL) THEN RAISE EXCEPTION 'invalid_payload: event_slug or event_id is required'; END IF;
  SELECT e.* INTO v_event FROM public.events e WHERE e.tenant_id = v_tenant AND e.status = 'published'
    AND ((v_event_id IS NOT NULL AND e.id = v_event_id) OR (v_event_id IS NULL AND e.slug = v_slug));
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'not_found: event does not exist'; END IF;
  v_chatham := COALESCE(v_event.chatham_house, false);
  v_me := public._event_meeting_caller_registration(v_tenant, v_event.id);
  IF v_me IS NULL THEN v_blocked := 'requester_not_participating'; END IF;
  IF v_me IS NOT NULL THEN
    SELECT r.directory_opt_out, COALESCE(pr.discoverable, false) INTO v_opt_out, v_discoverable
    FROM public.event_registrations r JOIN public.event_people pe ON pe.id=r.person_id AND pe.tenant_id=r.tenant_id
    LEFT JOIN public.profiles pr ON pr.id=pe.user_id AND pr.tenant_id=r.tenant_id
    WHERE r.tenant_id=v_tenant AND r.id=v_me;
  END IF;
  IF v_blocked IS NULL THEN
    WITH listable AS (
      SELECT r.id registration_id, pe.last_name sort_last, pe.first_name sort_first,
        COALESCE(NULLIF(btrim(pr.display_name),''), NULLIF(btrim(concat_ws(' ',pr.first_name,pr.last_name)),''), btrim(concat_ws(' ',pe.first_name,pe.last_name))) name,
        COALESCE(NULLIF(btrim(pe.job_title),''),NULLIF(btrim(pr.job_title),'')) job_title,
        COALESCE(NULLIF(btrim(pe.company_text),''),co.name,NULLIF(btrim(pr.current_company),'')) company,
        pe.user_id, CASE WHEN pr.hide_avatar THEN NULL ELSE COALESCE(pe.photo_url,pr.avatar_url) END avatar_url,
        pr.slug profile_slug, co.logo_url company_logo_url, co.website company_website,
        CASE WHEN pe.email_visible THEN COALESCE(NULLIF(btrim(pe.email),''),NULLIF(btrim(pr.contact_email),'')) END email,
        CASE WHEN pe.phone_visible THEN COALESCE(NULLIF(btrim(pe.phone),''),NULLIF(btrim(pr.phone),'')) END phone,
        COALESCE(NULLIF(btrim(pe.industry),''),NULLIF(btrim(co.branch),'')) industry,
        COALESCE(NULLIF(btrim(pe.specialization),''),NULLIF(btrim(pr.specialization),'')) specialization,
        COALESCE(NULLIF(btrim(pe.seeking_pl),''),NULLIF(btrim(pr.seeking_pl),'')) seeking_pl,
        COALESCE(NULLIF(btrim(pe.seeking_en),''),NULLIF(btrim(pr.seeking_en),'')) seeking_en,
        COALESCE(NULLIF(btrim(pe.offering_pl),''),NULLIF(btrim(pr.offering_pl),'')) offering_pl,
        COALESCE(NULLIF(btrim(pe.offering_en),''),NULLIF(btrim(pr.offering_en),'')) offering_en,
        COALESCE(pe.social_links,'{}'::jsonb) social_links,
        COALESCE(NULLIF(btrim(pe.bio_pl),''),NULLIF(btrim(pr.bio_pl),'')) bio_pl,
        COALESCE(NULLIF(btrim(pe.bio_en),''),NULLIF(btrim(pr.bio_en),'')) bio_en
      FROM public.event_registrations r
      JOIN public.event_people pe ON pe.id=r.person_id AND pe.tenant_id=r.tenant_id
      JOIN public.profiles pr ON pr.id=pe.user_id AND pr.tenant_id=r.tenant_id
      LEFT JOIN public.crm_companies co ON co.tenant_id=pe.tenant_id AND co.id=COALESCE(pe.company_id,pr.current_company_id)
      WHERE r.tenant_id=v_tenant AND r.event_id=v_event.id AND r.status IN ('approved','attended')
        AND r.directory_opt_out=false AND pr.discoverable=true
        AND (v_group_id IS NULL OR EXISTS (SELECT 1 FROM public._event_meeting_groups(v_tenant,v_event.id,r.id) x(group_id) WHERE x.group_id=v_group_id))
        AND (v_q IS NULL OR pe.full_name_norm LIKE '%'||lower(btrim(v_q))||'%' OR lower(COALESCE(NULLIF(btrim(pe.company_text),''),co.name,'')) LIKE '%'||lower(btrim(v_q))||'%')
    ), page AS (
      SELECT * FROM listable WHERE NOT v_chatham ORDER BY sort_last,sort_first,registration_id LIMIT v_limit OFFSET v_offset
    ), per_group AS (
      SELECT mg.group_id,count(*)::integer n FROM listable l CROSS JOIN LATERAL public._event_meeting_groups(v_tenant,v_event.id,l.registration_id) mg(group_id) GROUP BY mg.group_id
    )
    SELECT (SELECT count(*)::integer FROM listable),
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'registration_id',pg.registration_id,'name',pg.name,'job_title',pg.job_title,'company',pg.company,
        'user_id',pg.user_id,'avatar_url',pg.avatar_url,'profile_slug',pg.profile_slug,
        'company_logo_url',pg.company_logo_url,'company_website',pg.company_website,
        'email',pg.email,'phone',pg.phone,'industry',pg.industry,'specialization',pg.specialization,
        'seeking_pl',pg.seeking_pl,'seeking_en',pg.seeking_en,'offering_pl',pg.offering_pl,'offering_en',pg.offering_en,
        'social_links',pg.social_links,'bio_pl',pg.bio_pl,'bio_en',pg.bio_en,
        'groups',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',g.id,'name_pl',g.name_pl,'name_en',g.name_en,'color',g.color) ORDER BY g.sort_order,g.name_pl),'[]'::jsonb)
          FROM public._event_meeting_groups(v_tenant,v_event.id,pg.registration_id) mg(group_id)
          JOIN public.event_groups g ON g.id=mg.group_id AND g.tenant_id=v_tenant)
      ) ORDER BY pg.sort_last,pg.sort_first,pg.registration_id) FROM page pg),'[]'::jsonb),
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name_pl',g.name_pl,'name_en',g.name_en,'color',g.color,'count',COALESCE(pgc.n,0)) ORDER BY g.sort_order,g.name_pl)
        FROM public.event_groups g LEFT JOIN per_group pgc ON pgc.group_id=g.id WHERE g.tenant_id=v_tenant AND g.event_id=v_event.id),'[]'::jsonb)
    INTO v_total,v_rows,v_groups;
    IF v_chatham THEN v_blocked := 'chatham_house'; END IF;
  END IF;
  RETURN jsonb_build_object('blocked',v_blocked,'chatham_house',v_chatham,'my_registration_id',v_me,
    'my_listed',(v_discoverable AND NOT v_opt_out),'my_discoverable',v_discoverable,'my_opt_out',v_opt_out,
    'total_count',v_total,'rows',v_rows,'groups',v_groups);
END;
$function$;

REVOKE ALL ON FUNCTION public.event_my_event_profile(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_event_profile(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.event_my_event_profile_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_event_profile_set(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.event_attendees(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_attendees(jsonb) TO authenticated, service_role;