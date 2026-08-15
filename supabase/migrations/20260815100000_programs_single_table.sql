-- ============================================================================
-- JEDNA TABELA PROGRAMÓW ZAMIAST DWÓCH RÓWNOLEGŁYCH
--
-- CO BYŁO ZEPSUTE (siódme wydanie audytu, OCENA_FUNKCJI_TABELE §Programy)
-- Od 13/14.07 żyją obok siebie DWIE tabele opisujące ten sam byt:
--
--   public.programs           (20260713175104) - słownik przynależności:
--       slug, name_pl/en, kind (program|project|department), description,
--       cover_url, is_active. Spinają się z nim `program_members`,
--       `post_programs`, `podcasts.program_id`, `events.program_id`
--       oraz ~10 funkcji SECURITY DEFINER huba eksperta.
--
--   public.research_programs  (20260713181044) - hub redakcyjny:
--       tagline, scope, research_questions, icon, accent_color, hero_image,
--       category_id, contact_email, status (draft|published|archived).
--       Spinają się z nim `research_program_{members,projects,partners,items}`,
--       publiczne `/programs`, RSS per program, sitemap i kotwice klubów.
--
-- Skutek: ten sam program badawczy istniał jako DWA wiersze w DWÓCH tabelach,
-- z osobnymi slugami, osobnym sortowaniem i osobnym cyklem życia. Redakcja
-- zmieniała nazwę w jednym miejscu, a drugie zostawało - i nie było sposobu,
-- żeby powiedzieć, które jest prawdziwe.
--
-- ── KIERUNEK SCALENIA I DLACZEGO TEN ────────────────────────────────────────
-- Zostaje `public.programs` jako JEDYNA TABELA, `research_programs` staje się
-- WIDOKIEM na nią. Wybór jest podyktowany masą zależności, nie sympatią:
--
--   * na `programs` wskazują CZTERY klucze obce z tabel treści
--     (`program_members`, `post_programs`, `podcasts`, `events`) - widok nie
--     może być celem klucza obcego, więc odwrotny kierunek wymagałby
--     przepięcia FK na tabelach `posts`/`podcasts`/`events`;
--   * `public.programs` czyta ~10 funkcji SECURITY DEFINER huba eksperta
--     (`get_expert_hub`, `get_expert_materials`, izolacja kontaktu autora,
--     nadpisania układu eksperta) - odwrotny kierunek to przepisanie ich
--     wszystkich, czyli zmiana granicy bezpieczeństwa przy okazji porządków
--     w słowniku. Najgorszy możliwy moment na taką zmianę;
--   * `research_programs` czytają WYŁĄCZNIE SELECT-y (publiczny hub, RSS,
--     sitemap, etykieta kotwicy klubu) plus CRUD panelu redakcji - a widok
--     automatycznie aktualizowalny obsługuje jedno i drugie bez zmiany
--     ani jednej linii klienta.
--
-- Po tej migracji `research_programs` jest widokiem o IDENTYCZNEJ liście
-- kolumn, więc `src/lib/queries/programs.ts`, `admin.research-programs.tsx`,
-- sitemapa i kanały RSS działają bez zmian - ale czytają i piszą do TEJ SAMEJ
-- tabeli, co hub eksperta. Dwóch źródeł prawdy już nie ma.
--
-- ── DLACZEGO IDENTYFIKATORY SĄ ZACHOWANE ────────────────────────────────────
-- Wiersze `research_programs` wjeżdżają do `programs` ZE SWOIM `id`. Dzięki
-- temu nie trzeba przepisywać niczego, co trzyma ten identyfikator poza
-- kluczem obcym: kotwic wątków klubowych (`club_threads.anchor_id` to `text`,
-- bez FK), zapisanych filtrów, linków w treści. Remap dotyczy WYŁĄCZNIE
-- programów, które istniały w obu tabelach pod tym samym slugiem - a to jest
-- dokładnie ta para, którą scalamy świadomie.
--
-- ── BEZPIECZEŃSTWO: DWIE DZIURY DOMKNIĘTE PRZY OKAZJI ───────────────────────
--   1. `programs public read` nie filtrował po statusie (bo statusu nie było),
--      więc anon czytał programy `is_active = false`. Po scaleniu czyta
--      wyłącznie `status = 'published'` - inaczej widok wypuściłby SZKICE
--      hubów redakcyjnych, których stara polityka `research_programs`
--      pilnowała, a `programs` nie.
--   2. `program_members public read` stało na `USING (true)` - bez tenanta.
--      Członkostwo w programie było widoczne między najemcami. Teraz jest
--      związane tenantem programu, tak jak reszta rodziny.
--
-- Widok MUSI mieć `security_invoker = true`. Bez tego działa z uprawnieniami
-- właściciela (postgres), czyli OMIJA RLS tabeli bazowej - i zamiast domknąć
-- izolację, otworzyłby ją na oścież.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. EXPAND - `programs` dostaje kolumny redakcyjne
-- ---------------------------------------------------------------------------
ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS tagline_pl text,
  ADD COLUMN IF NOT EXISTS tagline_en text,
  ADD COLUMN IF NOT EXISTS scope_pl text,
  ADD COLUMN IF NOT EXISTS scope_en text,
  ADD COLUMN IF NOT EXISTS research_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT 'Compass',
  ADD COLUMN IF NOT EXISTS accent_color text NOT NULL DEFAULT '#1e3a8a',
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Istniejące wiersze słownika dostają status wyprowadzony z `is_active`.
-- `is_active = false` to `archived`, nie `draft`: te programy BYŁY publiczne,
-- więc szkic byłby przekłamaniem historii.
UPDATE public.programs
   SET status = CASE WHEN is_active THEN 'published' ELSE 'archived' END
 WHERE status = 'published' AND NOT is_active;

