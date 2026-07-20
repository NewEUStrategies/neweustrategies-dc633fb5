-- PR #52: Komentarze goście + wątkowanie (audyt 13.07)
ALTER TABLE public.comments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS author_name text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_author_name_length' AND conrelid = 'public.comments'::regclass) THEN
    ALTER TABLE public.comments ADD CONSTRAINT comments_author_name_length
      CHECK (author_name IS NULL OR length(btrim(author_name)) BETWEEN 2 AND 80);
  END IF;
END $$;

COMMENT ON COLUMN public.comments.author_name IS 'Podpis gościa (wiersze z user_id NULL). Zalogowani podpisują się profilem.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_identity_present' AND conrelid = 'public.comments'::regclass) THEN
    ALTER TABLE public.comments ADD CONSTRAINT comments_identity_present
      CHECK (user_id IS NOT NULL OR author_name IS NOT NULL);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.comments_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_post record;
  v_settings jsonb;
  v_parent record;
  v_depth integer;
  v_ancestor uuid;
BEGIN
  SELECT p.tenant_id, p.status INTO v_post FROM public.posts p WHERE p.id = NEW.post_id;
  IF v_post.tenant_id IS NULL THEN
    RAISE EXCEPTION 'comments: post % does not exist', NEW.post_id;
  END IF;
  IF v_post.status <> 'published' THEN
    RAISE EXCEPTION 'comments: post is not published';
  END IF;

  NEW.tenant_id := v_post.tenant_id;

  SELECT s.value INTO v_settings FROM public.site_settings s
   WHERE s.key = 'discussion' AND s.tenant_id = v_post.tenant_id;

  IF NOT COALESCE((v_settings ->> 'allow_comments')::boolean, false) THEN
    RAISE EXCEPTION 'comments_disabled';
  END IF;

  IF NEW.user_id IS NULL THEN
    IF COALESCE((v_settings ->> 'require_login_to_comment')::boolean, true) THEN
      RAISE EXCEPTION 'comments: auth required';
    END IF;
    IF NEW.author_name IS NULL OR length(btrim(NEW.author_name)) < 2 THEN
      RAISE EXCEPTION 'comments: guest name required';
    END IF;
    NEW.author_name := btrim(NEW.author_name);
  ELSE
    NEW.author_name := NULL;
  END IF;

  NEW.status := CASE
    WHEN COALESCE((v_settings ->> 'moderate_new_comments')::boolean, true) THEN 'pending'
    ELSE 'approved'
  END;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT c.post_id, c.status, c.parent_id INTO v_parent FROM public.comments c WHERE c.id = NEW.parent_id;
    IF v_parent.post_id IS NULL THEN
      RAISE EXCEPTION 'comments: parent % does not exist', NEW.parent_id;
    END IF;
    IF v_parent.post_id <> NEW.post_id THEN
      RAISE EXCEPTION 'comments: parent belongs to another post';
    END IF;
    IF v_parent.status <> 'approved' THEN
      RAISE EXCEPTION 'comments: parent is not approved';
    END IF;
    v_depth := 1;
    v_ancestor := v_parent.parent_id;
    WHILE v_ancestor IS NOT NULL LOOP
      v_depth := v_depth + 1;
      IF v_depth > 2 THEN
        RAISE EXCEPTION 'comments: max nesting depth exceeded';
      END IF;
      SELECT c.parent_id INTO v_ancestor FROM public.comments c WHERE c.id = v_ancestor;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_comments_rate_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_minute integer;
  v_hour integer;
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    SELECT
      count(*) FILTER (WHERE c.created_at > now() - interval '60 seconds'),
      count(*)
    INTO v_minute, v_hour
    FROM public.comments c
    WHERE c.user_id = NEW.user_id AND c.created_at > now() - interval '1 hour';

    IF v_minute >= 5 OR v_hour >= 30 THEN
      RAISE EXCEPTION 'comments: rate limited';
    END IF;
  ELSE
    SELECT
      count(*) FILTER (WHERE c.created_at > now() - interval '60 seconds'),
      count(*)
    INTO v_minute, v_hour
    FROM public.comments c
    WHERE c.user_id IS NULL AND c.post_id = NEW.post_id AND c.created_at > now() - interval '1 hour';

    IF v_minute >= 5 OR v_hour >= 60 THEN
      RAISE EXCEPTION 'comments: rate limited';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;