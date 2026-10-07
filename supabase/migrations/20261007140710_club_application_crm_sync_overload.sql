-- ============================================================================
-- CRM ZGLOSZEN DO KLUBU: WYWOLANIE, KTORE PADALO PRZY KAZDYM ZGLOSZENIU.
--
-- ZRODLO: `plpgsql_check` na katalogu po wszystkich migracjach (audyt
-- platformy, klasa „SQL nigdy niewykonany"). `club_application_crm_sync(uuid)`
-- przekazywala 10 argumentow do `crm_upsert_from_form`, ktora ma przeciazenie
-- 10- i 11-argumentowe (to drugie z `_custom DEFAULT '{}'`), wiec kazde
-- wywolanie konczylo sie 42725 „function ... is not unique". `club_apply_submit`
-- lapie wyjatek, wiec formularz dzialal, ale KAZDE zgloszenie do klubu konczylo
-- z crm_sync_status = blad i bez leada w CRM.
--
-- ZMIANA: cialo z katalogu (pg_get_functiondef) z jawnym `_custom = '{}'` -
-- wybiera przeciazenie 11-argumentowe, to samo, ktore woluje formularz
-- newslettera z TS. Sygnatura, typ wyniku i ACL bez zmian.
--
-- IDEMPOTENTNA: CREATE OR REPLACE.
-- DOWOD: supabase/tests/sql_runtime_errors_test.sql (wywolanie)
-- i supabase/tests/plpgsql_check_gate_test.sql (bramka katalogowa).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.club_application_crm_sync(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  a public.club_applications%ROWTYPE;
  v_lead uuid;
BEGIN
  SELECT * INTO a FROM public.club_applications WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_lead := public.crm_upsert_from_form(
    a.tenant_id, lower(btrim(COALESCE(a.email, ''))),
    NULLIF(btrim(COALESCE(a.first_name, '')), ''),
    NULLIF(btrim(COALESCE(a.last_name, '')), ''),
    NULLIF(btrim(COALESCE(a.phone, '')), ''),
    NULLIF(btrim(COALESCE(a.company, '')), ''),
    NULLIF(btrim(COALESCE(a.job_position, '')), ''),
    NULLIF(btrim(COALESCE(a.linkedin_url, '')), ''),
    NULLIF(btrim(COALESCE(a.country, '')), ''),
    'club_application',
    '{}'::jsonb
  );

  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'crm_email_required';
  END IF;

  UPDATE public.crm_leads l
     SET source_type = 'club_application',
         marketing_consent = l.marketing_consent OR COALESCE(a.marketing_consent, false),
         club_applied_at = COALESCE(l.club_applied_at, COALESCE(a.created_at, now())),
         club_application_count = COALESCE(l.club_application_count, 0) + 1,
         club_specializations = (
           SELECT ARRAY(
             SELECT DISTINCT s
               FROM unnest(l.club_specializations || ARRAY[a.specialization_slug]) AS s
           )
         ),
         last_activity_at = now(),
         updated_at = now()
   WHERE l.id = v_lead;

  UPDATE public.club_applications
     SET crm_lead_id = v_lead,
         crm_sync_status = 'ok',
         crm_synced_at = now(),
         crm_last_attempt_at = now(),
         crm_error = NULL,
         updated_at = now()
   WHERE id = p_id;

  RETURN v_lead;
END;
$function$;