ALTER TABLE public.programs DROP CONSTRAINT IF EXISTS programs_status_check;
ALTER TABLE public.programs
  ADD CONSTRAINT programs_status_check CHECK (status IN ('draft', 'published', 'archived'));

ALTER TABLE public.programs DROP CONSTRAINT IF EXISTS programs_accent_color_check;
ALTER TABLE public.programs
  ADD CONSTRAINT programs_accent_color_check CHECK (accent_color ~* '^#[0-9a-f]{6}$');

ALTER TABLE public.programs DROP CONSTRAINT IF EXISTS programs_research_questions_check;
ALTER TABLE public.programs
  ADD CONSTRAINT programs_research_questions_check
  CHECK (jsonb_typeof(research_questions) = 'array');

-- Slug: `programs` dopuszczał 2-80 znaków, `research_programs` 3-120. Suma obu
-- zbiorów to 2-120 - inaczej program badawczy o dłuższym slugu nie przeszedłby
-- scalenia i migracja wywaliłaby się na danych produkcyjnych, nie na teście.
-- CHECK z `CREATE TABLE` jest bezimienny, więc szukamy go po definicji.
DO $slug$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.programs'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%slug%'
  LOOP
    EXECUTE format('ALTER TABLE public.programs DROP CONSTRAINT %I', v_name);
  END LOOP;
END
$slug$;

ALTER TABLE public.programs
  ADD CONSTRAINT programs_slug_check CHECK (slug ~ '^[a-z0-9-]{2,120}$');

