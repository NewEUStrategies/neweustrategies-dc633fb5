CREATE OR REPLACE FUNCTION public._event_meeting_sponsor_allowed(
  p_tenant uuid,
  p_event_id uuid,
  p_sponsor_id uuid,
  p_requester_registration_id uuid,
  p_invitee_registration_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.event_sponsors s
      JOIN public.event_sponsor_contacts k
        ON k.tenant_id = s.tenant_id
       AND k.event_id = s.event_id
       AND k.sponsor_id = s.id
      JOIN public.crm_leads l
        ON l.tenant_id = k.tenant_id
       AND l.id = k.lead_id
      JOIN public.event_registrations r
        ON r.tenant_id = s.tenant_id
       AND r.event_id = s.event_id
       AND r.id IN (p_requester_registration_id, p_invitee_registration_id)
      JOIN public.event_people p
        ON p.tenant_id = r.tenant_id
       AND p.id = r.person_id
      JOIN auth.users u
        ON u.id = p.user_id
     WHERE s.tenant_id = p_tenant
       AND s.event_id = p_event_id
       AND s.id = p_sponsor_id
       AND u.email_confirmed_at IS NOT NULL
       AND l.email_norm = lower(btrim(u.email))
  );
$function$;

REVOKE ALL ON FUNCTION public._event_meeting_sponsor_allowed(uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_sponsor_allowed(uuid, uuid, uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public._event_meeting_sponsor_allowed(uuid, uuid, uuid, uuid, uuid) IS
  'Czy spotkanie dwoch zgloszen wolno przypiac do sponsora TEGO wydarzenia: ktorakolwiek strona ma konto z POTWIERDZONYM adresem (auth.users.email_confirmed_at) rownym adresowi osoby kontaktowej, ktora organizator przypial do tego sponsora (event_sponsor_contacts -> crm_leads.email_norm). Firma osoby, event_people.email i most CRM NIE sa dowodem - uczestnik ustawia je sam (F6, 20261013112300). Wola event_meeting_invite; organizator (admin_event_meeting_arrange) jest zaufany. Pomocnik wewnetrzny.';