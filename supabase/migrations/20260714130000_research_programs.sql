-- ============================================================================
-- Programy badawcze / specjalizacje (wzorzec think-tank/RUSI).
--
-- Program badawczy jest nadrzednym kontenerem - nie kategoria tresci.
-- Ma wlasna teze, zakres, zespol, projekty, kuratorowane tresci (raporty
-- flagowe, podcasty, wydarzenia), partnerow i dane kontaktowe, oraz wlasna
-- identyfikacje wizualna w granicach systemu marki (ikona lucide + akcent).
--
--   research_programs          rdzen: teza (tagline), zakres badan (scope),
--                              pytania badawcze (jsonb [{pl,en}]), ikona,
--                              kolor akcentu, kategoria (agregacja publikacji),
--                              lider/zespol przez _members, kontakt.
--   research_program_members   zespol programu (profil + rola + is_lead).
--   research_program_projects  projekty programu (status: planned/active/
--                              completed, opcjonalny link).
--   research_program_partners  partnerzy (logo + link).
--   research_program_items     kuracja tresci: raport flagowy (post),
--                              podcast, wydarzenie - dokladnie jedna FK.
--
-- Publikacje "najnowsze" NIE sa kuratorowane: plyna automatycznie przez
-- category_id -> post_categories -> posts (published). Kuracja dotyczy
-- tylko raportow flagowych, podcastow i wydarzen (brak taksonomii tam).
--
-- Zespol czytany jest przez RPC get_program_members (SECURITY DEFINER,
-- tylko bezpieczne pola profilu, tylko opublikowane programy publicznego
-- tenanta) - niezaleznie od polityk RLS na profiles.
--
-- Wszystko idempotentne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.research_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  tagline_pl text,
  tagline_en text,
  scope_pl text,
  scope_en text,
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

CREATE INDEX IF NOT EXISTS idx_research_programs_tenant
  ON public.research_programs (tenant_id, status, sort_order);

DROP TRIGGER IF EXISTS research_programs_set_updated_at ON public.research_programs;
CREATE TRIGGER research_programs_set_updated_at
  BEFORE UPDATE ON public.research_programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.research_programs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.research_programs TO authenticated;
GRANT ALL ON public.research_programs TO service_role;
ALTER TABLE public.research_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "research programs public read" ON public.research_programs;
CREATE POLICY "research programs public read" ON public.research_programs
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "research programs staff all" ON public.research_programs;
CREATE POLICY "research programs staff all" ON public.research_programs
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- Tenant dziecka zawsze dziedziczony z programu (klient nie moze go sfalszowac).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_research_program_child_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant
    FROM public.research_programs
   WHERE id = NEW.program_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'research program % not found', NEW.program_id;
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- Zespol programu
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_program_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_role_pl text,
  member_role_en text,
  is_lead boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_research_program_members_program
  ON public.research_program_members (program_id, sort_order);

DROP TRIGGER IF EXISTS research_program_members_tenant ON public.research_program_members;
CREATE TRIGGER research_program_members_tenant
  BEFORE INSERT ON public.research_program_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_research_program_child_tenant();

GRANT SELECT ON public.research_program_members TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.research_program_members TO authenticated;
GRANT ALL ON public.research_program_members TO service_role;
ALTER TABLE public.research_program_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program members public read" ON public.research_program_members;
CREATE POLICY "program members public read" ON public.research_program_members
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.research_programs p
       WHERE p.id = research_program_members.program_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS "program members staff all" ON public.research_program_members;
CREATE POLICY "program members staff all" ON public.research_program_members
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- Projekty programu
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_program_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  summary_pl text,
  summary_en text,
  project_status text NOT NULL DEFAULT 'active'
    CHECK (project_status IN ('planned', 'active', 'completed')),
  url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(name_pl) <> '' AND btrim(name_en) <> '')
);

CREATE INDEX IF NOT EXISTS idx_research_program_projects_program
  ON public.research_program_projects (program_id, sort_order);

DROP TRIGGER IF EXISTS research_program_projects_set_updated_at ON public.research_program_projects;
CREATE TRIGGER research_program_projects_set_updated_at
  BEFORE UPDATE ON public.research_program_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS research_program_projects_tenant ON public.research_program_projects;
CREATE TRIGGER research_program_projects_tenant
  BEFORE INSERT ON public.research_program_projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_research_program_child_tenant();

