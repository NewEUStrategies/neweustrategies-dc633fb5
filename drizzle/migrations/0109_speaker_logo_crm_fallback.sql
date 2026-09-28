CREATE OR REPLACE FUNCTION public._event_speaker_logos(p_tenant uuid, p_event_id uuid, p_public_only boolean)
 RETURNS TABLE(speaker_profile_id uuid, logo_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Logo z karty prelegenta ma pierwszenstwo; w przeciwnym razie logo firmy z CRM
  -- (event_people.company_id -> crm_companies.logo_url), zeby CRM byl jednym zrodlem.
  SELECT DISTINCT sp.id,
         COALESCE(sp.card_institution_logo_url, c.logo_url)
  FROM public.speaker_profiles sp
  LEFT JOIN public.event_people ep
         ON ep.id = sp.person_id AND ep.tenant_id = p_tenant
  LEFT JOIN public.crm_companies c
         ON c.id = ep.company_id AND c.tenant_id = p_tenant
        AND c.logo_url ~ '^https://\S+$'
  WHERE sp.tenant_id = p_tenant
    AND COALESCE(sp.card_institution_logo_url, c.logo_url) IS NOT NULL
    AND (NOT p_public_only OR sp.is_public)
    AND (
      EXISTS (SELECT 1 FROM public.event_speaker_entries en
               WHERE en.tenant_id = p_tenant AND en.event_id = p_event_id AND en.speaker_profile_id = sp.id)
      OR EXISTS (SELECT 1 FROM public.event_speakers es
               WHERE es.event_id = p_event_id AND es.user_id = sp.user_id)
    );
$function$;