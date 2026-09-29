-- events-harness: include
-- Canonical replay twin of drizzle/migrations/0108_speaker_institution_logo.sql.
ALTER TABLE public.speaker_profiles ADD COLUMN IF NOT EXISTS card_institution_logo_url text;
ALTER TABLE public.speaker_profiles DROP CONSTRAINT IF EXISTS speaker_profiles_card_institution_logo_shape;
ALTER TABLE public.speaker_profiles ADD CONSTRAINT speaker_profiles_card_institution_logo_shape
  CHECK (card_institution_logo_url IS NULL OR (card_institution_logo_url ~ '^https://\S+$' AND char_length(card_institution_logo_url) <= 2048));
COMMENT ON COLUMN public.speaker_profiles.card_institution_logo_url IS 'Logo instytucji prelegenta pokazywane przy polu Instytucja na karcie.';

CREATE OR REPLACE FUNCTION public._event_speaker_logos(p_tenant uuid, p_event_id uuid, p_public_only boolean)
RETURNS TABLE(speaker_profile_id uuid, logo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT DISTINCT sp.id, sp.card_institution_logo_url
  FROM public.speaker_profiles sp
  WHERE sp.tenant_id = p_tenant
    AND sp.card_institution_logo_url IS NOT NULL
    AND (NOT p_public_only OR sp.is_public)
    AND (
      EXISTS (SELECT 1 FROM public.event_speaker_entries en
               WHERE en.tenant_id = p_tenant AND en.event_id = p_event_id AND en.speaker_profile_id = sp.id)
      OR EXISTS (SELECT 1 FROM public.event_speakers es
               WHERE es.event_id = p_event_id AND es.user_id = sp.user_id)
    );
$$;
REVOKE ALL ON FUNCTION public._event_speaker_logos(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_speaker_logos(uuid, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.event_speaker_logos_public(p_event_id uuid)
RETURNS TABLE(speaker_profile_id uuid, logo_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_tenant uuid := public.public_tenant_id();
BEGIN
  IF v_tenant IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.tenant_id = v_tenant AND e.status = 'published'
  ) THEN RETURN; END IF;
  RETURN QUERY SELECT l.speaker_profile_id, l.logo_url FROM public._event_speaker_logos(v_tenant, p_event_id, true) l;
END;
$$;
REVOKE ALL ON FUNCTION public.event_speaker_logos_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_speaker_logos_public(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_event_speaker_logos(p_event_id uuid)
RETURNS TABLE(speaker_profile_id uuid, logo_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY SELECT l.speaker_profile_id, l.logo_url FROM public._event_speaker_logos(v_tenant, p_event_id, false) l;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_speaker_logos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speaker_logos(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_event_speaker_logo_save(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_profile_id uuid := NULLIF(p_payload->>'speaker_profile_id', '')::uuid;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'event_speakers: speaker_profile_id is required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.speaker_profiles sp
     SET card_institution_logo_url = NULLIF(btrim(p_payload->>'logo_url'), ''), updated_at = now()
   WHERE sp.id = v_profile_id AND sp.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_speakers: speaker profile not found in tenant' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_speaker_logo_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speaker_logo_save(jsonb) TO authenticated, service_role;
