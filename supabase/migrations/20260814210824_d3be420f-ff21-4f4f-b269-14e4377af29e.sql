-- Re-assert tenant binding on 8 join-table policies (debt from 20260714130000_expert_hub.sql).
-- Forward-only: recreate each policy with the correct predicate.

DROP POLICY IF EXISTS "event_speakers public read" ON public.event_speakers;
CREATE POLICY "event_speakers public read" ON public.event_speakers
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.events e
           WHERE e.id = event_speakers.event_id
             AND e.tenant_id = public_tenant_id()
             AND e.status = 'published')
);

DROP POLICY IF EXISTS "event_speakers staff manage" ON public.event_speakers;
CREATE POLICY "event_speakers staff manage" ON public.event_speakers
FOR ALL TO authenticated USING (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  AND EXISTS (SELECT 1 FROM public.events e
               WHERE e.id = event_speakers.event_id
                 AND e.tenant_id = current_tenant_id())
) WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  AND EXISTS (SELECT 1 FROM public.events e
               WHERE e.id = event_speakers.event_id
                 AND e.tenant_id = current_tenant_id())
);

DROP POLICY IF EXISTS "expert_areas public read" ON public.expert_expertise_areas;
CREATE POLICY "expert_areas public read" ON public.expert_expertise_areas
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.expertise_areas ea
           WHERE ea.id = expert_expertise_areas.area_id
             AND ea.tenant_id = public_tenant_id())
);

DROP POLICY IF EXISTS "post_authors public read" ON public.post_authors;
CREATE POLICY "post_authors public read" ON public.post_authors
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.posts p
           WHERE p.id = post_authors.post_id
             AND p.tenant_id = public_tenant_id()
             AND p.status = 'published'::post_status
             AND p.deleted_at IS NULL)
);

DROP POLICY IF EXISTS "post_programs public read" ON public.post_programs;
CREATE POLICY "post_programs public read" ON public.post_programs
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.posts p
           WHERE p.id = post_programs.post_id
             AND p.tenant_id = public_tenant_id()
             AND p.status = 'published'::post_status
             AND p.deleted_at IS NULL)
);

DROP POLICY IF EXISTS "post_regions public read" ON public.post_regions;
CREATE POLICY "post_regions public read" ON public.post_regions
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.posts p
           WHERE p.id = post_regions.post_id
             AND p.tenant_id = public_tenant_id()
             AND p.status = 'published'::post_status
             AND p.deleted_at IS NULL)
);

DROP POLICY IF EXISTS "program_members public read" ON public.program_members;
CREATE POLICY "program_members public read" ON public.program_members
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.programs pr
           WHERE pr.id = program_members.program_id
             AND pr.tenant_id = public_tenant_id()
             AND pr.is_active = true)
);

DROP POLICY IF EXISTS "program_members staff write" ON public.program_members;
CREATE POLICY "program_members staff write" ON public.program_members
FOR ALL TO authenticated USING (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  AND EXISTS (SELECT 1 FROM public.programs pr
               WHERE pr.id = program_members.program_id
                 AND pr.tenant_id = current_tenant_id())
) WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  AND EXISTS (SELECT 1 FROM public.programs pr
               WHERE pr.id = program_members.program_id
                 AND pr.tenant_id = current_tenant_id())
);