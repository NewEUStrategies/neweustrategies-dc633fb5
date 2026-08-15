-- Powierzchnia styku dla migracji scalającej tabele programów.
--
-- To NIE jest replika produkcji. Odtwarzamy dokładnie tyle, ile dotyka
-- 20260815100000: obie rodziny programów w kształcie SPRZED scalenia
-- (przepisane z migracji 20260713175104 / 20260713181044 / 20260714130000)
-- plus obiekty, o które te tabele zahaczają. Każdy obiekt przepisany
-- z ORYGINAŁU - inaczej test przechodziłby na fikcji.
--
-- Tenant rozstrzygamy przez `current_setting`, żeby test mógł przełączać
-- najemcę i sprawdzić izolację, zamiast wierzyć, że działa.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'author', 'user', 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('nes.uid', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.public_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('nes.public_tenant', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('nes.tenant', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid NOT NULL, role public.app_role NOT NULL, PRIMARY KEY (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = _role)
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Kolumny profilu / treści są tu po to, żeby dały się utworzyć DWIE funkcje
-- SECURITY DEFINER przepinane migracją (`get_program_members`,
-- `club_anchor_label`). Bez nich harness testowałby migrację bez jej połowy.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text, first_name text, last_name text,
  avatar_url text, job_title text, slug text
);
CREATE TABLE IF NOT EXISTS public.categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE IF NOT EXISTS public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_pl text, title_en text, slug text, deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.podcasts (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_pl text, title_en text, slug text
);
CREATE TABLE IF NOT EXISTS public.eu_policy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title_pl text, title_en text
);

CREATE OR REPLACE FUNCTION public.club_linked_item_label(p_type text, p_id text)
RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;

-- ===========================================================================
-- RODZINA A: public.programs (20260713175104 + 20260714130000)
-- ===========================================================================
CREATE TABLE public.programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  kind text NOT NULL DEFAULT 'program' CHECK (kind IN ('program', 'project', 'department')),
  description_pl text,
  description_en text,
  cover_url text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  CHECK (btrim(name_pl) <> '' AND btrim(name_en) <> '')
);
CREATE INDEX idx_programs_tenant_active ON public.programs (tenant_id, sort_order) WHERE is_active;
CREATE TRIGGER programs_set_updated_at BEFORE UPDATE ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
GRANT SELECT ON public.programs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.programs TO authenticated;
GRANT ALL ON public.programs TO service_role;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "programs public read" ON public.programs
  FOR SELECT TO anon, authenticated
  USING (tenant_id = (SELECT public.public_tenant_id()));
CREATE POLICY "programs staff write" ON public.programs
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
              OR public.has_role((SELECT auth.uid()), 'editor'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id())
         AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
              OR public.has_role((SELECT auth.uid()), 'editor'::app_role)));

CREATE TABLE public.program_members (
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_pl text, role_en text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (program_id, user_id)
);
GRANT SELECT ON public.program_members TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.program_members TO authenticated;
ALTER TABLE public.program_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "program_members public read" ON public.program_members
  FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.post_programs (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, program_id)
);
ALTER TABLE public.podcasts ADD COLUMN IF NOT EXISTS program_id uuid
  REFERENCES public.programs(id) ON DELETE SET NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS program_id uuid
  REFERENCES public.programs(id) ON DELETE SET NULL;

-- ===========================================================================
-- RODZINA B: public.research_programs (20260713181044 + 20260714130000)
-- ===========================================================================
CREATE TABLE public.research_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  tagline_pl text, tagline_en text,
  scope_pl text, scope_en text,
  research_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  icon text NOT NULL DEFAULT 'Compass',
  accent_color text NOT NULL DEFAULT '#1e3a8a',
  hero_image_url text,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  contact_email text,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  CHECK (slug ~ '^[a-z0-9-]{3,120}$'),
  CHECK (btrim(name_pl) <> '' AND btrim(name_en) <> ''),
  CHECK (accent_color ~* '^#[0-9a-f]{6}$'),
  CHECK (jsonb_typeof(research_questions) = 'array')
);
CREATE INDEX idx_research_programs_tenant ON public.research_programs (tenant_id, status, sort_order);
CREATE TRIGGER research_programs_set_updated_at BEFORE UPDATE ON public.research_programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
GRANT SELECT ON public.research_programs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.research_programs TO authenticated;
GRANT ALL ON public.research_programs TO service_role;
ALTER TABLE public.research_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "research programs public read" ON public.research_programs
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND tenant_id = (SELECT public.public_tenant_id()));
CREATE POLICY "research programs staff all" ON public.research_programs
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
              OR public.has_role((SELECT auth.uid()), 'editor'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id())
         AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
              OR public.has_role((SELECT auth.uid()), 'editor'::app_role)));

