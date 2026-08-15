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

UPDATE public.programs
SET status = CASE WHEN is_active THEN 'published' ELSE 'archived' END
WHERE status = 'published' AND NOT is_active;

ALTER TABLE public.programs DROP CONSTRAINT IF EXISTS programs_status_check;
ALTER TABLE public.programs ADD CONSTRAINT programs_status_check CHECK (status IN ('draft','published','archived'));
ALTER TABLE public.programs DROP CONSTRAINT IF EXISTS programs_accent_color_check;
ALTER TABLE public.programs ADD CONSTRAINT programs_accent_color_check CHECK (accent_color ~* '^#[0-9a-f]{6}$');
ALTER TABLE public.programs DROP CONSTRAINT IF EXISTS programs_research_questions_check;
ALTER TABLE public.programs ADD CONSTRAINT programs_research_questions_check CHECK (jsonb_typeof(research_questions) = 'array');

DO $slug$
DECLARE v_name text;
BEGIN
  FOR v_name IN SELECT conname FROM pg_constraint WHERE conrelid='public.programs'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%slug%'
  LOOP EXECUTE format('ALTER TABLE public.programs DROP CONSTRAINT %I',v_name); END LOOP;
END
$slug$;
ALTER TABLE public.programs ADD CONSTRAINT programs_slug_check CHECK (slug ~ '^[a-z0-9-]{2,120}$');
CREATE INDEX IF NOT EXISTS idx_programs_tenant_status ON public.programs(tenant_id,status,sort_order);
CREATE INDEX IF NOT EXISTS idx_programs_category ON public.programs(category_id) WHERE category_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_programs_status_active_sync()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT NEW.is_active AND NEW.status='published' THEN NEW.status:='archived'; END IF;
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    NEW.status:=CASE WHEN NEW.is_active THEN 'published' ELSE 'archived' END;
  END IF;
  NEW.is_active:=(NEW.status='published');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS programs_status_active_sync ON public.programs;
CREATE TRIGGER programs_status_active_sync BEFORE INSERT OR UPDATE ON public.programs FOR EACH ROW EXECUTE FUNCTION public.tg_programs_status_active_sync();
UPDATE public.programs SET is_active=(status='published') WHERE is_active<>(status='published');

CREATE TEMP TABLE program_merge_map AS
SELECT r.id old_id,COALESCE(p.id,r.id) new_id
FROM public.research_programs r
LEFT JOIN public.programs p ON p.tenant_id=r.tenant_id AND p.slug=r.slug;

UPDATE public.programs p SET
 status=r.status,tagline_pl=COALESCE(p.tagline_pl,r.tagline_pl),tagline_en=COALESCE(p.tagline_en,r.tagline_en),
 scope_pl=COALESCE(p.scope_pl,r.scope_pl),scope_en=COALESCE(p.scope_en,r.scope_en),
 research_questions=CASE WHEN p.research_questions='[]'::jsonb THEN r.research_questions ELSE p.research_questions END,
 icon=r.icon,accent_color=r.accent_color,hero_image_url=COALESCE(p.hero_image_url,r.hero_image_url),
 category_id=COALESCE(p.category_id,r.category_id),contact_email=COALESCE(p.contact_email,r.contact_email)
FROM public.research_programs r JOIN program_merge_map m ON m.old_id=r.id
WHERE p.id=m.new_id AND m.new_id<>m.old_id;

INSERT INTO public.programs(id,tenant_id,slug,name_pl,name_en,kind,description_pl,description_en,cover_url,is_active,sort_order,status,tagline_pl,tagline_en,scope_pl,scope_en,research_questions,icon,accent_color,hero_image_url,category_id,contact_email,created_by,created_at,updated_at)
SELECT r.id,r.tenant_id,r.slug,r.name_pl,r.name_en,'program',r.scope_pl,r.scope_en,r.hero_image_url,(r.status='published'),r.sort_order,r.status,r.tagline_pl,r.tagline_en,r.scope_pl,r.scope_en,r.research_questions,r.icon,r.accent_color,r.hero_image_url,r.category_id,r.contact_email,NULL,r.created_at,r.updated_at
FROM public.research_programs r JOIN program_merge_map m ON m.old_id=r.id AND m.new_id=m.old_id
WHERE NOT EXISTS(SELECT 1 FROM public.programs p WHERE p.id=r.id);

DO $fk_drop$
DECLARE v_table text;v_name text;
BEGIN
 FOREACH v_table IN ARRAY ARRAY['research_program_members','research_program_projects','research_program_partners','research_program_items'] LOOP
  FOR v_name IN SELECT conname FROM pg_constraint WHERE conrelid=format('public.%I',v_table)::regclass AND contype='f' AND confrelid='public.research_programs'::regclass
  LOOP EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',v_table,v_name); END LOOP;
 END LOOP;
