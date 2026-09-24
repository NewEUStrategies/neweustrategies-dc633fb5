CREATE OR REPLACE FUNCTION public.admin_event_speaker_remove(p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant     uuid := public.assert_event_admin_tenant();
  v_event_id   uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_profile_id uuid := NULLIF(p_payload->>'speaker_profile_id', '')::uuid;
  v_user_id    uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_removed    integer := 0;
  v_legacy     integer := 0;
  v_sessions   integer := 0;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'event_speakers: event_id is required' USING ERRCODE = '22023';
  END IF;
  IF v_profile_id IS NULL AND v_user_id IS NULL THEN
    RAISE EXCEPTION 'event_speakers: speaker_profile_id or user_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'event_speakers: event not found in tenant' USING ERRCODE = '42501';
  END IF;

  -- Removing a speaker from the event also removes them from its sessions,
  -- so tracks derived from session casting disappear with them.
  WITH gone_sessions AS (
    DELETE FROM public.event_session_speakers ss
     WHERE ss.tenant_id = v_tenant
       AND ss.event_id = v_event_id
       AND (
         ss.speaker_profile_id = v_profile_id
         OR (
           v_user_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM public.speaker_profiles sp
              WHERE sp.id = ss.speaker_profile_id
                AND sp.tenant_id = v_tenant
                AND sp.user_id = v_user_id
           )
         )
       )
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_sessions FROM gone_sessions;

  WITH gone AS (
    DELETE FROM public.event_speaker_entries en
     WHERE en.tenant_id = v_tenant
       AND en.event_id = v_event_id
       AND (
         en.speaker_profile_id = v_profile_id
         OR (
           v_user_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM public.speaker_profiles sp
              WHERE sp.id = en.speaker_profile_id
                AND sp.tenant_id = v_tenant
                AND sp.user_id = v_user_id
           )
         )
       )
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_removed FROM gone;

  IF v_user_id IS NOT NULL THEN
    WITH gone_legacy AS (
      DELETE FROM public.event_speakers es
       WHERE es.event_id = v_event_id AND es.user_id = v_user_id
      RETURNING 1
    )
    SELECT count(*)::integer INTO v_legacy FROM gone_legacy;
  END IF;

  RETURN (v_removed + v_legacy + v_sessions) > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_event_speaker_remove(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speaker_remove(jsonb) TO authenticated, service_role;