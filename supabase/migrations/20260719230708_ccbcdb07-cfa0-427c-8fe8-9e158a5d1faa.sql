
DROP POLICY IF EXISTS "podcast_shows_public_read" ON public.podcast_shows;
CREATE POLICY "podcast_shows_public_read" ON public.podcast_shows
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND deleted_at IS NULL AND tenant_id = public_tenant_id());

DROP POLICY IF EXISTS "podcast_people_public_read" ON public.podcast_episode_people;
CREATE POLICY "podcast_people_public_read" ON public.podcast_episode_people
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = public_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.podcasts pe
      JOIN public.podcast_shows ps ON ps.id = pe.show_id
      WHERE pe.id = podcast_episode_people.episode_id
        AND ps.status = 'published'
        AND ps.deleted_at IS NULL
        AND ps.tenant_id = public_tenant_id()
    )
  );