END
$fk_drop$;

UPDATE public.research_program_members c SET program_id=m.new_id FROM program_merge_map m WHERE c.program_id=m.old_id AND m.new_id<>m.old_id;
UPDATE public.research_program_projects c SET program_id=m.new_id FROM program_merge_map m WHERE c.program_id=m.old_id AND m.new_id<>m.old_id;
UPDATE public.research_program_partners c SET program_id=m.new_id FROM program_merge_map m WHERE c.program_id=m.old_id AND m.new_id<>m.old_id;
UPDATE public.research_program_items c SET program_id=m.new_id FROM program_merge_map m WHERE c.program_id=m.old_id AND m.new_id<>m.old_id;
DELETE FROM public.research_program_members a USING public.research_program_members b WHERE a.program_id=b.program_id AND a.profile_id=b.profile_id AND a.ctid>b.ctid;

DO $fk_add$
DECLARE v_table text;
BEGIN
 FOREACH v_table IN ARRAY ARRAY['research_program_members','research_program_projects','research_program_partners','research_program_items'] LOOP
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(program_id) REFERENCES public.programs(id) ON DELETE CASCADE',v_table,v_table||'_program_id_fkey');
 END LOOP;
END
$fk_add$;

CREATE OR REPLACE FUNCTION public.tg_research_program_child_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tenant uuid;
BEGIN
 SELECT tenant_id INTO v_tenant FROM public.programs WHERE id=NEW.program_id;
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'program % not found',NEW.program_id; END IF;
 NEW.tenant_id:=v_tenant; RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "programs public read" ON public.programs;
CREATE POLICY "programs public read" ON public.programs FOR SELECT TO anon,authenticated USING(status='published' AND tenant_id=(SELECT public.public_tenant_id()));
DROP POLICY IF EXISTS "programs staff write" ON public.programs;
CREATE POLICY "programs staff write" ON public.programs FOR ALL TO authenticated
USING(tenant_id=(SELECT public.current_tenant_id()) AND (public.has_role((SELECT auth.uid()),'admin'::app_role) OR public.has_role((SELECT auth.uid()),'editor'::app_role)))
WITH CHECK(tenant_id=(SELECT public.current_tenant_id()) AND (public.has_role((SELECT auth.uid()),'admin'::app_role) OR public.has_role((SELECT auth.uid()),'editor'::app_role)));
DROP POLICY IF EXISTS "program_members public read" ON public.program_members;
CREATE POLICY "program_members public read" ON public.program_members FOR SELECT TO anon,authenticated USING(EXISTS(SELECT 1 FROM public.programs p WHERE p.id=program_members.program_id AND p.tenant_id=(SELECT public.public_tenant_id()) AND p.status='published'));

DROP TABLE public.research_programs;
CREATE VIEW public.research_programs WITH(security_invoker=true) AS
SELECT id,tenant_id,slug,name_pl,name_en,tagline_pl,tagline_en,scope_pl,scope_en,research_questions,icon,accent_color,hero_image_url,category_id,contact_email,sort_order,status,created_by,created_at,updated_at FROM public.programs;
GRANT SELECT ON public.research_programs TO anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON public.research_programs TO authenticated;
GRANT ALL ON public.research_programs TO service_role;

CREATE OR REPLACE FUNCTION public.get_program_members(p_program_ids uuid[])
RETURNS TABLE(program_id uuid,profile_id uuid,display_name text,avatar_url text,job_title text,profile_slug text,member_role_pl text,member_role_en text,is_lead boolean,sort_order integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT m.program_id,m.profile_id,COALESCE(NULLIF(btrim(pr.display_name),''),NULLIF(btrim(concat_ws(' ',pr.first_name,pr.last_name)),''),'NES'),pr.avatar_url,pr.job_title,pr.slug,m.member_role_pl,m.member_role_en,m.is_lead,m.sort_order
 FROM public.research_program_members m JOIN public.programs p ON p.id=m.program_id JOIN public.profiles pr ON pr.id=m.profile_id
 WHERE m.program_id=ANY(p_program_ids) AND p.tenant_id=public.public_tenant_id() AND p.status='published'
 ORDER BY m.is_lead DESC,m.sort_order,m.created_at;
$$;
REVOKE EXECUTE ON FUNCTION public.get_program_members(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_program_members(uuid[]) TO anon,authenticated,service_role;
DROP TABLE program_merge_map;