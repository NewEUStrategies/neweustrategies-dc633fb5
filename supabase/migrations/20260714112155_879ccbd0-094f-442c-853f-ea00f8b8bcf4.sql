
-- 1. media_folders: restrict management policies to authenticated role
DROP POLICY IF EXISTS "media_folders tenant delete" ON public.media_folders;
DROP POLICY IF EXISTS "media_folders tenant insert" ON public.media_folders;
DROP POLICY IF EXISTS "media_folders tenant update" ON public.media_folders;

CREATE POLICY "media_folders tenant delete" ON public.media_folders
  FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id()
         AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

CREATE POLICY "media_folders tenant insert" ON public.media_folders
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id()
              AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role) OR has_role(auth.uid(), 'author'::app_role)));

CREATE POLICY "media_folders tenant update" ON public.media_folders
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id()
         AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)))
  WITH CHECK (tenant_id = current_tenant_id()
              AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

-- 2. personality_questions: restrict SELECT to authenticated users
DROP POLICY IF EXISTS "public read questions" ON public.personality_questions;
CREATE POLICY "authenticated read questions" ON public.personality_questions
  FOR SELECT TO authenticated
  USING (true);

-- 3. post_categories / post_tags: add explicit staff role check to ALL policies
DROP POLICY IF EXISTS "post_categories staff manage tenant" ON public.post_categories;
CREATE POLICY "post_categories staff manage tenant" ON public.post_categories
  FOR ALL TO authenticated
  USING (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role) OR has_role(auth.uid(), 'author'::app_role))
    AND EXISTS (SELECT 1 FROM posts p WHERE p.id = post_categories.post_id AND p.tenant_id = current_tenant_id())
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role) OR has_role(auth.uid(), 'author'::app_role))
    AND EXISTS (SELECT 1 FROM posts p WHERE p.id = post_categories.post_id AND p.tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS "post_tags staff manage tenant" ON public.post_tags;
CREATE POLICY "post_tags staff manage tenant" ON public.post_tags
  FOR ALL TO authenticated
  USING (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role) OR has_role(auth.uid(), 'author'::app_role))
    AND EXISTS (SELECT 1 FROM posts p WHERE p.id = post_tags.post_id AND p.tenant_id = current_tenant_id())
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role) OR has_role(auth.uid(), 'author'::app_role))
    AND EXISTS (SELECT 1 FROM posts p WHERE p.id = post_tags.post_id AND p.tenant_id = current_tenant_id())
  );

-- 4. profile_badges: hide note/granted_by from anon (column-level revoke)
REVOKE SELECT (note, granted_by) ON public.profile_badges FROM anon;

-- 5. research_programs: staff read must be tenant-scoped
DROP POLICY IF EXISTS "research_programs staff read all" ON public.research_programs;
CREATE POLICY "research_programs staff read tenant" ON public.research_programs
  FOR SELECT TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  );

-- 6. Add tenant scoping to staff write policies via parent join
DROP POLICY IF EXISTS "rpi staff write" ON public.research_program_items;
CREATE POLICY "rpi staff write" ON public.research_program_items
  FOR ALL TO authenticated
  USING (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND EXISTS (SELECT 1 FROM public.research_programs p WHERE p.id = research_program_items.program_id AND p.tenant_id = current_tenant_id())
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND EXISTS (SELECT 1 FROM public.research_programs p WHERE p.id = research_program_items.program_id AND p.tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS "rpm staff write" ON public.research_program_members;
CREATE POLICY "rpm staff write" ON public.research_program_members
  FOR ALL TO authenticated
  USING (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND EXISTS (SELECT 1 FROM public.research_programs p WHERE p.id = research_program_members.program_id AND p.tenant_id = current_tenant_id())
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND EXISTS (SELECT 1 FROM public.research_programs p WHERE p.id = research_program_members.program_id AND p.tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS "rppart staff write" ON public.research_program_partners;
CREATE POLICY "rppart staff write" ON public.research_program_partners
  FOR ALL TO authenticated
  USING (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND EXISTS (SELECT 1 FROM public.research_programs p WHERE p.id = research_program_partners.program_id AND p.tenant_id = current_tenant_id())
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND EXISTS (SELECT 1 FROM public.research_programs p WHERE p.id = research_program_partners.program_id AND p.tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS "rpp staff write" ON public.research_program_projects;
CREATE POLICY "rpp staff write" ON public.research_program_projects
  FOR ALL TO authenticated
  USING (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND EXISTS (SELECT 1 FROM public.research_programs p WHERE p.id = research_program_projects.program_id AND p.tenant_id = current_tenant_id())
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND EXISTS (SELECT 1 FROM public.research_programs p WHERE p.id = research_program_projects.program_id AND p.tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS "event_speakers staff manage" ON public.event_speakers;
CREATE POLICY "event_speakers staff manage" ON public.event_speakers
  FOR ALL TO authenticated
  USING (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_speakers.event_id AND e.tenant_id = current_tenant_id())
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_speakers.event_id AND e.tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS "program_members staff write" ON public.program_members;
CREATE POLICY "program_members staff write" ON public.program_members
  FOR ALL TO authenticated
  USING (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND EXISTS (SELECT 1 FROM public.programs pr WHERE pr.id = program_members.program_id AND pr.tenant_id = current_tenant_id())
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND EXISTS (SELECT 1 FROM public.programs pr WHERE pr.id = program_members.program_id AND pr.tenant_id = current_tenant_id())
  );
