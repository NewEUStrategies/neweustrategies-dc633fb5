-- Replay of supabase/migrations/20261012200000_author_profiles_public_drop_contact_email.sql
-- (body identical to the repo file; rationale and measured production drift live there).
-- Closes the author contact e-mail leak left by 20260730072101 (never superseded on
-- production because 20260730120000 was not executed) and the 0150 ELSE branch that
-- read ap.contact_email, then records the Supabase version in the ledger like 0149.
-- ---------- 1) event_speaker_detail: bez odczytu ap.contact_email ------------
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
    'email', CASE WHEN pe.email_visible THEN NULLIF(btrim(pe.email), '') ELSE NULL END,
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

COMMENT ON FUNCTION public.event_speaker_detail(uuid, uuid, boolean) IS
  'On-demand event speaker details: public tenant and published event; preview requires same-tenant event admin. Contact follows existing event_people.email_visible/phone_visible; author links come from the author_profiles_public projection, which carries no author contact e-mail (20260730120000). Never raw admin contact.';

-- ---------- 2) author_profiles_public: projekcja bez kanalow kontaktu --------
DROP VIEW IF EXISTS public.author_profiles_public;

CREATE VIEW public.author_profiles_public
WITH (security_invoker = off, security_barrier = true) AS
SELECT
  ap.id,
  ap.user_id,
  ap.tenant_id,
  ap.is_public,
  ap.job_title,
  ap.company,
  ap.avatar_url,
  ap.bio_pl,
  ap.bio_en,
  ap.full_bio_pl,
  ap.full_bio_en,
  ap.linkedin_url,
  ap.x_url,
  ap.facebook_url,
  ap.instagram_url,
  ap.spotify_url,
  ap.website_url,
  ap.custom_socials,
  ap.brand_accent,
  ap.brand_accent_dark,
  ap.layout_template_id,
  ap.layout_preset,
  ap.layout_section_order,
  ap.layout_overrides,
  ap.org_functions,
  ap.counterpart_lang,
  ap.counterpart_user_id,
  ap.media_contact_name,
  ap.created_at,
  ap.updated_at
FROM public.author_profiles ap
WHERE ap.is_public = true
  AND ap.tenant_id = public_tenant_id();

-- ---------- 3) Granty: tylko odczyt dla rol klienckich -----------------------
REVOKE ALL ON public.author_profiles_public FROM anon, authenticated;
GRANT SELECT ON public.author_profiles_public TO anon, authenticated;

COMMENT ON VIEW public.author_profiles_public IS
  'Public author projection (is_public, host tenant). No contact channels: phone, contact_email, media_contact_email and media_contact_phone are readable only by the owner (get_own_author_profile), tenant admins (admin_get_author_profile) and service_role. Read-only for anon/authenticated.';

INSERT INTO supabase_migrations.schema_migrations (version, statements, name, created_by)
SELECT '20261012200000', ARRAY[]::text[], '20261012200000_author_profiles_public_drop_contact_email', 'lovable'
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations sm WHERE sm.version = '20261012200000'
);