CREATE OR REPLACE FUNCTION public.tg_research_program_child_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.research_programs WHERE id = NEW.program_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'research program % not found', NEW.program_id; END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END; $$;

CREATE TABLE public.research_program_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_role_pl text, member_role_en text,
  is_lead boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, profile_id)
);
CREATE TRIGGER research_program_members_tenant BEFORE INSERT ON public.research_program_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_research_program_child_tenant();
GRANT SELECT ON public.research_program_members TO anon, authenticated;
ALTER TABLE public.research_program_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "program members public read" ON public.research_program_members
  FOR SELECT TO anon, authenticated
  USING (tenant_id = (SELECT public.public_tenant_id())
         AND EXISTS (SELECT 1 FROM public.research_programs p
                      WHERE p.id = research_program_members.program_id AND p.status = 'published'));

CREATE TABLE public.research_program_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  name_pl text NOT NULL, name_en text NOT NULL,
  summary_pl text, summary_en text,
  project_status text NOT NULL DEFAULT 'active'
    CHECK (project_status IN ('planned', 'active', 'completed')),
  url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER research_program_projects_tenant BEFORE INSERT ON public.research_program_projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_research_program_child_tenant();
GRANT SELECT ON public.research_program_projects TO anon, authenticated;
ALTER TABLE public.research_program_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "program projects public read" ON public.research_program_projects
  FOR SELECT TO anon, authenticated
  USING (tenant_id = (SELECT public.public_tenant_id())
         AND EXISTS (SELECT 1 FROM public.research_programs p
                      WHERE p.id = research_program_projects.program_id AND p.status = 'published'));

CREATE TABLE public.research_program_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  name text NOT NULL,
  logo_url text, url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER research_program_partners_tenant BEFORE INSERT ON public.research_program_partners
  FOR EACH ROW EXECUTE FUNCTION public.tg_research_program_child_tenant();
GRANT SELECT ON public.research_program_partners TO anon, authenticated;
ALTER TABLE public.research_program_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "program partners public read" ON public.research_program_partners
  FOR SELECT TO anon, authenticated
  USING (tenant_id = (SELECT public.public_tenant_id())
         AND EXISTS (SELECT 1 FROM public.research_programs p
                      WHERE p.id = research_program_partners.program_id AND p.status = 'published'));

CREATE TABLE public.research_program_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('flagship_post', 'podcast', 'event')),
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  podcast_id uuid REFERENCES public.podcasts(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (item_type = 'flagship_post' AND post_id IS NOT NULL AND podcast_id IS NULL AND event_id IS NULL)
    OR (item_type = 'podcast' AND podcast_id IS NOT NULL AND post_id IS NULL AND event_id IS NULL)
    OR (item_type = 'event' AND event_id IS NOT NULL AND post_id IS NULL AND podcast_id IS NULL)
  )
);
CREATE UNIQUE INDEX uq_research_program_items_post
  ON public.research_program_items (program_id, post_id) WHERE post_id IS NOT NULL;
CREATE TRIGGER research_program_items_tenant BEFORE INSERT ON public.research_program_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_research_program_child_tenant();
GRANT SELECT ON public.research_program_items TO anon, authenticated;
ALTER TABLE public.research_program_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "program items public read" ON public.research_program_items
  FOR SELECT TO anon, authenticated
  USING (tenant_id = (SELECT public.public_tenant_id())
         AND EXISTS (SELECT 1 FROM public.research_programs p
                      WHERE p.id = research_program_items.program_id AND p.status = 'published'));

