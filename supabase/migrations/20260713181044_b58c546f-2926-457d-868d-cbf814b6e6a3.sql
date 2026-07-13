
CREATE TABLE public.research_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  tagline_pl text,
  tagline_en text,
  scope_pl text,
  scope_en text,
  research_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  icon text NOT NULL DEFAULT 'Compass',
  accent_color text NOT NULL DEFAULT '#0F172A',
  hero_image_url text,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  contact_email text,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_programs_slug_check CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  CONSTRAINT research_programs_name_check CHECK (btrim(name_pl) <> '' AND btrim(name_en) <> ''),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX idx_research_programs_tenant_status ON public.research_programs (tenant_id, status, sort_order);
CREATE INDEX idx_research_programs_category ON public.research_programs (category_id) WHERE category_id IS NOT NULL;

GRANT SELECT ON public.research_programs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_programs TO authenticated;
GRANT ALL ON public.research_programs TO service_role;

ALTER TABLE public.research_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "research_programs public read" ON public.research_programs FOR SELECT
  TO anon, authenticated
  USING (status = 'published' AND tenant_id = (SELECT public_tenant_id()));
CREATE POLICY "research_programs staff read all" ON public.research_programs FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role));
CREATE POLICY "research_programs staff write" ON public.research_programs FOR ALL
  TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

CREATE TRIGGER research_programs_set_updated_at BEFORE UPDATE ON public.research_programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE public.research_program_members (
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_role_pl text,
  member_role_en text,
  is_lead boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (program_id, profile_id)
);
CREATE INDEX idx_rpm_profile ON public.research_program_members (profile_id);
CREATE UNIQUE INDEX ux_rpm_one_lead_per_program ON public.research_program_members (program_id) WHERE is_lead;

GRANT SELECT ON public.research_program_members TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_program_members TO authenticated;
GRANT ALL ON public.research_program_members TO service_role;

ALTER TABLE public.research_program_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rpm public read" ON public.research_program_members FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.research_programs p WHERE p.id = program_id AND p.status = 'published' AND p.tenant_id = (SELECT public_tenant_id())));
CREATE POLICY "rpm staff write" ON public.research_program_members FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role));


CREATE TABLE public.research_program_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  summary_pl text,
  summary_en text,
  project_status text NOT NULL DEFAULT 'active' CHECK (project_status IN ('planned','active','completed')),
  url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rpp_program ON public.research_program_projects (program_id, sort_order);

GRANT SELECT ON public.research_program_projects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_program_projects TO authenticated;
GRANT ALL ON public.research_program_projects TO service_role;

ALTER TABLE public.research_program_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rpp public read" ON public.research_program_projects FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.research_programs p WHERE p.id = program_id AND p.status = 'published' AND p.tenant_id = (SELECT public_tenant_id())));
CREATE POLICY "rpp staff write" ON public.research_program_projects FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role));

CREATE TRIGGER rpp_set_updated_at BEFORE UPDATE ON public.research_program_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE public.research_program_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  name text NOT NULL,
  logo_url text,
  url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rppart_program ON public.research_program_partners (program_id, sort_order);

GRANT SELECT ON public.research_program_partners TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_program_partners TO authenticated;
GRANT ALL ON public.research_program_partners TO service_role;

ALTER TABLE public.research_program_partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rppart public read" ON public.research_program_partners FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.research_programs p WHERE p.id = program_id AND p.status = 'published' AND p.tenant_id = (SELECT public_tenant_id())));
CREATE POLICY "rppart staff write" ON public.research_program_partners FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role));

CREATE TRIGGER rppart_set_updated_at BEFORE UPDATE ON public.research_program_partners
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE public.research_program_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('flagship_post','podcast','event')),
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  podcast_id uuid REFERENCES public.podcasts(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rpi_one_target CHECK (
    (item_type = 'flagship_post' AND post_id IS NOT NULL AND podcast_id IS NULL AND event_id IS NULL) OR
    (item_type = 'podcast' AND podcast_id IS NOT NULL AND post_id IS NULL AND event_id IS NULL) OR
    (item_type = 'event' AND event_id IS NOT NULL AND post_id IS NULL AND podcast_id IS NULL)
  )
);
CREATE INDEX idx_rpi_program ON public.research_program_items (program_id, item_type, sort_order);

GRANT SELECT ON public.research_program_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_program_items TO authenticated;
GRANT ALL ON public.research_program_items TO service_role;

ALTER TABLE public.research_program_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rpi public read" ON public.research_program_items FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.research_programs p WHERE p.id = program_id AND p.status = 'published' AND p.tenant_id = (SELECT public_tenant_id())));
CREATE POLICY "rpi staff write" ON public.research_program_items FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role));


CREATE OR REPLACE FUNCTION public.get_program_members(p_program_ids uuid[])
RETURNS TABLE (
  program_id uuid,
  profile_id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  profile_slug text,
  member_role_pl text,
  member_role_en text,
  is_lead boolean,
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.program_id,
    m.profile_id,
    COALESCE(
      NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'Członek zespołu'
    ) AS display_name,
    p.avatar_url,
    p.job_title,
    p.slug AS profile_slug,
    m.member_role_pl,
    m.member_role_en,
    m.is_lead,
    m.sort_order
  FROM public.research_program_members m
  LEFT JOIN public.profiles p ON p.id = m.profile_id
  WHERE m.program_id = ANY(p_program_ids)
    AND EXISTS (
      SELECT 1 FROM public.research_programs rp
      WHERE rp.id = m.program_id
        AND rp.status = 'published'
        AND rp.tenant_id = (SELECT public_tenant_id())
    )
  ORDER BY m.is_lead DESC, m.sort_order ASC, display_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_program_members(uuid[]) TO anon, authenticated, service_role;
