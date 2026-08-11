ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_source_type_check;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_source_type_check
  CHECK (source_type IN ('registered','paid_subscriber','event_participant',
    'speaker','expert','contact_form','newsletter','manual','club_application'));

DROP INDEX IF EXISTS public.club_applications_open_unique_idx;
CREATE UNIQUE INDEX club_applications_open_unique_idx
  ON public.club_applications (user_id, specialization_slug)
  WHERE status IN ('pending', 'review', 'needs_info');

COMMENT ON INDEX public.club_applications_open_unique_idx IS
  'Jedno otwarte zgloszenie na osobe i specjalizacje. Otwarte = pending, review, needs_info.';

DROP POLICY IF EXISTS club_applications_select_own ON public.club_applications;
CREATE POLICY club_applications_select_own
  ON public.club_applications FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.club_apply_submit(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_club_id uuid;
  v_reason text;
  v_years_raw text;
  v_years integer;
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

  v_club_id := NULLIF(btrim(COALESCE(p->>'club_id', '')), '')::uuid;
  IF v_club_id IS NOT NULL THEN
    SELECT reason INTO v_reason
      FROM public.club_capabilities(v_club_id, NULL, v_uid);
    IF v_reason = 'tier_too_low' THEN
      RAISE EXCEPTION 'club_tier_too_low';
    END IF;
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

  v_years_raw := NULLIF(btrim(COALESCE(p->>'years_experience', '')), '');
  IF v_years_raw IS NOT NULL THEN
    IF v_years_raw !~ '^\d{1,2}$' THEN
      RAISE EXCEPTION 'years_invalid';
    END IF;
    v_years := v_years_raw::integer;
    IF v_years > 70 THEN
      RAISE EXCEPTION 'years_invalid';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.club_applications a
     WHERE a.user_id = v_uid
       AND a.specialization_slug = v_spec
       AND a.status IN ('pending', 'review', 'needs_info')
  ) THEN
    RAISE EXCEPTION 'duplicate_open';
  END IF;

  INSERT INTO public.club_applications (
    tenant_id, user_id, specialization_slug, club_id,
    first_name, last_name, email, phone, company, job_position, seniority, industry,
    country, city, linkedin_url, years_experience, expertise, languages,
    motivation, goals, contribution, availability, referral_source,
    consent, marketing_consent, tier_key, tier_rank, lang
  ) VALUES (
    v_tenant, v_uid, v_spec, v_club_id,
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
    v_years,
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
$$;

COMMENT ON FUNCTION public.club_apply_submit(jsonb) IS
  'Zgloszenie do klubu: bramka planu globalna i wlasna klubu, walidacja pol, jedno otwarte zgloszenie na specjalizacje (pending/review/needs_info). Wejscie do CRM idzie przez club_application_crm_sync - blad synchronizacji nie wywraca formularza, laduje w crm_sync_status/crm_error.';

REVOKE ALL ON FUNCTION public.club_apply_submit(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.club_apply_submit(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.club_application_crm_sync(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    'club_application'
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
$$;

COMMENT ON FUNCTION public.club_application_crm_sync(uuid) IS
  'Synchronizacja jednego zgloszenia z CRM: crm_upsert_from_form (dedup, firma, kraj, LinkedIn, aliasy) + jawny UPDATE zrodla i zgody (zgoda tylko w gore).';

REVOKE ALL ON FUNCTION public.club_application_crm_sync(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.admin_club_applications_list(text, uuid, text, text, integer);

CREATE OR REPLACE FUNCTION public.admin_club_applications_list(
  p_specialization text DEFAULT NULL,
  p_club_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  id uuid, created_at timestamptz, user_id uuid, specialization_slug text,
  club_id uuid, club_name_pl text, club_name_en text,
  first_name text, last_name text, email text,
  phone text, company text, job_position text, seniority text, industry text,
  country text, city text, linkedin_url text, years_experience integer,
  expertise text, languages text, motivation text, goals text, contribution text,
  availability text, referral_source text, marketing_consent boolean,
  tier_key text, tier_rank integer, status text, admin_note text,
  reviewed_at timestamptz, lang text,
  crm_lead_id uuid, crm_sync_status text, crm_synced_at timestamptz,
  crm_last_attempt_at timestamptz, crm_error text,
  notified_status text, notified_at timestamptz, notify_error text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.created_at, a.user_id, a.specialization_slug,
         a.club_id, c.name_pl AS club_name_pl, c.name_en AS club_name_en,
         a.first_name, a.last_name, a.email,
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
$$;

COMMENT ON FUNCTION public.admin_club_applications_list(text, uuid, text, text, integer) IS
  'Skrzynka zgloszen dla admina tenanta. Nazwa klubu wychodzi w obu jezykach. Kolumny crm_* i notified_* niesie panel.';

REVOKE ALL ON FUNCTION public.admin_club_applications_list(text, uuid, text, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_club_applications_list(text, uuid, text, text, integer) TO authenticated;