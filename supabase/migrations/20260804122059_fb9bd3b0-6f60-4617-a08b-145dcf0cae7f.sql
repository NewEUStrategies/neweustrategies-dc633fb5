-- 1) media
DROP POLICY IF EXISTS "media public read" ON public.media;

CREATE POLICY "media public read"
  ON public.media
  FOR SELECT
  TO anon, authenticated
  USING (tenant_id = public.public_tenant_id() AND deleted_at IS NULL);

DROP POLICY IF EXISTS "media staff read tenant" ON public.media;
CREATE POLICY "media staff read tenant"
  ON public.media
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
      OR public.has_role(auth.uid(), 'author'::app_role)
      OR uploader_id = auth.uid()
    )
  );

REVOKE ALL ON public.media FROM anon;
REVOKE ALL ON public.media FROM authenticated;
GRANT SELECT ON public.media TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media TO authenticated;
GRANT ALL ON public.media TO service_role;

-- 2) poll_votes
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.poll_votes FROM anon, authenticated;
GRANT SELECT ON public.poll_votes TO authenticated;
GRANT ALL ON public.poll_votes TO service_role;
COMMENT ON TABLE public.poll_votes IS 'Votes are written exclusively by public.vote_poll() (SECURITY DEFINER). Direct client writes are revoked by design.';

-- 3) speaker_profiles
REVOKE ALL ON public.speaker_profiles FROM anon, authenticated;
GRANT SELECT (
  id, tenant_id, user_id, is_public, headline_pl, headline_en, bio_pl, bio_en,
  topics_pl, topics_en, languages, talks_count, rating, reviews_count,
  created_at, updated_at
) ON public.speaker_profiles TO authenticated;
GRANT ALL ON public.speaker_profiles TO service_role;
COMMENT ON COLUMN public.speaker_profiles.crm_lead_id IS 'Internal CRM identifier - readable only by service_role / SECURITY DEFINER admin RPCs.';