
-- ============================================================
-- 1) enqueue_notification: unified producer helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid,
  p_kind text,
  p_title_pl text,
  p_title_en text,
  p_body_pl text DEFAULT NULL,
  p_body_en text DEFAULT NULL,
  p_href text DEFAULT NULL,
  p_icon text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN
    RETURN NULL;
  END IF;

  -- Tenant scoping: try host-aware public_tenant_id() first, fall back to
  -- current_tenant_id() (session), then to the notifications default tenant.
  v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  -- Dedup: identical (user, kind, href) within 5 minutes — collapse duplicates.
  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id
      AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '')
      AND n.created_at > now() - interval '5 minutes'
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (
    user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon
  ) VALUES (
    p_user_id, v_tenant, p_kind,
    COALESCE(NULLIF(btrim(p_title_pl), ''), NULLIF(btrim(p_title_en), ''), p_kind),
    NULLIF(btrim(p_title_en), ''),
    NULLIF(btrim(p_body_pl), ''),
    NULLIF(btrim(p_body_en), ''),
    NULLIF(btrim(p_href), ''),
    NULLIF(btrim(p_icon), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  -- Producer must never block the caller (e.g. comment insert).
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, text, text) TO authenticated, service_role;

-- ============================================================
-- 2) comments: table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','spam','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_post_status_created_idx
  ON public.comments (post_id, status, created_at);
CREATE INDEX IF NOT EXISTS comments_tenant_status_created_idx
  ON public.comments (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS comments_parent_idx
  ON public.comments (parent_id);
CREATE INDEX IF NOT EXISTS comments_user_idx
  ON public.comments (user_id);

DROP TRIGGER IF EXISTS comments_set_updated_at ON public.comments;
CREATE TRIGGER comments_set_updated_at
  BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 3) grants + RLS
-- ============================================================
GRANT SELECT ON public.comments TO anon;
GRANT SELECT, INSERT, UPDATE ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_public_select_approved" ON public.comments;
CREATE POLICY "comments_public_select_approved" ON public.comments
  FOR SELECT TO anon, authenticated
  USING (
    status = 'approved'
    AND tenant_id = (SELECT public.public_tenant_id())
  );

DROP POLICY IF EXISTS "comments_own_select" ON public.comments;
CREATE POLICY "comments_own_select" ON public.comments
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "comments_staff_select" ON public.comments;
CREATE POLICY "comments_staff_select" ON public.comments
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "comments_own_insert" ON public.comments;
CREATE POLICY "comments_own_insert" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "comments_own_update" ON public.comments;
CREATE POLICY "comments_own_update" ON public.comments
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "comments_staff_update" ON public.comments;
CREATE POLICY "comments_staff_update" ON public.comments
  FOR UPDATE TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ============================================================
-- 4) BEFORE INSERT: pin tenant/status, enforce settings + nesting
-- ============================================================
CREATE OR REPLACE FUNCTION public.comments_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_post record;
  v_settings jsonb;
  v_parent record;
BEGIN
  SELECT p.tenant_id, p.status INTO v_post
    FROM public.posts p WHERE p.id = NEW.post_id;
  IF v_post.tenant_id IS NULL THEN
    RAISE EXCEPTION 'comments: post % does not exist', NEW.post_id;
  END IF;
  IF v_post.status <> 'published' THEN
    RAISE EXCEPTION 'comments: post is not published';
  END IF;

  NEW.tenant_id := v_post.tenant_id;

  SELECT s.value INTO v_settings
    FROM public.site_settings s
   WHERE s.key = 'discussion' AND s.tenant_id = v_post.tenant_id;

  IF NOT COALESCE((v_settings ->> 'allow_comments')::boolean, false) THEN
    RAISE EXCEPTION 'comments_disabled';
  END IF;

  NEW.status := CASE
    WHEN COALESCE((v_settings ->> 'moderate_new_comments')::boolean, true)
      THEN 'pending'
    ELSE 'approved'
  END;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT c.post_id, c.status, c.parent_id INTO v_parent
      FROM public.comments c WHERE c.id = NEW.parent_id;
    IF v_parent.post_id IS NULL THEN
      RAISE EXCEPTION 'comments: parent % does not exist', NEW.parent_id;
    END IF;
    IF v_parent.post_id <> NEW.post_id THEN
      RAISE EXCEPTION 'comments: parent belongs to another post';
    END IF;
    IF v_parent.status <> 'approved' THEN
      RAISE EXCEPTION 'comments: parent is not approved';
    END IF;
    IF v_parent.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'comments: max one nesting level';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_before_insert_trg ON public.comments;
CREATE TRIGGER comments_before_insert_trg
  BEFORE INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_before_insert();

-- ============================================================
-- 5) BEFORE UPDATE: identity frozen; non-staff = soft delete only
-- ============================================================
CREATE OR REPLACE FUNCTION public.comments_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.post_id IS DISTINCT FROM OLD.post_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'comments: identity columns are immutable';
  END IF;

  IF public.has_role(v_uid, 'admin'::app_role)
     OR public.has_role(v_uid, 'editor'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.body IS DISTINCT FROM OLD.body THEN
    RAISE EXCEPTION 'comments: body cannot be edited';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'deleted' THEN
    RAISE EXCEPTION 'comments: only soft delete is allowed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_guard_update_trg ON public.comments;
CREATE TRIGGER comments_guard_update_trg
  BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_guard_update();

-- ============================================================
-- 6) Notify post author on approved comment
-- ============================================================
CREATE OR REPLACE FUNCTION public.comments_notify_approved()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_author uuid;
  v_slug text;
  v_title_pl text;
  v_title_en text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT p.author_id, p.slug,
         NULLIF(btrim(p.title_pl), ''), NULLIF(btrim(p.title_en), '')
    INTO v_author, v_slug, v_title_pl, v_title_en
    FROM public.posts p WHERE p.id = NEW.post_id;

  IF v_author IS NULL OR v_author = NEW.user_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_notification(
    v_author,
    'comment',
    'Nowy komentarz do wpisu',
    'New comment on your post',
    COALESCE(v_title_pl, v_title_en, v_slug),
    COALESCE(v_title_en, v_title_pl, v_slug),
    '/post/' || v_slug,
    'MessageCircle'
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_notify_approved_trg ON public.comments;
CREATE TRIGGER comments_notify_approved_trg
  AFTER INSERT OR UPDATE OF status ON public.comments
  FOR EACH ROW
  WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION public.comments_notify_approved();
