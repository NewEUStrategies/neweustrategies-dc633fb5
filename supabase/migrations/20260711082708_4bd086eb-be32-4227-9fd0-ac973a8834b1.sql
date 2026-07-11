-- ============================================================
-- Stage 3: notification producers (follows, posts, subscriptions)
-- ============================================================

-- Helper: build canonical URL for a post (parent page full path + slug),
-- fallback to /post/<slug> which 301-redirects to canonical.
CREATE OR REPLACE FUNCTION public.post_canonical_href(_post_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_parent uuid;
  v_path text;
BEGIN
  SELECT slug, parent_page_id INTO v_slug, v_parent
    FROM public.posts WHERE id = _post_id;
  IF v_slug IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_parent IS NOT NULL THEN
    BEGIN
      SELECT public.page_full_path(v_parent) INTO v_path;
    EXCEPTION WHEN OTHERS THEN
      v_path := NULL;
    END;
    IF v_path IS NOT NULL AND length(v_path) > 0 THEN
      RETURN '/' || v_path || '/' || v_slug;
    END IF;
  END IF;
  RETURN '/post/' || v_slug;
END;
$$;

-- ============================================================
-- 1) user_follows AFTER INSERT → notify followed author
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_new_follower()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_follower_name text;
  v_follower_slug text;
  v_href text;
BEGIN
  IF NEW.target_type <> 'author' OR NEW.target_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id = NEW.target_id THEN
    RETURN NEW; -- do not notify self-follow
  END IF;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Użytkownik'), slug
    INTO v_follower_name, v_follower_slug
    FROM public.profiles WHERE id = NEW.user_id;

  v_href := CASE
    WHEN v_follower_slug IS NOT NULL THEN '/author/' || v_follower_slug
    ELSE NULL
  END;

  PERFORM public.enqueue_notification(
    NEW.target_id,
    'follow',
    v_follower_name || ' zaczął(-ęła) Cię obserwować',
    v_follower_name || ' started following you',
    NULL, NULL,
    v_href,
    'user-plus'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_follows_notify_trg ON public.user_follows;
CREATE TRIGGER user_follows_notify_trg
  AFTER INSERT ON public.user_follows
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_follower();

-- ============================================================
-- 2) posts AFTER UPDATE/INSERT → publication notifies followers
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_post_published()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_title_pl text;
  v_title_en text;
  v_href text;
  v_author_name text;
  v_transitioned boolean;
BEGIN
  -- Fire only on transition into published state (or initial insert as published).
  IF TG_OP = 'INSERT' THEN
    v_transitioned := (NEW.status = 'published');
  ELSE
    v_transitioned := (NEW.status = 'published'
                       AND (OLD.status IS DISTINCT FROM 'published'));
  END IF;

  IF NOT v_transitioned THEN
    RETURN NEW;
  END IF;

  v_title_pl := COALESCE(NULLIF(btrim(NEW.title_pl), ''), NEW.slug);
  v_title_en := COALESCE(NULLIF(btrim(NEW.title_en), ''), NEW.slug);
  v_href := public.post_canonical_href(NEW.id);

  SELECT COALESCE(NULLIF(btrim(display_name), ''), 'autora') INTO v_author_name
    FROM public.profiles WHERE id = NEW.author_id;

  -- Followers of the author
  IF NEW.author_id IS NOT NULL THEN
    PERFORM public.enqueue_notification(
      f.user_id,
      'content',
      'Nowy wpis: ' || v_title_pl,
      'New post: ' || v_title_en,
      'Autor ' || v_author_name || ' opublikował nowy wpis.',
      'New post by ' || v_author_name || '.',
      v_href,
      'newspaper'
    )
    FROM public.user_follows f
    WHERE f.target_type = 'author'
      AND f.target_id = NEW.author_id
      AND f.user_id <> COALESCE(NEW.author_id, '00000000-0000-0000-0000-000000000000'::uuid);
  END IF;

  -- Followers of any of the post's categories
  PERFORM public.enqueue_notification(
    f.user_id,
    'content',
    'Nowy wpis: ' || v_title_pl,
    'New post: ' || v_title_en,
    NULL, NULL,
    v_href,
    'newspaper'
  )
  FROM public.user_follows f
  JOIN public.post_categories pc ON pc.category_id = f.target_id
  WHERE f.target_type = 'category'
    AND pc.post_id = NEW.id;

  -- Followers of any of the post's tags
  PERFORM public.enqueue_notification(
    f.user_id,
    'content',
    'Nowy wpis: ' || v_title_pl,
    'New post: ' || v_title_en,
    NULL, NULL,
    v_href,
    'newspaper'
  )
  FROM public.user_follows f
  JOIN public.post_tags pt ON pt.tag_id = f.target_id
  WHERE f.target_type = 'tag'
    AND pt.post_id = NEW.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_notify_published_trg ON public.posts;
CREATE TRIGGER posts_notify_published_trg
  AFTER INSERT OR UPDATE OF status ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.notify_post_published();

-- ============================================================
-- 3) user_subscriptions AFTER INSERT/UPDATE → activation notify
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_subscription_activated()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_activated boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_activated := (NEW.status::text = 'active');
  ELSE
    v_activated := (NEW.status::text = 'active'
                    AND (OLD.status::text IS DISTINCT FROM 'active'));
  END IF;

  IF NOT v_activated OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_notification(
    NEW.user_id,
    'subscription',
    'Subskrypcja aktywna',
    'Subscription activated',
    'Twoja subskrypcja jest teraz aktywna. Dziękujemy!',
    'Your subscription is now active. Thank you!',
    '/profile',
    'badge-check'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_subscriptions_notify_trg ON public.user_subscriptions;
CREATE TRIGGER user_subscriptions_notify_trg
  AFTER INSERT OR UPDATE OF status ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.notify_subscription_activated();