CREATE INDEX IF NOT EXISTS idx_programs_tenant_status
  ON public.programs (tenant_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_programs_category
  ON public.programs (category_id) WHERE category_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. `status` jest kanoniczny, `is_active` jest z niego wyprowadzany
-- ---------------------------------------------------------------------------
-- Kolumna GENERATED byłaby czystsza, ale odrzuca jawny zapis - a panel
-- `/admin/programs` przełącza właśnie `is_active`. Trigger godzi obu pisarzy
-- i gwarantuje, że kolumny NIE MOGĄ się rozjechać, niezależnie od tego, którą
-- z nich ustawi wołający.
CREATE OR REPLACE FUNCTION public.tg_programs_status_active_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Jawne `is_active = false` przy domyślnym statusie znaczy „nie publikuj".
    IF NOT NEW.is_active AND NEW.status = 'published' THEN
      NEW.status := 'archived';
    END IF;
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    -- Pisarz ruszył wyłącznie starą kolumną - przenosimy intencję na status.
    NEW.status := CASE WHEN NEW.is_active THEN 'published' ELSE 'archived' END;
  END IF;

  NEW.is_active := (NEW.status = 'published');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS programs_status_active_sync ON public.programs;
CREATE TRIGGER programs_status_active_sync
  BEFORE INSERT OR UPDATE ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.tg_programs_status_active_sync();

UPDATE public.programs SET is_active = (status = 'published') WHERE is_active <> (status = 'published');

-- ---------------------------------------------------------------------------
-- 3. MIGRATE - wiersze hubów redakcyjnych wjeżdżają do `programs`
-- ---------------------------------------------------------------------------
-- Mapa `stare id -> id po scaleniu`. Kolizja slugów w obrębie tenanta znaczy
-- „to jest ten sam program opisany dwa razy" - zostaje wiersz ze słownika
-- (bo to na niego wskazują klucze obce treści), a dane redakcyjne są na niego
-- przenoszone.
-- Tabela tymczasowa jest SESYJNA, nie `ON COMMIT DROP`: migracje bywają
-- podawane statement-per-transaction (tak robi `psql -f` bez `-1`), a wtedy
-- `ON COMMIT DROP` skasowałby mapę zaraz po jej utworzeniu. Sprzątamy jawnie
-- na końcu pliku.
DROP TABLE IF EXISTS program_merge_map;
CREATE TEMP TABLE program_merge_map AS
SELECT r.id AS old_id, COALESCE(p.id, r.id) AS new_id
  FROM public.research_programs r
  LEFT JOIN public.programs p
    ON p.tenant_id = r.tenant_id AND p.slug = r.slug;

-- 3a. Programy istniejące w obu tabelach: dosypujemy warstwę redakcyjną.
UPDATE public.programs p
   SET status             = r.status,
       tagline_pl         = COALESCE(p.tagline_pl, r.tagline_pl),
       tagline_en         = COALESCE(p.tagline_en, r.tagline_en),
       scope_pl           = COALESCE(p.scope_pl, r.scope_pl),
       scope_en           = COALESCE(p.scope_en, r.scope_en),
       research_questions = CASE
                              WHEN p.research_questions = '[]'::jsonb THEN r.research_questions
                              ELSE p.research_questions
                            END,
       icon               = r.icon,
       accent_color       = r.accent_color,
       hero_image_url     = COALESCE(p.hero_image_url, r.hero_image_url),
       category_id        = COALESCE(p.category_id, r.category_id),
       contact_email      = COALESCE(p.contact_email, r.contact_email),
       created_by         = COALESCE(p.created_by, r.created_by)
  FROM public.research_programs r
  JOIN program_merge_map m ON m.old_id = r.id
 WHERE p.id = m.new_id AND m.new_id <> m.old_id;

-- 3b. Programy wyłącznie redakcyjne: wjeżdżają ZE SWOIM identyfikatorem.
--     `kind = 'program'`, bo hub badawczy nigdy nie był projektem ani
--     departamentem - te dwa rodzaje istnieją wyłącznie po stronie słownika.
INSERT INTO public.programs (
  id, tenant_id, slug, name_pl, name_en, kind,
  description_pl, description_en, cover_url, is_active, sort_order,
  status, tagline_pl, tagline_en, scope_pl, scope_en, research_questions,
  icon, accent_color, hero_image_url, category_id, contact_email, created_by,
  created_at, updated_at
)
SELECT r.id, r.tenant_id, r.slug, r.name_pl, r.name_en, 'program',
       r.scope_pl, r.scope_en, r.hero_image_url, (r.status = 'published'), r.sort_order,
       r.status, r.tagline_pl, r.tagline_en, r.scope_pl, r.scope_en, r.research_questions,
       r.icon, r.accent_color, r.hero_image_url, r.category_id, r.contact_email, r.created_by,
       r.created_at, r.updated_at
  FROM public.research_programs r
  JOIN program_merge_map m ON m.old_id = r.id AND m.new_id = m.old_id
 WHERE NOT EXISTS (SELECT 1 FROM public.programs p WHERE p.id = r.id);

-- ---------------------------------------------------------------------------
-- 4. REPOINT - dzieci hubów wskazują na `programs`
-- ---------------------------------------------------------------------------
-- KOLEJNOŚĆ MA ZNACZENIE i nie jest oczywista: stary klucz obcy trzeba zdjąć
-- PRZED przepisaniem identyfikatorów. Wiersz po scaleniu żyje w `programs`,
-- a nie w `research_programs`, więc `UPDATE` wykonany wcześniej wywala się
-- na 23503 („Key (program_id)=… is not present in table research_programs").
-- Ten błąd wyszedł dopiero na harnessie - w tekście migracji wygląda dobrze.
DO $fk_drop$
DECLARE
  v_table text;
  v_name  text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['research_program_members', 'research_program_projects',
                                 'research_program_partners', 'research_program_items']
  LOOP
    FOR v_name IN
      SELECT conname FROM pg_constraint
       WHERE conrelid = format('public.%I', v_table)::regclass
         AND contype = 'f'
         AND confrelid = 'public.research_programs'::regclass
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_table, v_name);
    END LOOP;
  END LOOP;
END
$fk_drop$;

UPDATE public.research_program_members c SET program_id = m.new_id
  FROM program_merge_map m WHERE c.program_id = m.old_id AND m.new_id <> m.old_id;
UPDATE public.research_program_projects c SET program_id = m.new_id
  FROM program_merge_map m WHERE c.program_id = m.old_id AND m.new_id <> m.old_id;
UPDATE public.research_program_partners c SET program_id = m.new_id
  FROM program_merge_map m WHERE c.program_id = m.old_id AND m.new_id <> m.old_id;
UPDATE public.research_program_items c SET program_id = m.new_id
  FROM program_merge_map m WHERE c.program_id = m.old_id AND m.new_id <> m.old_id;

-- Scalenie mogło zdublować członka albo pozycję w obrębie jednego programu -
-- unikalność (program_id, profile_id) / (program_id, post_id) jest wymuszona
-- indeksem, więc duplikaty trzeba zdjąć PRZED założeniem klucza obcego.
DELETE FROM public.research_program_members a
 USING public.research_program_members b
 WHERE a.program_id = b.program_id AND a.profile_id = b.profile_id AND a.ctid > b.ctid;

DO $fk_add$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['research_program_members', 'research_program_projects',
                                 'research_program_partners', 'research_program_items']
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (program_id)
         REFERENCES public.programs(id) ON DELETE CASCADE',
      v_table, v_table || '_program_id_fkey'
    );
  END LOOP;