GRANT SELECT ON public.research_program_projects TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.research_program_projects TO authenticated;
GRANT ALL ON public.research_program_projects TO service_role;
ALTER TABLE public.research_program_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program projects public read" ON public.research_program_projects;
CREATE POLICY "program projects public read" ON public.research_program_projects
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.research_programs p
       WHERE p.id = research_program_projects.program_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS "program projects staff all" ON public.research_program_projects;
CREATE POLICY "program projects staff all" ON public.research_program_projects
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- Partnerzy programu
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_program_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  logo_url text,
  url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_program_partners_program
  ON public.research_program_partners (program_id, sort_order);

DROP TRIGGER IF EXISTS research_program_partners_tenant ON public.research_program_partners;
CREATE TRIGGER research_program_partners_tenant
  BEFORE INSERT ON public.research_program_partners
  FOR EACH ROW EXECUTE FUNCTION public.tg_research_program_child_tenant();

GRANT SELECT ON public.research_program_partners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.research_program_partners TO authenticated;
GRANT ALL ON public.research_program_partners TO service_role;
ALTER TABLE public.research_program_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program partners public read" ON public.research_program_partners;
CREATE POLICY "program partners public read" ON public.research_program_partners
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.research_programs p
       WHERE p.id = research_program_partners.program_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS "program partners staff all" ON public.research_program_partners;
