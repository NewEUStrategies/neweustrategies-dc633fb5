-- ============================================================
-- A31: club posts (LinkedIn-style wall) + attachments + likes
-- ============================================================

CREATE TABLE IF NOT EXISTS public.club_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.club_groups(id) ON DELETE SET NULL,
  thread_id uuid REFERENCES public.club_threads(id) ON DELETE SET NULL,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'published',
  like_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  CONSTRAINT club_posts_status_check CHECK (status = ANY (ARRAY['published','removed'])),
  CONSTRAINT club_posts_body_len CHECK (char_length(body) <= 6000),
  CONSTRAINT club_posts_attachments_array CHECK (jsonb_typeof(attachments) = 'array'),
  CONSTRAINT club_posts_has_payload CHECK (
    NULLIF(btrim(body), '') IS NOT NULL OR jsonb_array_length(attachments) > 0
  )
);

CREATE INDEX IF NOT EXISTS club_posts_club_recent_idx
  ON public.club_posts (club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS club_posts_thread_idx
  ON public.club_posts (thread_id, created_at DESC) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS club_posts_group_idx
  ON public.club_posts (group_id, created_at DESC) WHERE group_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_posts TO authenticated;
GRANT ALL ON public.club_posts TO service_role;
ALTER TABLE public.club_posts ENABLE ROW LEVEL SECURITY;
-- Dostep wylacznie przez RPC SECURITY DEFINER (tak jak club_documents).

DROP TRIGGER IF EXISTS club_posts_pin_tenant_tg ON public.club_posts;
CREATE TRIGGER club_posts_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_posts
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_posts_set_updated_tg ON public.club_posts;
CREATE TRIGGER club_posts_set_updated_tg
  BEFORE UPDATE ON public.club_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.club_post_likes (
  post_id uuid NOT NULL REFERENCES public.club_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

GRANT SELECT, INSERT, DELETE ON public.club_post_likes TO authenticated;
GRANT ALL ON public.club_post_likes TO service_role;
ALTER TABLE public.club_post_likes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Zasady dostepu do plikow wpisow (bucket club-media, prywatny)
-- ============================================================
DROP POLICY IF EXISTS "club media member read" ON storage.objects;
CREATE POLICY "club media member read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'club-media');

DROP POLICY IF EXISTS "club media owner insert" ON storage.objects;
CREATE POLICY "club media owner insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'club-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "club media owner update" ON storage.objects;
CREATE POLICY "club media owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'club-media' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'club-media' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "club media owner delete" ON storage.objects;
CREATE POLICY "club media owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'club-media' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- RPC: utworzenie wpisu
-- ============================================================
DROP FUNCTION IF EXISTS public.club_post_create(uuid, uuid, uuid, text, jsonb);
CREATE FUNCTION public.club_post_create(
  p_club_id uuid,
  p_group_id uuid DEFAULT NULL,
  p_thread_id uuid DEFAULT NULL,
  p_body text DEFAULT '',
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(post_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caps record;
  v_body text := btrim(COALESCE(p_body, ''));
  v_att jsonb := COALESCE(p_attachments, '[]'::jsonb);
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'club_post_create: unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, p_group_id, auth.uid());
  IF NOT COALESCE(v_caps.can_reply, false) THEN
    RAISE EXCEPTION 'club_post_create: forbidden' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(v_att) <> 'array' THEN
    v_att := '[]'::jsonb;
  END IF;
  IF jsonb_array_length(v_att) > 10 THEN
    RAISE EXCEPTION 'club_post_create: too many attachments' USING ERRCODE = '22023';
  END IF;
  IF v_body = '' AND jsonb_array_length(v_att) = 0 THEN
    RAISE EXCEPTION 'club_post_create: empty post' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) > 6000 THEN
    RAISE EXCEPTION 'club_post_create: body too long' USING ERRCODE = '22023';
  END IF;

  IF p_thread_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.club_threads t
     WHERE t.id = p_thread_id AND t.club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'club_post_create: thread not in club' USING ERRCODE = '22023';
  END IF;

  IF p_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.club_groups g
     WHERE g.id = p_group_id AND g.club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'club_post_create: group not in club' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.club_posts (club_id, group_id, thread_id, author_id, body, attachments, tenant_id)
  SELECT p_club_id, p_group_id, p_thread_id, auth.uid(), v_body, v_att, c.tenant_id
    FROM public.clubs c WHERE c.id = p_club_id
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.club_post_create(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_post_create(uuid, uuid, uuid, text, jsonb) TO authenticated, service_role;

-- ============================================================
-- RPC: lista wpisow
-- ============================================================
DROP FUNCTION IF EXISTS public.club_posts_list(uuid, uuid, uuid, integer, timestamptz);
CREATE FUNCTION public.club_posts_list(
  p_club_id uuid,
  p_group_id uuid DEFAULT NULL,
  p_thread_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_cursor timestamptz DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  club_id uuid,
  group_id uuid,
  group_name_pl text,
  group_name_en text,
  thread_id uuid,
  thread_slug text,
  thread_title text,
  author_id uuid,
  author_name text,
  author_avatar text,
  author_slug text,
  body text,
  attachments jsonb,
  like_count integer,
  liked_by_me boolean,
  can_manage boolean,
  created_at timestamptz,
  edited_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, p_group_id, auth.uid())
  ),
  visible AS (
    SELECT po.*
      FROM public.club_posts po
      CROSS JOIN cap
     WHERE po.club_id = p_club_id
       AND cap.can_read
       AND po.status = 'published'
       AND (p_group_id IS NULL OR po.group_id = p_group_id)
       AND (p_thread_id IS NULL OR po.thread_id = p_thread_id)
  ),
  page AS (
    SELECT v.* FROM visible v
     WHERE p_cursor IS NULL OR v.created_at < p_cursor
     ORDER BY v.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  )
  SELECT
    v.id, v.club_id, v.group_id, g.name_pl, g.name_en,
    v.thread_id, t.slug, t.title,
    v.author_id,
    COALESCE(NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User'),
    CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END,
    p.slug,
    v.body, v.attachments, v.like_count,
    EXISTS (SELECT 1 FROM public.club_post_likes l
             WHERE l.post_id = v.id AND l.user_id = auth.uid()),
    (auth.uid() IS NOT NULL
     AND (v.author_id = auth.uid() OR (SELECT cap.can_moderate FROM cap))),
    v.created_at, v.edited_at,
    (SELECT count(*) FROM visible)
  FROM page v
  LEFT JOIN public.profiles p ON p.id = v.author_id
  LEFT JOIN public.club_groups g ON g.id = v.group_id
  LEFT JOIN public.club_threads t ON t.id = v.thread_id
  ORDER BY v.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.club_posts_list(uuid, uuid, uuid, integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_posts_list(uuid, uuid, uuid, integer, timestamptz) TO anon, authenticated, service_role;

-- ============================================================
-- RPC: usuniecie wpisu
-- ============================================================
DROP FUNCTION IF EXISTS public.club_post_delete(uuid);
CREATE FUNCTION public.club_post_delete(p_post_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_post public.club_posts%ROWTYPE;
  v_caps record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'club_post_delete: unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_post FROM public.club_posts WHERE id = p_post_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_post.club_id, v_post.group_id, auth.uid());
  IF v_post.author_id IS DISTINCT FROM auth.uid() AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'club_post_delete: forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_posts SET status = 'removed' WHERE id = p_post_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.club_post_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_post_delete(uuid) TO authenticated, service_role;

-- ============================================================
-- RPC: polubienie wpisu
-- ============================================================
DROP FUNCTION IF EXISTS public.club_post_toggle_like(uuid);
CREATE FUNCTION public.club_post_toggle_like(p_post_id uuid)
RETURNS TABLE(liked boolean, like_count integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_post public.club_posts%ROWTYPE;
  v_caps record;
  v_liked boolean;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'club_post_toggle_like: unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_post FROM public.club_posts WHERE id = p_post_id AND status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'club_post_toggle_like: not found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_post.club_id, v_post.group_id, auth.uid());
  IF NOT COALESCE(v_caps.can_react, false) THEN
    RAISE EXCEPTION 'club_post_toggle_like: forbidden' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.club_post_likes l
              WHERE l.post_id = p_post_id AND l.user_id = auth.uid()) THEN
    DELETE FROM public.club_post_likes l
     WHERE l.post_id = p_post_id AND l.user_id = auth.uid();
    v_liked := false;
  ELSE
    INSERT INTO public.club_post_likes (post_id, user_id)
    VALUES (p_post_id, auth.uid())
    ON CONFLICT DO NOTHING;
    v_liked := true;
  END IF;

  SELECT count(*)::int INTO v_count FROM public.club_post_likes l WHERE l.post_id = p_post_id;
  UPDATE public.club_posts SET like_count = v_count WHERE id = p_post_id;

  RETURN QUERY SELECT v_liked, v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.club_post_toggle_like(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_post_toggle_like(uuid) TO authenticated, service_role;