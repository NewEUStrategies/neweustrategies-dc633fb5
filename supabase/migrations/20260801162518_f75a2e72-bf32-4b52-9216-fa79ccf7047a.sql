-- === 20260801120000_restore_min_profile_grants ===
GRANT SELECT (
  id, tenant_id, slug, display_name, first_name, last_name, avatar_url, cover_url,
  bio, bio_pl, bio_en, job_title, current_company, specialization, twitter_url,
  linkedin_url, facebook_url, instagram_url, spotify_url, website_url,
  verified_at, created_at, updated_at
) ON public.profiles TO anon, authenticated;

GRANT SELECT (expert_requests_enabled, discoverable, profile_view_mode)
  ON public.profiles TO authenticated;

GRANT SELECT ON public.user_roles TO authenticated;

CREATE OR REPLACE FUNCTION public.user_is_editorial(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = p_user
       AND ur.role IN ('admin'::app_role, 'editor'::app_role,
                       'author'::app_role, 'super_admin'::app_role)
  );
$$;

REVOKE ALL ON FUNCTION public.user_is_editorial(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_editorial(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Profiles anon public authors" ON public.profiles;
CREATE POLICY "Profiles anon public authors" ON public.profiles
  FOR SELECT TO anon
  USING (
    tenant_id = public.public_tenant_id()
    AND slug IS NOT NULL
    AND public.user_is_editorial(id)
  );

-- === 20260801121000_revoke_content_access_password_hints_authenticated ===
REVOKE SELECT (password_hash, password_hint_pl, password_hint_en)
  ON public.content_access FROM anon, authenticated;

-- === 20260801122000_chat_attachment_purge_storage_delete_protection ===
CREATE OR REPLACE FUNCTION public.tg_messages_purge_attachment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_path text := OLD.attachment_path;
  v_prev text;
BEGIN
  IF v_path IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.attachment_path IS NOT DISTINCT FROM OLD.attachment_path THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_prev := current_setting('storage.allow_delete_query', true);
    PERFORM set_config('storage.allow_delete_query', 'true', true);
    DELETE FROM storage.objects
    WHERE bucket_id = 'chat-attachments' AND name = v_path;
    PERFORM set_config('storage.allow_delete_query', coalesce(v_prev, 'false'), true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat: attachment purge failed for %: %', v_path, SQLERRM;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- === 20260801123000_drop_stale_search_people_overload (idempotentne) ===
DROP FUNCTION IF EXISTS public.search_people(text, text, text, text, integer, integer);

-- === 20260801124000_search_chat_contacts ===
CREATE OR REPLACE FUNCTION public.search_chat_contacts(
  p_query text DEFAULT NULL::text,
  p_limit integer DEFAULT 24
)
RETURNS TABLE(
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  total_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()),
  is_admin AS (SELECT public.is_super_admin(auth.uid()) AS ok),
  base AS (
    SELECT p.id, p.display_name, p.avatar_url, p.job_title,
           p.current_company, p.specialization, p.location, p.slug
    FROM public.profiles p, me, is_admin
    WHERE p.discoverable = true
      AND p.tenant_id = me.tenant_id
      AND p.id <> auth.uid()
      AND (
        is_admin.ok
        OR EXISTS (
          SELECT 1 FROM public.user_connections uc
          WHERE uc.status = 'accepted'
            AND (
              (uc.requester_id = auth.uid() AND uc.addressee_id = p.id)
              OR (uc.addressee_id = auth.uid() AND uc.requester_id = p.id)
            )
        )
      )
      AND (
        coalesce(p_query, '') = ''
        OR p.display_name    ILIKE '%' || p_query || '%'
        OR p.first_name      ILIKE '%' || p_query || '%'
        OR p.last_name       ILIKE '%' || p_query || '%'
        OR p.job_title       ILIKE '%' || p_query || '%'
        OR p.current_company ILIKE '%' || p_query || '%'
        OR p.specialization  ILIKE '%' || p_query || '%'
        OR p.location        ILIKE '%' || p_query || '%'
      )
  ),
  counted AS (SELECT count(*) AS c FROM base)
  SELECT b.id, b.display_name, b.avatar_url, b.job_title,
         b.current_company, b.specialization, b.location, b.slug,
         (SELECT c FROM counted) AS total_count
  FROM base b
  ORDER BY b.display_name NULLS LAST
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

REVOKE ALL ON FUNCTION public.search_chat_contacts(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_chat_contacts(text, integer) TO authenticated, service_role;