CREATE POLICY "program partners staff all" ON public.research_program_partners
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- Kuratorowane tresci programu (raport flagowy / podcast / wydarzenie)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_program_items (
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

CREATE INDEX IF NOT EXISTS idx_research_program_items_program
  ON public.research_program_items (program_id, item_type, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_research_program_items_post
  ON public.research_program_items (program_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_research_program_items_podcast
  ON public.research_program_items (program_id, podcast_id) WHERE podcast_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_research_program_items_event
  ON public.research_program_items (program_id, event_id) WHERE event_id IS NOT NULL;

DROP TRIGGER IF EXISTS research_program_items_tenant ON public.research_program_items;
CREATE TRIGGER research_program_items_tenant
  BEFORE INSERT ON public.research_program_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_research_program_child_tenant();

GRANT SELECT ON public.research_program_items TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.research_program_items TO authenticated;
GRANT ALL ON public.research_program_items TO service_role;
ALTER TABLE public.research_program_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program items public read" ON public.research_program_items;
CREATE POLICY "program items public read" ON public.research_program_items
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.research_programs p
       WHERE p.id = research_program_items.program_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS "program items staff all" ON public.research_program_items;
CREATE POLICY "program items staff all" ON public.research_program_items
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- Zespol programu przez RPC: tylko bezpieczne pola profilu, tylko
-- opublikowane programy publicznego tenanta (niezaleznie od RLS profiles).
-- ----------------------------------------------------------------------------
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
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.program_id,
         m.profile_id,
         COALESCE(NULLIF(btrim(pr.display_name), ''),
                  NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
                  'NES') AS display_name,
         pr.avatar_url,
         pr.job_title,
         pr.slug AS profile_slug,
         m.member_role_pl,
         m.member_role_en,
         m.is_lead,
         m.sort_order
    FROM public.research_program_members m
    JOIN public.research_programs p ON p.id = m.program_id
    JOIN public.profiles pr ON pr.id = m.profile_id
   WHERE m.program_id = ANY (p_program_ids)
     AND p.tenant_id = public.public_tenant_id()
     AND p.status = 'published'
   ORDER BY m.is_lead DESC, m.sort_order, m.created_at;
$$;

REVOKE EXECUTE ON FUNCTION public.get_program_members(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_program_members(uuid[])
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Seed: szesc specjalizacji NES dla domyslnego tenanta (idempotentnie).
-- Tresc jest redakcyjna i edytowalna w /admin/programs; kategorie sa
-- podpinane best-effort po slugu (NULL, gdy kategoria nie istnieje).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE is_default LIMIT 1;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'nes' LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.research_programs (
    tenant_id, slug, name_pl, name_en, tagline_pl, tagline_en,
    scope_pl, scope_en, research_questions, icon, accent_color,
    category_id, sort_order, status
  )
  VALUES
    (
      v_tenant, 'geopolityka-i-dyplomacja',
      'Geopolityka i dyplomacja', 'Geopolitics & Diplomacy',
      'Europa w świecie rywalizacji mocarstw: mapujemy interesy, koalicje i dźwignie wpływu, zanim staną się faktami dokonanymi.',
      'Europe in an age of great-power rivalry: we map interests, coalitions and levers of influence before they become faits accomplis.',
      'Program bada pozycję Europy Środkowej i całej UE w zmieniającym się ładzie międzynarodowym: politykę zagraniczną państw członkowskich, relacje transatlantyckie, politykę wschodnią i rozszerzenie, oraz instrumenty dyplomacji publicznej i gospodarczej.',
      'The programme examines the position of Central Europe and the EU in a shifting international order: member-state foreign policies, transatlantic relations, Eastern policy and enlargement, and the instruments of public and economic diplomacy.',
      '[{"pl":"Jak UE może utrzymać podmiotowość między USA a Chinami?","en":"How can the EU retain agency between the US and China?"},{"pl":"Jaka architektura bezpieczeństwa powstanie na wschodniej flance po wojnie w Ukrainie?","en":"What security architecture will emerge on the eastern flank after the war in Ukraine?"},{"pl":"Które koalicje wewnątrz UE realnie decydują o polityce zagranicznej?","en":"Which intra-EU coalitions actually shape foreign policy?"}]'::jsonb,
      'Globe', '#1e3a8a',
      (SELECT id FROM public.categories WHERE tenant_id = v_tenant AND slug IN ('geopolityka', 'polityka-europejska') ORDER BY slug = 'geopolityka' DESC LIMIT 1),
      1, 'published'
    ),
    (
      v_tenant, 'bezpieczenstwo-i-obronnosc',
      'Bezpieczeństwo i obronność', 'Security & Defence',
      'Od zdolności wojskowych po odporność społeczną: analizujemy, czego naprawdę wymaga obrona Europy.',
      'From military capabilities to societal resilience: we analyse what defending Europe actually requires.',
      'Program obejmuje politykę obronną NATO i UE, rozwój zdolności i przemysłu obronnego, odstraszanie konwencjonalne i nuklearne, bezpieczeństwo hybrydowe, cyberbezpieczeństwo oraz odporność infrastruktury krytycznej.',
      'The programme covers NATO and EU defence policy, capability development and the defence industry, conventional and nuclear deterrence, hybrid threats, cybersecurity and the resilience of critical infrastructure.',
      '[{"pl":"Jak sfinansować i zorganizować europejskie zbrojenia na dekadę?","en":"How should Europe finance and organise a decade of rearmament?"},{"pl":"Co odstrasza Rosję: zdolności, obecność czy determinacja polityczna?","en":"What deters Russia: capabilities, presence or political resolve?"},{"pl":"Jak chronić infrastrukturę krytyczną przed sabotażem i atakami hybrydowymi?","en":"How to protect critical infrastructure from sabotage and hybrid attacks?"}]'::jsonb,
      'Shield', '#9f1239',
      (SELECT id FROM public.categories WHERE tenant_id = v_tenant AND slug IN ('bezpieczenstwo', 'obronnosc') ORDER BY slug = 'bezpieczenstwo' DESC LIMIT 1),
      2, 'published'
    ),
    (
      v_tenant, 'gospodarka-i-handel',
      'Gospodarka i handel', 'Economy & Trade',
      'Konkurencyjność, łańcuchy dostaw i polityka przemysłowa: gospodarcze fundamenty pozycji Europy.',
      'Competitiveness, supply chains and industrial policy: the economic foundations of Europe''s position.',
      'Program analizuje politykę gospodarczą UE i państw członkowskich: jednolity rynek, politykę przemysłową i pomoc publiczną, handel międzynarodowy i instrumenty ekonomicznego bezpieczeństwa, finanse publiczne oraz konkurencyjność regionu.',
      'The programme analyses EU and member-state economic policy: the single market, industrial policy and state aid, international trade and economic-security instruments, public finances and the region''s competitiveness.',
      '[{"pl":"Jak pogodzić zieloną transformację z konkurencyjnością przemysłu?","en":"How to reconcile the green transition with industrial competitiveness?"},{"pl":"Gdzie przebiegają granice de-riskingu wobec Chin?","en":"Where are the limits of de-risking from China?"},{"pl":"Czy Europa Środkowa utknie w pułapce średniego dochodu?","en":"Will Central Europe get stuck in the middle-income trap?"}]'::jsonb,
      'TrendingUp', '#065f46',
      (SELECT id FROM public.categories WHERE tenant_id = v_tenant AND slug IN ('gospodarka', 'handel') ORDER BY slug = 'gospodarka' DESC LIMIT 1),
      3, 'published'
    ),
    (
      v_tenant, 'technologia-i-cyfryzacja',
      'Technologia i cyfryzacja', 'Technology & Digital',
      'AI, dane i suwerenność technologiczna: kto ustala reguły cyfrowej Europy?',
      'AI, data and tech sovereignty: who writes the rules of digital Europe?',
      'Program bada politykę technologiczną UE: regulacje AI i platform (AI Act, DSA/DMA), suwerenność technologiczną i półprzewodniki, cyberprzestrzeń jako domenę rywalizacji oraz wpływ technologii na demokrację i rynek pracy.',
      'The programme studies EU technology policy: AI and platform regulation (AI Act, DSA/DMA), tech sovereignty and semiconductors, cyberspace as a domain of rivalry, and technology''s impact on democracy and labour markets.',
      '[{"pl":"Czy regulacje UE budują przewagę, czy zależność technologiczną?","en":"Do EU regulations build advantage or technological dependence?"},{"pl":"Jak Europa może realnie konkurować w AI i półprzewodnikach?","en":"How can Europe genuinely compete in AI and semiconductors?"},{"pl":"Jak bronić infosfery przed dezinformacją bez cenzury?","en":"How to defend the information space from disinformation without censorship?"}]'::jsonb,
      'Cpu', '#6d28d9',
      (SELECT id FROM public.categories WHERE tenant_id = v_tenant AND slug IN ('technologia', 'cyfryzacja') ORDER BY slug = 'technologia' DESC LIMIT 1),
      4, 'published'
    ),
    (
      v_tenant, 'energia-i-klimat',
      'Energia i klimat', 'Energy & Climate',
      'Bezpieczeństwo energetyczne i transformacja: jak odejść od paliw kopalnych, nie tracąc przemysłu i spójności społecznej.',
      'Energy security and transition: how to move beyond fossil fuels without losing industry or social cohesion.',
      'Program obejmuje bezpieczeństwo energetyczne regionu, transformację energetyczną i politykę klimatyczną UE (Fit for 55, ETS), energetykę jądrową i OZE, rynki energii oraz geopolitykę surowców krytycznych.',
      'The programme covers regional energy security, the energy transition and EU climate policy (Fit for 55, ETS), nuclear and renewables, energy markets and the geopolitics of critical raw materials.',
      '[{"pl":"Jak zapewnić stabilne i tanie dostawy energii w trakcie transformacji?","en":"How to keep energy secure and affordable through the transition?"},{"pl":"Jaka jest realna rola atomu w miksie energetycznym Europy Środkowej?","en":"What is the realistic role of nuclear in Central Europe''s energy mix?"},{"pl":"Kto kontroluje surowce krytyczne dla transformacji?","en":"Who controls the raw materials critical to the transition?"}]'::jsonb,
      'Zap', '#b45309',
      (SELECT id FROM public.categories WHERE tenant_id = v_tenant AND slug IN ('energia', 'energetyka', 'klimat') ORDER BY slug = 'energia' DESC LIMIT 1),
      5, 'published'
    ),
    (
      v_tenant, 'transport-i-infrastruktura',
      'Transport i infrastruktura', 'Transport & Infrastructure',
      'Korytarze, porty i mobilność wojskowa: infrastruktura jako twarda waluta geopolityki.',
      'Corridors, ports and military mobility: infrastructure as the hard currency of geopolitics.',
      'Program bada politykę transportową i infrastrukturalną: sieci TEN-T i korytarze transportowe, mobilność wojskową, porty i logistykę, kolej i lotnictwo, oraz infrastrukturę jako narzędzie integracji regionu Trójmorza.',
      'The programme examines transport and infrastructure policy: TEN-T networks and corridors, military mobility, ports and logistics, rail and aviation, and infrastructure as a tool of Three Seas regional integration.',
      '[{"pl":"Które korytarze transportowe zdecydują o pozycji regionu?","en":"Which transport corridors will define the region''s position?"},{"pl":"Jak przyspieszyć mobilność wojskową na osi północ-południe?","en":"How to accelerate military mobility along the north-south axis?"},{"pl":"Jak finansować infrastrukturę strategiczną poza cyklem politycznym?","en":"How to finance strategic infrastructure beyond the political cycle?"}]'::jsonb,
      'Route', '#0e7490',
      (SELECT id FROM public.categories WHERE tenant_id = v_tenant AND slug IN ('transport', 'infrastruktura') ORDER BY slug = 'transport' DESC LIMIT 1),
      6, 'published'
    )
  ON CONFLICT (tenant_id, slug) DO NOTHING;
END $$;
