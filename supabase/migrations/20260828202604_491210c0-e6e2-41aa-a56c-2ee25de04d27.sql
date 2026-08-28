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
      'notify_sms', v_reg.notify_sms,
      'groups', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name_pl', g.name_pl,
                                            'name_en', g.name_en, 'color', g.color)
               ORDER BY g.sort_order, g.name_pl)
        FROM public._event_meeting_groups(v_tenant, v_event, v_reg.id) mg(group_id)
        JOIN public.event_groups g ON g.id = mg.group_id AND g.tenant_id = v_tenant
      ), '[]'::jsonb)
    ) END
  );
END;
$function$;