END
$fk_add$;

-- Tenant dziecka nadal dziedziczony z programu - tylko źródłem jest teraz
-- jedyna tabela programów.
CREATE OR REPLACE FUNCTION public.tg_research_program_child_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.programs WHERE id = NEW.program_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'program % not found', NEW.program_id;
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Polityki dzieci - przepisane na `programs` PRZED usunięciem starej tabeli
-- ---------------------------------------------------------------------------
-- Polityka odwołująca się do tabeli jest jej zależnością: bez tego kroku
-- `DROP TABLE` padłby na 2BP01, a `CASCADE` po cichu skasowałby publiczny
-- odczyt czterech tabel.
DROP POLICY IF EXISTS "program members public read" ON public.research_program_members;
CREATE POLICY "program members public read" ON public.research_program_members
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.programs p
       WHERE p.id = research_program_members.program_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS "program projects public read" ON public.research_program_projects;
CREATE POLICY "program projects public read" ON public.research_program_projects
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.programs p
       WHERE p.id = research_program_projects.program_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS "program partners public read" ON public.research_program_partners;
CREATE POLICY "program partners public read" ON public.research_program_partners
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.programs p
       WHERE p.id = research_program_partners.program_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS "program items public read" ON public.research_program_items;
CREATE POLICY "program items public read" ON public.research_program_items
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.programs p
       WHERE p.id = research_program_items.program_id AND p.status = 'published'
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Polityki `programs` - status zamiast braku filtra + tenant w członkostwie
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "programs public read" ON public.programs;
CREATE POLICY "programs public read" ON public.programs
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "programs staff write" ON public.programs;
CREATE POLICY "programs staff write" ON public.programs
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

-- `USING (true)` puszczało członkostwo w programie MIĘDZY NAJEMCAMI. Wiąże je
-- tenant programu - jedyna droga, bo `program_members` nie ma własnej kolumny
-- tenanta (PK to (program_id, user_id)).
DROP POLICY IF EXISTS "program_members public read" ON public.program_members;
CREATE POLICY "program_members public read" ON public.program_members
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.programs p
       WHERE p.id = program_members.program_id
         AND p.tenant_id = (SELECT public.public_tenant_id())
         AND p.status = 'published'
    )
  );

-- ---------------------------------------------------------------------------
-- 7. CONTRACT - `research_programs` przestaje być tabelą, zostaje widokiem
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.research_programs;

CREATE VIEW public.research_programs
WITH (security_invoker = true) AS
SELECT id,
       tenant_id,
       slug,
       name_pl,
       name_en,
       tagline_pl,
       tagline_en,
       scope_pl,
       scope_en,
       research_questions,
       icon,
       accent_color,
       hero_image_url,
       category_id,
       contact_email,
       sort_order,
       status,
       created_by,
       created_at,
       updated_at
  FROM public.programs;

COMMENT ON VIEW public.research_programs IS
  'WIDOK zgodnosci na public.programs (jedyna tabela programow od 20260815100000). Automatycznie aktualizowalny, security_invoker = true, wiec RLS tabeli bazowej obowiazuje bez zmian. Istnieje po to, zeby publiczny hub /programs, RSS, sitemapa i panel redakcji czytaly i pisaly do tego samego wiersza, co hub eksperta - a nie do drugiej, rownoleglej tabeli.';

