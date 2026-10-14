ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS consent_partner_sharing_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_partner_withdrawn_at timestamptz;

COMMENT ON COLUMN public.event_registrations.consent_partner_sharing_at IS
  'Stempel zgody na przekazanie danych partnerom TEGO wydarzenia, udzielonej w tym zgloszeniu. NULL = brak zgody. Rozstrzyga _event_partner_consent_at().';
COMMENT ON COLUMN public.event_registrations.consent_partner_withdrawn_at IS
  'Stempel wycofania zgody partnerskiej tego zgloszenia. Osobna kolumna, nie skasowanie stempla nadania - dowod potrzebuje obu dat.';

UPDATE public.event_registrations r
   SET consent_partner_sharing_at = p.consent_partner_sharing_at
  FROM public.event_people p
 WHERE p.tenant_id = r.tenant_id
   AND p.id = r.person_id
   AND r.consent_partner_sharing_at IS NULL
   AND p.consent_partner_sharing_at IS NOT NULL
   AND r.created_at = p.consent_partner_sharing_at;

COMMENT ON COLUMN public.event_people.consent_partner_sharing_at IS
  'HISTORYCZNY stempel pierwszej zgody partnerskiej osoby (dowolne wydarzenie). NIE rozstrzyga o przekazaniu danych - zgoda jest per zgloszenie: event_registrations.consent_partner_sharing_at i _event_partner_consent_at().';

CREATE OR REPLACE FUNCTION public._event_partner_consent_at(
  p_tenant uuid,
  p_event_id uuid,
  p_person_id uuid
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN r.consent_partner_sharing_at IS NOT NULL
     AND (r.consent_partner_withdrawn_at IS NULL
          OR r.consent_partner_withdrawn_at < r.consent_partner_sharing_at)
     AND (p.consent_withdrawn_at IS NULL
          OR p.consent_withdrawn_at < r.consent_partner_sharing_at)
    THEN r.consent_partner_sharing_at
  END
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.tenant_id = r.tenant_id AND p.id = r.person_id
  WHERE r.tenant_id = p_tenant
    AND r.event_id = p_event_id
    AND r.person_id = p_person_id
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT 1
$function$;

COMMENT ON FUNCTION public._event_partner_consent_at(uuid, uuid, uuid) IS
  'Skuteczny stempel zgody partnerskiej osoby na TO wydarzenie albo NULL. Czyta najnowsze zgloszenie osoby na wydarzenie; zgoda liczy sie tylko, gdy jest pozniejsza niz wycofanie w zgloszeniu i globalne wycofanie osoby. Jedyne zrodlo prawdy dla skanu leadu, linku sponsora i eksportu.';

REVOKE ALL ON FUNCTION public._event_partner_consent_at(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._event_partner_consent_at(uuid, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_partner_consent_at(uuid, uuid, uuid) TO service_role;