CREATE OR REPLACE FUNCTION public.event_speaker_detail(p_event_id uuid, p_speaker_profile_id uuid, p_preview boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_tenant uuid; v_result jsonb;
BEGIN
  IF p_preview THEN
    v_tenant := public.assert_event_admin_tenant();
  ELSE
    v_tenant := public.public_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'bio_pl', COALESCE(NULLIF(btrim(sp.bio_pl), ''), NULLIF(btrim(pe.bio_pl), ''), ap.bio_pl),
    'bio_en', COALESCE(NULLIF(btrim(sp.bio_en), ''), NULLIF(btrim(pe.bio_en), ''), ap.bio_en),
    'social_links', jsonb_strip_nulls(COALESCE(pe.social_links, '{}'::jsonb) || jsonb_build_object(
      'linkedin', COALESCE(NULLIF(ap.linkedin_url, ''), pe.social_links->>'linkedin'),
      'x', COALESCE(NULLIF(ap.x_url, ''), pe.social_links->>'x'),
      'facebook', COALESCE(NULLIF(ap.facebook_url, ''), pe.social_links->>'facebook'),
      'instagram', COALESCE(NULLIF(ap.instagram_url, ''), pe.social_links->>'instagram'),
      'website', COALESCE(NULLIF(ap.website_url, ''), pe.social_links->>'website', NULLIF(pe.social_profile_url, ''))
    )),
    'email', CASE WHEN pe.email_visible THEN NULLIF(btrim(pe.email), '') ELSE ap.contact_email END,
    'phone', CASE WHEN pe.phone_visible THEN NULLIF(btrim(pe.phone), '') ELSE NULL END
  ) INTO v_result
  FROM public.speaker_profiles sp
  JOIN public.events e ON e.id = p_event_id AND e.tenant_id = sp.tenant_id
  LEFT JOIN public.event_people pe ON pe.id = sp.person_id AND pe.tenant_id = sp.tenant_id
  LEFT JOIN public.author_profiles_public ap ON ap.user_id = sp.user_id AND ap.tenant_id = sp.tenant_id
  WHERE sp.id = p_speaker_profile_id AND sp.tenant_id = v_tenant AND sp.is_public
    AND (p_preview OR e.status = 'published')
    AND (EXISTS (SELECT 1 FROM public.event_speaker_entries en WHERE en.event_id = e.id AND en.tenant_id = v_tenant AND en.speaker_profile_id = sp.id)
      OR EXISTS (SELECT 1 FROM public.event_speakers es WHERE es.event_id = e.id AND es.user_id = sp.user_id));
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.event_speaker_detail(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_speaker_detail(uuid, uuid, boolean) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.event_speaker_detail(uuid, uuid, boolean) IS 'On-demand event speaker details: public tenant and published event; preview requires same-tenant event admin. Contact follows existing email_visible/phone_visible and author_profiles_public projection, never raw admin contact.';