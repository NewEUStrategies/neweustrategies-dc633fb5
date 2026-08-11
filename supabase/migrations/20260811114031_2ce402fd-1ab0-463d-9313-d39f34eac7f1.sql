ALTER TABLE public.club_applications
  ADD COLUMN IF NOT EXISTS crm_lead_id uuid,
  ADD COLUMN IF NOT EXISTS crm_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS crm_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS crm_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS crm_error text,
  ADD COLUMN IF NOT EXISTS notified_status text,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS notify_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.club_applications'::regclass
      AND conname = 'club_applications_crm_sync_status_chk'
  ) THEN
    ALTER TABLE public.club_applications
      ADD CONSTRAINT club_applications_crm_sync_status_chk
      CHECK (crm_sync_status IN ('pending','ok','error'));
  END IF;
END $$;

ALTER TABLE public.club_applications DROP CONSTRAINT IF EXISTS club_applications_status_chk;
ALTER TABLE public.club_applications
  ADD CONSTRAINT club_applications_status_chk
  CHECK (status IN ('pending','review','accepted','rejected','needs_info'));

-- Synchronizacja pojedynczego zgloszenia z CRM. Wydzielona z club_apply_submit,
-- zeby ta sama logika obslugiwala pierwszy zapis i ponowienie z panelu.
CREATE OR REPLACE FUNCTION public.club_application_crm_sync(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  a public.club_applications%ROWTYPE;
  v_lead uuid;
BEGIN
  SELECT * INTO a FROM public.club_applications WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  INSERT INTO public.crm_leads (
    tenant_id, email, email_norm, first_name, last_name, phone, company, "position",
    source_type, marketing_consent, last_activity_at,
    club_applied_at, club_application_count, club_specializations
  ) VALUES (
    a.tenant_id, lower(a.email), lower(a.email),
    NULLIF(a.first_name, ''), NULLIF(a.last_name, ''), NULLIF(a.phone, ''),
    NULLIF(a.company, ''), NULLIF(a.job_position, ''),
    'club_application', COALESCE(a.marketing_consent, false), now(),
    COALESCE(a.created_at, now()), 1, ARRAY[a.specialization_slug]
  )
  ON CONFLICT (tenant_id, email_norm) DO UPDATE SET
    first_name = COALESCE(EXCLUDED.first_name, public.crm_leads.first_name),
    last_name = COALESCE(EXCLUDED.last_name, public.crm_leads.last_name),
    phone = COALESCE(EXCLUDED.phone, public.crm_leads.phone),
    company = COALESCE(EXCLUDED.company, public.crm_leads.company),
    "position" = COALESCE(EXCLUDED."position", public.crm_leads."position"),
    last_activity_at = now(),
    club_applied_at = COALESCE(public.crm_leads.club_applied_at, EXCLUDED.club_applied_at),
    club_specializations = (
      SELECT ARRAY(SELECT DISTINCT unnest(public.crm_leads.club_specializations || ARRAY[a.specialization_slug]))
    ),
    updated_at = now()
  RETURNING id INTO v_lead;

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

REVOKE ALL ON FUNCTION public.club_application_crm_sync(uuid) FROM PUBLIC, anon, authenticated;

-- Ponowienie synchronizacji z panelu (redakcja w obrebie swojego tenanta).
CREATE OR REPLACE FUNCTION public.admin_club_application_crm_retry(p_id uuid)
RETURNS TABLE(crm_sync_status text, crm_error text, crm_synced_at timestamptz, crm_last_attempt_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_err text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.club_applications WHERE id = p_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  BEGIN
    PERFORM public.club_application_crm_sync(p_id);
  EXCEPTION WHEN OTHERS THEN
    v_err := left(SQLERRM, 500);
    UPDATE public.club_applications
       SET crm_sync_status = 'error',
           crm_error = v_err,
           crm_last_attempt_at = now(),
           updated_at = now()
     WHERE id = p_id;
  END;

  RETURN QUERY
    SELECT a.crm_sync_status, a.crm_error, a.crm_synced_at, a.crm_last_attempt_at
      FROM public.club_applications a
     WHERE a.id = p_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_club_application_crm_retry(uuid) TO authenticated;

-- Dane potrzebne do wyslania powiadomienia o zmianie statusu.
CREATE OR REPLACE FUNCTION public.admin_club_application_notify_payload(p_id uuid)
RETURNS TABLE(email text, first_name text, last_name text, lang text, status text, specialization_slug text, tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT a.email, a.first_name, a.last_name, a.lang, a.status, a.specialization_slug, a.tenant_id
    FROM public.club_applications a
   WHERE a.id = p_id AND a.tenant_id = public.assert_admin_tenant();
$function$;

GRANT EXECUTE ON FUNCTION public.admin_club_application_notify_payload(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_club_application_mark_notified(
  p_id uuid, p_status text, p_ok boolean, p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
BEGIN
  UPDATE public.club_applications
     SET notified_status = CASE WHEN p_ok THEN p_status ELSE notified_status END,
         notified_at = CASE WHEN p_ok THEN now() ELSE notified_at END,
         notify_error = CASE WHEN p_ok THEN NULL ELSE left(btrim(p_error), 500) END,
         updated_at = now()
   WHERE id = p_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_club_application_mark_notified(uuid, text, boolean, text) TO authenticated;

-- Status: dopuszczamy "uzupelnij dane" i zerujemy slad powiadomienia,
-- zeby panel pokazywal, ze dla nowego statusu mail jeszcze nie wyszedl.
CREATE OR REPLACE FUNCTION public.admin_club_application_set_status(p_id uuid, p_status text, p_note text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
BEGIN
  IF p_status NOT IN ('pending','review','accepted','rejected','needs_info') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  UPDATE public.club_applications
     SET status = p_status,
         admin_note = COALESCE(left(btrim(p_note), 2000), admin_note),
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         notify_error = NULL,
         updated_at = now()
   WHERE id = p_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
END;
$function$;

-- Lista dla panelu: dokladamy kolumny synchronizacji i powiadomien.
DROP FUNCTION IF EXISTS public.admin_club_applications_list(text, uuid, text, text, integer);
CREATE OR REPLACE FUNCTION public.admin_club_applications_list(
  p_specialization text DEFAULT NULL::text,
  p_club_id uuid DEFAULT NULL::uuid,
  p_status text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_limit integer DEFAULT 200
)
RETURNS TABLE(id uuid, created_at timestamptz, user_id uuid, specialization_slug text, club_id uuid, club_name text, first_name text, last_name text, email text, phone text, company text, job_position text, seniority text, industry text, country text, city text, linkedin_url text, years_experience integer, expertise text, languages text, motivation text, goals text, contribution text, availability text, referral_source text, marketing_consent boolean, tier_key text, tier_rank integer, status text, admin_note text, reviewed_at timestamptz, lang text, crm_lead_id uuid, crm_sync_status text, crm_synced_at timestamptz, crm_last_attempt_at timestamptz, crm_error text, notified_status text, notified_at timestamptz, notify_error text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT a.id, a.created_at, a.user_id, a.specialization_slug,
         a.club_id, c.name_pl AS club_name, a.first_name, a.last_name, a.email,
         a.phone, a.company, a.job_position, a.seniority, a.industry,
         a.country, a.city, a.linkedin_url, a.years_experience,
         a.expertise, a.languages, a.motivation, a.goals, a.contribution,
         a.availability, a.referral_source, a.marketing_consent,
         a.tier_key, a.tier_rank, a.status, a.admin_note,
         a.reviewed_at, a.lang,
         a.crm_lead_id, a.crm_sync_status, a.crm_synced_at, a.crm_last_attempt_at, a.crm_error,
         a.notified_status, a.notified_at, a.notify_error
    FROM public.club_applications a
    LEFT JOIN public.clubs c ON c.id = a.club_id
   WHERE a.tenant_id = public.assert_admin_tenant()
     AND (p_specialization IS NULL OR a.specialization_slug = p_specialization)
     AND (p_club_id IS NULL OR a.club_id = p_club_id)
     AND (p_status IS NULL OR a.status = p_status)
     AND (
       p_search IS NULL OR btrim(p_search) = ''
       OR a.email ILIKE '%' || btrim(p_search) || '%'
       OR (a.first_name || ' ' || a.last_name) ILIKE '%' || btrim(p_search) || '%'
       OR a.company ILIKE '%' || btrim(p_search) || '%'
     )
   ORDER BY a.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$function$;

GRANT EXECUTE ON FUNCTION public.admin_club_applications_list(text, uuid, text, text, integer) TO authenticated;

-- Zapis zgloszenia: CRM przez wspolna funkcje, bledy nie wywracaja formularza,
-- tylko laduja jako widoczny status synchronizacji.
CREATE OR REPLACE FUNCTION public.club_apply_submit(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_rank integer;
  v_key text;
  v_id uuid;
  v_email text;
  v_spec text;
  v_txt text;
  v_err text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT rank, key INTO v_rank, v_key FROM public.current_membership_tier();
  IF COALESCE(v_rank, 0) < 20 THEN
    RAISE EXCEPTION 'pro_required';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;

  v_spec := NULLIF(btrim(COALESCE(p->>'specialization_slug', '')), '');
  IF v_spec IS NULL THEN
    RAISE EXCEPTION 'specialization_required';
  END IF;
  IF COALESCE((p->>'consent')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'consent_required';
  END IF;

  v_email := lower(btrim(COALESCE(p->>'email', '')));
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'email_required';
  END IF;

  v_txt := btrim(COALESCE(p->>'motivation', ''));
  IF length(v_txt) < 20 THEN
    RAISE EXCEPTION 'motivation_required';
  END IF;

  INSERT INTO public.club_applications (
    tenant_id, user_id, specialization_slug, club_id,
    first_name, last_name, email, phone, company, job_position, seniority, industry,
    country, city, linkedin_url, years_experience, expertise, languages,
    motivation, goals, contribution, availability, referral_source,
    consent, marketing_consent, tier_key, tier_rank, lang
  ) VALUES (
    v_tenant, v_uid, v_spec,
    NULLIF(btrim(COALESCE(p->>'club_id','')), '')::uuid,
    left(btrim(COALESCE(p->>'first_name','')), 60),
    left(btrim(COALESCE(p->>'last_name','')), 80),
    left(v_email, 254),
    left(btrim(COALESCE(p->>'phone','')), 32),
    left(btrim(COALESCE(p->>'company','')), 120),
    left(btrim(COALESCE(p->>'job_position','')), 120),
    left(btrim(COALESCE(p->>'seniority','')), 60),
    left(btrim(COALESCE(p->>'industry','')), 60),
    left(btrim(COALESCE(p->>'country','')), 80),
    left(btrim(COALESCE(p->>'city','')), 80),
    left(btrim(COALESCE(p->>'linkedin_url','')), 200),
    NULLIF(btrim(COALESCE(p->>'years_experience','')), '')::integer,
    left(btrim(COALESCE(p->>'expertise','')), 500),
    left(btrim(COALESCE(p->>'languages','')), 200),
    left(v_txt, 2000),
    left(btrim(COALESCE(p->>'goals','')), 1000),
    left(btrim(COALESCE(p->>'contribution','')), 1000),
    left(btrim(COALESCE(p->>'availability','')), 120),
    left(btrim(COALESCE(p->>'referral_source','')), 120),
    true,
    COALESCE((p->>'marketing_consent')::boolean, false),
    COALESCE(v_key, ''), COALESCE(v_rank, 0),
    CASE WHEN COALESCE(p->>'lang','pl') = 'en' THEN 'en' ELSE 'pl' END
  )
  RETURNING id INTO v_id;

  BEGIN
    PERFORM public.club_application_crm_sync(v_id);
  EXCEPTION WHEN OTHERS THEN
    v_err := left(SQLERRM, 500);
    UPDATE public.club_applications
       SET crm_sync_status = 'error',
           crm_error = v_err,
           crm_last_attempt_at = now()
     WHERE id = v_id;
  END;

  RETURN v_id;
END;
$function$;