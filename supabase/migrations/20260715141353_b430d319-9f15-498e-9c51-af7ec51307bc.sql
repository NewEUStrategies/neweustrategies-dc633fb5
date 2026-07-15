
-- expert_expertise_areas: require the area to belong to the caller's tenant
DROP POLICY IF EXISTS "expert_areas staff manage" ON public.expert_expertise_areas;
CREATE POLICY "expert_areas staff manage tenant" ON public.expert_expertise_areas
FOR ALL
USING (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  AND EXISTS (
    SELECT 1 FROM public.expertise_areas ea
    WHERE ea.id = expert_expertise_areas.area_id
      AND ea.tenant_id = current_tenant_id()
  )
)
WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  AND EXISTS (
    SELECT 1 FROM public.expertise_areas ea
    WHERE ea.id = expert_expertise_areas.area_id
      AND ea.tenant_id = current_tenant_id()
  )
);

-- post_programs: require post's tenant to match caller's tenant
DROP POLICY IF EXISTS "post_programs staff manage" ON public.post_programs;
CREATE POLICY "post_programs staff manage tenant" ON public.post_programs
FOR ALL
USING (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role) OR has_role(auth.uid(), 'author'::app_role))
  AND EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = post_programs.post_id AND p.tenant_id = current_tenant_id()
  )
)
WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role) OR has_role(auth.uid(), 'author'::app_role))
  AND EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = post_programs.post_id AND p.tenant_id = current_tenant_id()
  )
);

-- post_authors: require post's tenant to match caller's tenant
DROP POLICY IF EXISTS "post_authors staff manage" ON public.post_authors;
CREATE POLICY "post_authors staff manage tenant" ON public.post_authors
FOR ALL
USING (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role) OR has_role(auth.uid(), 'author'::app_role))
  AND EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = post_authors.post_id AND p.tenant_id = current_tenant_id()
  )
)
WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role) OR has_role(auth.uid(), 'author'::app_role))
  AND EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = post_authors.post_id AND p.tenant_id = current_tenant_id()
  )
);

-- post_regions: require post's tenant to match caller's tenant
DROP POLICY IF EXISTS "post_regions staff manage" ON public.post_regions;
CREATE POLICY "post_regions staff manage tenant" ON public.post_regions
FOR ALL
USING (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role) OR has_role(auth.uid(), 'author'::app_role))
  AND EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = post_regions.post_id AND p.tenant_id = current_tenant_id()
  )
)
WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role) OR has_role(auth.uid(), 'author'::app_role))
  AND EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = post_regions.post_id AND p.tenant_id = current_tenant_id()
  )
);
