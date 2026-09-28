-- Networking, lista uczestników i spotkania: tylko zapis bezpłatny albo opłacony.
-- Zatwierdzone zgłoszenie z nieopłaconym (lub zwróconym) biletem nie daje dostępu.
CREATE OR REPLACE FUNCTION public._event_meeting_caller_registration(_tenant uuid, _event_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT r.id
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.tenant_id = _tenant
    AND r.event_id = _event_id
    AND p.user_id = auth.uid()
    AND r.status IN ('approved', 'attended')
    AND COALESCE(r.payment_status, 'not_required') IN ('not_required', 'paid', 'partially_refunded')
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT 1;
$function$;