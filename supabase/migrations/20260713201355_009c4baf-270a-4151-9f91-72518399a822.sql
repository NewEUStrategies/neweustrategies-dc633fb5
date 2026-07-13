
-- expert_expertise_areas: scope public read to current tenant via expertise_areas
DROP POLICY IF EXISTS "expert_areas public read" ON public.expert_expertise_areas;
CREATE POLICY "expert_areas public read" ON public.expert_expertise_areas
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.expertise_areas ea
      WHERE ea.id = expert_expertise_areas.area_id
        AND ea.tenant_id = public_tenant_id()
    )
  );

-- event_speakers: scope to published events in current tenant
DROP POLICY IF EXISTS "event_speakers public read" ON public.event_speakers;
CREATE POLICY "event_speakers public read" ON public.event_speakers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_speakers.event_id
        AND e.tenant_id = public_tenant_id()
        AND e.status = 'published'
    )
  );

-- post_authors: scope to published posts in current tenant
DROP POLICY IF EXISTS "post_authors public read" ON public.post_authors;
CREATE POLICY "post_authors public read" ON public.post_authors
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_authors.post_id
        AND p.tenant_id = public_tenant_id()
        AND p.status = 'published'
        AND p.deleted_at IS NULL
    )
  );

-- post_programs
DROP POLICY IF EXISTS "post_programs public read" ON public.post_programs;
CREATE POLICY "post_programs public read" ON public.post_programs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_programs.post_id
        AND p.tenant_id = public_tenant_id()
        AND p.status = 'published'
        AND p.deleted_at IS NULL
    )
  );

-- post_regions
DROP POLICY IF EXISTS "post_regions public read" ON public.post_regions;
CREATE POLICY "post_regions public read" ON public.post_regions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_regions.post_id
        AND p.tenant_id = public_tenant_id()
        AND p.status = 'published'
        AND p.deleted_at IS NULL
    )
  );

-- program_members: scope to active programs in current tenant
DROP POLICY IF EXISTS "program_members public read" ON public.program_members;
CREATE POLICY "program_members public read" ON public.program_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.programs pr
      WHERE pr.id = program_members.program_id
        AND pr.tenant_id = public_tenant_id()
        AND pr.is_active = true
    )
  );

-- Fix mutable search_path on nes_pl_light_stem
ALTER FUNCTION public.nes_pl_light_stem(text) SET search_path = public, pg_temp;
