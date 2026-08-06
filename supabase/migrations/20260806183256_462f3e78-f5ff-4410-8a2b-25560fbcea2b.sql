CREATE OR REPLACE FUNCTION public.profile_has_public_presence(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
COST 400
AS $$
  SELECT p_user_id IS NOT NULL
     AND p_tenant_id IS NOT NULL
     AND (
       EXISTS (
         SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = p_user_id
            AND ur.tenant_id = p_tenant_id
            AND ur.role IN ('admin'::public.app_role, 'editor'::public.app_role,
                            'author'::public.app_role, 'super_admin'::public.app_role)
       )
       OR EXISTS (
         SELECT 1 FROM public.profile_badges b
          WHERE b.user_id = p_user_id
            AND b.tenant_id = p_tenant_id
            AND b.badge = 'expert'
       )
       OR EXISTS (
         SELECT 1 FROM public.author_profiles ap
          WHERE ap.user_id = p_user_id
            AND ap.tenant_id = p_tenant_id
            AND ap.is_public = true
       )
       OR EXISTS (
         SELECT 1 FROM public.speaker_profiles sp
          WHERE sp.user_id = p_user_id
            AND sp.tenant_id = p_tenant_id
            AND sp.is_public = true
       )
       OR EXISTS (
         SELECT 1 FROM public.posts po
          WHERE po.author_id = p_user_id
            AND po.tenant_id = p_tenant_id
            AND po.status = 'published'
            AND po.deleted_at IS NULL
       )
       OR EXISTS (
         SELECT 1
           FROM public.post_authors pa
           JOIN public.posts po2 ON po2.id = pa.post_id
          WHERE pa.user_id = p_user_id
            AND po2.tenant_id = p_tenant_id
            AND po2.status = 'published'
            AND po2.deleted_at IS NULL
       )
       OR EXISTS (
         SELECT 1 FROM public.podcasts pd
          WHERE pd.author_id = p_user_id
            AND pd.tenant_id = p_tenant_id
            AND pd.status = 'published'
            AND pd.deleted_at IS NULL
       )
       OR EXISTS (
         SELECT 1 FROM public.events ev
          WHERE ev.host_user_id = p_user_id
            AND ev.tenant_id = p_tenant_id
            AND ev.status = 'published'
       )
       OR EXISTS (
         SELECT 1
           FROM public.event_speakers es
           JOIN public.events ev2 ON ev2.id = es.event_id
          WHERE es.user_id = p_user_id
            AND ev2.tenant_id = p_tenant_id
            AND ev2.status = 'published'
       )
     )
$$;

REVOKE ALL ON FUNCTION public.profile_has_public_presence(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_has_public_presence(uuid, uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.caller_is_tenant_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
COST 5
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.is_staff() OR public.is_super_admin(auth.uid()))
$$;

REVOKE ALL ON FUNCTION public.caller_is_tenant_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_is_tenant_staff()
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.caller_is_connected_to(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
COST 60
AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.user_connections uc
        WHERE uc.status = 'accepted'
          AND (
            (uc.requester_id = auth.uid() AND uc.addressee_id = p_user_id)
            OR (uc.addressee_id = auth.uid() AND uc.requester_id = p_user_id)
          )
     )
$$;

REVOKE ALL ON FUNCTION public.caller_is_connected_to(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_is_connected_to(uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = off, security_barrier = true) AS
SELECT
  p.id,
  p.tenant_id,
  p.slug,
  p.display_name,
  p.first_name,
  p.last_name,
  p.avatar_url,
  p.cover_url,
  p.bio_pl,
  p.bio_en,
  p.job_title,
  p.twitter_url,
  p.linkedin_url,
  p.facebook_url,
  p.instagram_url,
  p.spotify_url,
  p.website_url,
  p.current_company,
  p.specialization,
  p.verified_at,
  p.updated_at,
  p.expert_requests_enabled
FROM public.profiles p
WHERE
  (
    auth.uid() IS NOT NULL
    AND p.tenant_id = public.current_tenant_id()
    AND (
      p.id = auth.uid()
      OR p.discoverable = true
      OR public.caller_is_tenant_staff()
      OR public.caller_is_connected_to(p.id)
    )
  )
  OR (
    p.tenant_id = public.public_tenant_id()
    AND public.profile_has_public_presence(p.id, p.tenant_id)
  );

GRANT SELECT ON public.profiles_public TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_public_exposure()
RETURNS TABLE (
  is_public boolean,
  discoverable boolean,
  by_editorial_role boolean,
  by_expert_badge boolean,
  by_author_profile boolean,
  by_speaker_profile boolean,
  by_published_content boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT pr.id AS me_id, pr.tenant_id AS me_tenant, pr.discoverable AS me_discoverable
      FROM public.profiles pr
     WHERE pr.id = auth.uid()
  )
  SELECT
    public.profile_has_public_presence(me.me_id, me.me_tenant),
    me.me_discoverable,
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = me.me_id
         AND ur.tenant_id = me.me_tenant
         AND ur.role IN ('admin'::public.app_role, 'editor'::public.app_role,
                         'author'::public.app_role, 'super_admin'::public.app_role)
    ),
    EXISTS (
      SELECT 1 FROM public.profile_badges b
       WHERE b.user_id = me.me_id AND b.tenant_id = me.me_tenant AND b.badge = 'expert'
    ),
    EXISTS (
      SELECT 1 FROM public.author_profiles ap
       WHERE ap.user_id = me.me_id AND ap.tenant_id = me.me_tenant AND ap.is_public = true
    ),
    EXISTS (
      SELECT 1 FROM public.speaker_profiles sp
       WHERE sp.user_id = me.me_id AND sp.tenant_id = me.me_tenant AND sp.is_public = true
    ),
    (
      EXISTS (
        SELECT 1 FROM public.posts po
         WHERE po.author_id = me.me_id AND po.tenant_id = me.me_tenant
           AND po.status = 'published' AND po.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.post_authors pa
          JOIN public.posts po2 ON po2.id = pa.post_id
         WHERE pa.user_id = me.me_id AND po2.tenant_id = me.me_tenant
           AND po2.status = 'published' AND po2.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.podcasts pd
         WHERE pd.author_id = me.me_id AND pd.tenant_id = me.me_tenant
           AND pd.status = 'published' AND pd.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.events ev
         WHERE ev.host_user_id = me.me_id AND ev.tenant_id = me.me_tenant
           AND ev.status = 'published'
      )
      OR EXISTS (
        SELECT 1 FROM public.event_speakers es
          JOIN public.events ev2 ON ev2.id = es.event_id
         WHERE es.user_id = me.me_id AND ev2.tenant_id = me.me_tenant
           AND ev2.status = 'published'
      )
    )
  FROM me
$$;

REVOKE ALL ON FUNCTION public.get_my_public_exposure() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_public_exposure() TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_posts_author_published
  ON public.posts (author_id)
  WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_post_authors_user
  ON public.post_authors (user_id);

CREATE INDEX IF NOT EXISTS idx_event_speakers_user
  ON public.event_speakers (user_id);

CREATE INDEX IF NOT EXISTS idx_podcasts_author_published
  ON public.podcasts (author_id)
  WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_host_published
  ON public.events (host_user_id)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_author_profiles_user_public
  ON public.author_profiles (user_id, tenant_id)
  WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_speaker_profiles_user_public
  ON public.speaker_profiles (user_id, tenant_id)
  WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_user_roles_user_tenant_role
  ON public.user_roles (user_id, tenant_id, role);

CREATE INDEX IF NOT EXISTS idx_user_connections_pair_accepted
  ON public.user_connections (requester_id, addressee_id)
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS idx_user_connections_pair_accepted_rev
  ON public.user_connections (addressee_id, requester_id)
  WHERE status = 'accepted';