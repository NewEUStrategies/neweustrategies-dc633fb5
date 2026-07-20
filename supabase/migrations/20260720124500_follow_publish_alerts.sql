-- Subskrypcje tematyczne (D1): programy badawcze jako cel obserwacji.
--
-- Stan zastany: user_follows (author/category/tag) + KOMPLETNY producent
-- notify_post_published() (migracja 20260711082708) fan-outujący alerty do
-- obserwujących autora/kategorie/tagi przez enqueue_notification; dalej jadą
-- istniejące szyny: dzwonek (realtime), push (kanoniczny trigger kolejki,
-- szanuje push_enabled) i digest e-mail (claim_due_digests wg email_digest).
--
-- Ta migracja domyka obietnicę "obserwuj program/temat/autora":
--   1) user_follows.target_type += 'program' (FollowButton na stronie
--      programu + zakładka w /profile/follows),
--   2) indeks odwrotny pod fan-out (kto obserwuje X w tym tenancie) -
--      dotychczas był tylko indeks po user_id ("moje obserwacje"),
--   3) CREATE OR REPLACE notify_post_published() z NOWĄ gałęzią programów
--      (post_programs); reszta ciała 1:1 z wersją zastaną - to podmiana
--      funkcji pod istniejącym triggerem posts_notify_published_trg,
--      ŻADEN nowy trigger nie powstaje (drugi producent dublowałby alerty).

-- 1) Programy jako cel obserwacji.
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
    FROM pg_constraint
   WHERE conrelid = 'public.user_follows'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%target_type%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_follows DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE public.user_follows
    ADD CONSTRAINT user_follows_target_type_check
    CHECK (target_type IN ('author', 'category', 'tag', 'program'));
END;
$$;

-- 2) Fan-out pyta "kto obserwuje X" - indeks odwrotny.
CREATE INDEX IF NOT EXISTS idx_user_follows_target
  ON public.user_follows (tenant_id, target_type, target_id);

-- 3) Producent z gałęzią programów (podmiana funkcji, trigger bez zmian).
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

  -- Followers of any of the post's research programs (D1)
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
  JOIN public.post_programs pp ON pp.program_id = f.target_id
  WHERE f.target_type = 'program'
    AND pp.post_id = NEW.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