-- ===========================================================================
-- DRUGI KOMPLET POLITYK NA TYCH SAMYCH CZTERECH TABELACH
--
-- To NIE jest duplikat przez pomyłkę - tak wygląda produkcja. Migracja
-- 20260713181044 nadała politykom nazwy `rpm` / `rpp` / `rppart` / `rpi`,
-- 20260714112155 przepisała cztery `staff write` dokładając zakres tenanta,
-- a 20260714130000 (expert_hub) dołożyła OBOK drugi komplet pod nazwami
-- opisowymi (`"program members public read"` itd.). Polityki permisywne
-- sumują się przez OR, więc oba komplety żyją.
--
-- Pierwsza wersja tego harnessu odtwarzała TYLKO komplet z expert_hub -
-- i przez to przepuściła realny defekt: `DROP TABLE research_programs`
-- wywalił się na produkcyjnym CI z 2BP01, wymieniając osiem zależnych polityk
-- `rp*`, których harness nie znał. Harness odtwarzający stan z JEDNEJ migracji
-- zamiast ze STANU KOŃCOWEGO mierzy fikcję - dokładnie ten tryb porażki, przed
-- którym ostrzega scripts/pg-harness/README.md.
-- ===========================================================================
CREATE POLICY "rpm public read" ON public.research_program_members FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.research_programs p
                  WHERE p.id = program_id AND p.status = 'published'
                    AND p.tenant_id = (SELECT public_tenant_id())));
CREATE POLICY "rpm staff write" ON public.research_program_members FOR ALL
  TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
         AND EXISTS (SELECT 1 FROM public.research_programs p
                      WHERE p.id = research_program_members.program_id
                        AND p.tenant_id = current_tenant_id()))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
         AND EXISTS (SELECT 1 FROM public.research_programs p
                      WHERE p.id = research_program_members.program_id
                        AND p.tenant_id = current_tenant_id()));

CREATE POLICY "rpp public read" ON public.research_program_projects FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.research_programs p
                  WHERE p.id = program_id AND p.status = 'published'
                    AND p.tenant_id = (SELECT public_tenant_id())));
CREATE POLICY "rpp staff write" ON public.research_program_projects FOR ALL
  TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
         AND EXISTS (SELECT 1 FROM public.research_programs p
                      WHERE p.id = research_program_projects.program_id
                        AND p.tenant_id = current_tenant_id()))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
         AND EXISTS (SELECT 1 FROM public.research_programs p
                      WHERE p.id = research_program_projects.program_id
                        AND p.tenant_id = current_tenant_id()));

CREATE POLICY "rppart public read" ON public.research_program_partners FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.research_programs p
                  WHERE p.id = program_id AND p.status = 'published'
                    AND p.tenant_id = (SELECT public_tenant_id())));
CREATE POLICY "rppart staff write" ON public.research_program_partners FOR ALL
  TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
         AND EXISTS (SELECT 1 FROM public.research_programs p
                      WHERE p.id = research_program_partners.program_id
                        AND p.tenant_id = current_tenant_id()))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
         AND EXISTS (SELECT 1 FROM public.research_programs p
                      WHERE p.id = research_program_partners.program_id
                        AND p.tenant_id = current_tenant_id()));

CREATE POLICY "rpi public read" ON public.research_program_items FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.research_programs p
                  WHERE p.id = program_id AND p.status = 'published'
                    AND p.tenant_id = (SELECT public_tenant_id())));
CREATE POLICY "rpi staff write" ON public.research_program_items FOR ALL
  TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
         AND EXISTS (SELECT 1 FROM public.research_programs p
                      WHERE p.id = research_program_items.program_id
                        AND p.tenant_id = current_tenant_id()))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
         AND EXISTS (SELECT 1 FROM public.research_programs p
                      WHERE p.id = research_program_items.program_id
                        AND p.tenant_id = current_tenant_id()));
