-- Kariera: oferty pracy i sekcje strony /zatrudniamy zarzadzane z panelu admina.
CREATE TABLE IF NOT EXISTS public.career_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  department text NOT NULL,
  engagement text NOT NULL,
  seniority text NOT NULL,
  location text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  summary_pl text NOT NULL DEFAULT '',
  summary_en text NOT NULL DEFAULT '',
  responsibilities_pl text[] NOT NULL DEFAULT '{}',
  responsibilities_en text[] NOT NULL DEFAULT '{}',
  requirements_pl text[] NOT NULL DEFAULT '{}',
  requirements_en text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_roles_department_chk CHECK (department IN ('analysis','policy','marketing','advisory','editorial','operations')),
  CONSTRAINT career_roles_engagement_chk CHECK (engagement IN ('full_time','part_time','contract','internship')),
  CONSTRAINT career_roles_seniority_chk CHECK (seniority IN ('junior','mid','senior','lead')),
  CONSTRAINT career_roles_location_chk CHECK (location IN ('remote','hybrid','warsaw','brussels'))
);

CREATE TABLE IF NOT EXISTS public.career_page_sections (
  key text PRIMARY KEY,
  is_visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  title_pl text,
  title_en text,
  subtitle_pl text,
  subtitle_en text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.career_roles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.career_roles TO authenticated;
GRANT ALL ON public.career_roles TO service_role;
GRANT SELECT ON public.career_page_sections TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.career_page_sections TO authenticated;
GRANT ALL ON public.career_page_sections TO service_role;

ALTER TABLE public.career_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_page_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS career_roles_public_read ON public.career_roles;
CREATE POLICY career_roles_public_read ON public.career_roles
  FOR SELECT TO anon, authenticated USING (is_published);

DROP POLICY IF EXISTS career_roles_staff_read ON public.career_roles;
CREATE POLICY career_roles_staff_read ON public.career_roles
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS career_roles_staff_write ON public.career_roles;
CREATE POLICY career_roles_staff_write ON public.career_roles
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS career_roles_staff_update ON public.career_roles;
CREATE POLICY career_roles_staff_update ON public.career_roles
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS career_roles_staff_delete ON public.career_roles;
CREATE POLICY career_roles_staff_delete ON public.career_roles
  FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS career_sections_public_read ON public.career_page_sections;
CREATE POLICY career_sections_public_read ON public.career_page_sections
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS career_sections_staff_write ON public.career_page_sections;
CREATE POLICY career_sections_staff_write ON public.career_page_sections
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS career_sections_staff_update ON public.career_page_sections;
CREATE POLICY career_sections_staff_update ON public.career_page_sections
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS career_sections_staff_delete ON public.career_page_sections;
CREATE POLICY career_sections_staff_delete ON public.career_page_sections
  FOR DELETE TO authenticated USING (public.is_staff());

DROP TRIGGER IF EXISTS trg_career_roles_touch ON public.career_roles;
CREATE TRIGGER trg_career_roles_touch BEFORE UPDATE ON public.career_roles
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();
DROP TRIGGER IF EXISTS trg_career_sections_touch ON public.career_page_sections;
CREATE TRIGGER trg_career_sections_touch BEFORE UPDATE ON public.career_page_sections
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE INDEX IF NOT EXISTS career_roles_sort_idx ON public.career_roles (sort_order, created_at);

INSERT INTO public.career_page_sections (key, is_visible, sort_order) VALUES
  ('hero', true, 10), ('values', true, 20), ('benefits', true, 30),
  ('roles', true, 40), ('process', true, 50), ('form', true, 60), ('closing', true, 70)
ON CONFLICT (key) DO NOTHING;