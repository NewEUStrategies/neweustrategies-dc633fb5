ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS club_applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS club_application_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS club_specializations text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.club_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  specialization_slug text NOT NULL,
  club_id uuid REFERENCES public.clubs(id) ON DELETE SET NULL,
  first_name text NOT NULL,
  last_name text NOT NULL DEFAULT '',
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  job_position text NOT NULL DEFAULT '',
  seniority text NOT NULL DEFAULT '',
  industry text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  linkedin_url text NOT NULL DEFAULT '',
  years_experience integer,
  expertise text NOT NULL DEFAULT '',
  languages text NOT NULL DEFAULT '',
  motivation text NOT NULL DEFAULT '',
  goals text NOT NULL DEFAULT '',
  contribution text NOT NULL DEFAULT '',
  availability text NOT NULL DEFAULT '',
  referral_source text NOT NULL DEFAULT '',
  consent boolean NOT NULL DEFAULT false,
  marketing_consent boolean NOT NULL DEFAULT false,
  tier_key text NOT NULL DEFAULT '',
  tier_rank integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  admin_note text NOT NULL DEFAULT '',
  reviewed_by uuid,
  reviewed_at timestamptz,
  lang text NOT NULL DEFAULT 'pl',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_applications_status_chk
    CHECK (status IN ('pending','review','accepted','rejected'))
);

CREATE INDEX IF NOT EXISTS club_applications_tenant_created_idx
  ON public.club_applications (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS club_applications_spec_idx
  ON public.club_applications (tenant_id, specialization_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS club_applications_club_idx
  ON public.club_applications (club_id) WHERE club_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS club_applications_user_idx
  ON public.club_applications (user_id, created_at DESC);

GRANT SELECT ON public.club_applications TO authenticated;
GRANT ALL ON public.club_applications TO service_role;

ALTER TABLE public.club_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY club_applications_select_own
  ON public.club_applications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY club_applications_select_admin
  ON public.club_applications FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE TRIGGER club_applications_touch_updated_at
  BEFORE UPDATE ON public.club_applications
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

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

  INSERT INTO public.crm_leads (
    tenant_id, email, email_norm, first_name, last_name, phone, company, "position",
    source_type, marketing_consent, last_activity_at,
    club_applied_at, club_application_count, club_specializations
  ) VALUES (
    v_tenant, v_email, v_email,
    NULLIF(btrim(COALESCE(p->>'first_name','')), ''),
    NULLIF(btrim(COALESCE(p->>'last_name','')), ''),
    NULLIF(btrim(COALESCE(p->>'phone','')), ''),
    NULLIF(btrim(COALESCE(p->>'company','')), ''),
    NULLIF(btrim(COALESCE(p->>'job_position','')), ''),
    'club_application',
    COALESCE((p->>'marketing_consent')::boolean, false),
    now(), now(), 1, ARRAY[v_spec]
  )
  ON CONFLICT (tenant_id, email_norm) DO UPDATE SET
    first_name = COALESCE(EXCLUDED.first_name, public.crm_leads.first_name),
    last_name = COALESCE(EXCLUDED.last_name, public.crm_leads.last_name),
    phone = COALESCE(EXCLUDED.phone, public.crm_leads.phone),
    company = COALESCE(EXCLUDED.company, public.crm_leads.company),
    "position" = COALESCE(EXCLUDED."position", public.crm_leads."position"),
    last_activity_at = now(),
    club_applied_at = now(),
    club_application_count = public.crm_leads.club_application_count + 1,
    club_specializations = (
      SELECT ARRAY(SELECT DISTINCT unnest(public.crm_leads.club_specializations || ARRAY[v_spec]))
    ),
    updated_at = now();

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.club_apply_submit(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.club_apply_submit(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_club_applications_list(
  p_specialization text DEFAULT NULL,
  p_club_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  id uuid, created_at timestamptz, user_id uuid, specialization_slug text,
  club_id uuid, club_name text, first_name text, last_name text, email text,
  phone text, company text, job_position text, seniority text, industry text,
  country text, city text, linkedin_url text, years_experience integer,
  expertise text, languages text, motivation text, goals text, contribution text,
  availability text, referral_source text, marketing_consent boolean,
  tier_key text, tier_rank integer, status text, admin_note text,
  reviewed_at timestamptz, lang text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.created_at, a.user_id, a.specialization_slug,
         a.club_id, c.name_pl AS club_name, a.first_name, a.last_name, a.email,
         a.phone, a.company, a.job_position, a.seniority, a.industry,
         a.country, a.city, a.linkedin_url, a.years_experience,
         a.expertise, a.languages, a.motivation, a.goals, a.contribution,
         a.availability, a.referral_source, a.marketing_consent,
         a.tier_key, a.tier_rank, a.status, a.admin_note,
         a.reviewed_at, a.lang
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

REVOKE ALL ON FUNCTION public.admin_club_applications_list(text, uuid, text, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_club_applications_list(text, uuid, text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_club_applications_counts()
RETURNS TABLE (specialization_slug text, total integer, pending integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.specialization_slug,
         count(*)::integer AS total,
         count(*) FILTER (WHERE a.status = 'pending')::integer AS pending
    FROM public.club_applications a
   WHERE a.tenant_id = public.assert_admin_tenant()
   GROUP BY a.specialization_slug
   ORDER BY a.specialization_slug;
$$;

REVOKE ALL ON FUNCTION public.admin_club_applications_counts() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_club_applications_counts() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_club_application_set_status(
  p_id uuid,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
BEGIN
  IF p_status NOT IN ('pending','review','accepted','rejected') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  UPDATE public.club_applications
     SET status = p_status,
         admin_note = COALESCE(left(btrim(p_note), 2000), admin_note),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   WHERE id = p_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_club_application_set_status(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_club_application_set_status(uuid, text, text) TO authenticated;