GRANT SELECT ON public.research_programs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.research_programs TO authenticated;
GRANT ALL ON public.research_programs TO service_role;

COMMENT ON TABLE public.programs IS
  'Jedyna tabela programow: slownik przynaleznosci (kind, is_active) ORAZ hub redakcyjny (status, tagline, scope, research_questions, icon, accent_color). Scalone 20260815100000 z public.research_programs, ktore od tej pory jest widokiem zgodnosci. status jest kanoniczny; is_active wyprowadza z niego trigger programs_status_active_sync i kolumny nie moga sie rozjechac.';

COMMENT ON COLUMN public.programs.is_active IS
  'Wyprowadzane z `status` triggerem programs_status_active_sync. Zapis wolno, ale zostanie znormalizowany do (status = ''published'').';

-- ---------------------------------------------------------------------------
-- 8. Funkcje SECURITY DEFINER czytają jedyną tabelę, nie widok zgodności
-- ---------------------------------------------------------------------------
-- Widok wystarczyłby technicznie, ale bramka `check:rpc-contract` ma rację
-- pilnując tego wprost: ciała plpgsql/sql NIE są walidowane przy
-- `CREATE FUNCTION`, więc funkcja celująca w relację, która zmieniła naturę,
-- odzywa się dopiero przy wywołaniu - i to na świeżej bazie, u użytkownika.
-- Dwie funkcje w stanie końcowym czytały `research_programs`; przepięte
-- na `programs` razem z warunkiem `status = 'published'`, który po scaleniu
-- żyje na tej samej tabeli.

-- Etykieta kotwicy wątku klubowego (kopia z 20260808280000 - zmieniona
-- WYŁĄCZNIE relacja w gałęzi 'research_program').
CREATE OR REPLACE FUNCTION public.club_anchor_label(p_type text, p_id text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
BEGIN
  IF p_type IS NULL OR NULLIF(btrim(COALESCE(p_id, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;

  CASE p_type
    WHEN 'eu_policy_item' THEN
      SELECT COALESCE(NULLIF(btrim(i.title_pl), ''), NULLIF(btrim(i.title_en), ''))
        INTO v_label FROM public.eu_policy_items i WHERE i.id = p_id::uuid;
    WHEN 'post' THEN
      SELECT COALESCE(NULLIF(btrim(p.title_pl), ''), NULLIF(btrim(p.title_en), ''), p.slug)
        INTO v_label FROM public.posts p
       WHERE p.id = p_id::uuid AND p.deleted_at IS NULL;
    WHEN 'event' THEN
      SELECT COALESCE(NULLIF(btrim(e.title_pl), ''), NULLIF(btrim(e.title_en), ''), e.slug)
        INTO v_label FROM public.events e WHERE e.id = p_id::uuid;
    -- Programy nazywają kolumny `name_*`, nie `title_*` - różnica, która nie
    -- odezwałaby się przy CREATE, tylko przy pierwszym wątku zakotwiczonym
    -- w programie (ciało plpgsql nie jest walidowane).
    WHEN 'research_program' THEN
      SELECT COALESCE(NULLIF(btrim(r.name_pl), ''), NULLIF(btrim(r.name_en), ''), r.slug)
        INTO v_label FROM public.programs r WHERE r.id = p_id::uuid;
    WHEN 'club_thread' THEN
      v_label := public.club_linked_item_label('club_thread', p_id);
    ELSE
      v_label := NULL;
  END CASE;

  RETURN v_label;
EXCEPTION WHEN OTHERS THEN
  -- Kotwica wskazująca na skasowaną treść nie może wywalić CAŁEJ listy wątków.
  RETURN NULL;
END;
$$;

-- Zespół programu (kopia z 20260714130000 - zmieniona WYŁĄCZNIE relacja).
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
    JOIN public.programs p ON p.id = m.program_id
    JOIN public.profiles pr ON pr.id = m.profile_id
   WHERE m.program_id = ANY (p_program_ids)
     AND p.tenant_id = public.public_tenant_id()
     AND p.status = 'published'
   ORDER BY m.is_lead DESC, m.sort_order, m.created_at;
$$;

REVOKE EXECUTE ON FUNCTION public.get_program_members(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_program_members(uuid[])
  TO anon, authenticated, service_role;

DROP TABLE IF EXISTS program_merge_map;
