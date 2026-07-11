-- ============================================================================
-- POGODZENIE zduplikowanych migracji z 2026-07-11 + utwardzenia bezpieczeństwa.
--
-- Kontekst: 20260711100000_engagement_delta.sql (ręczna) i 20260711102702
-- (wygenerowana) definiowały te same obiekty niekompatybilnie:
--   * get_recommended_posts_v2 - inny zestaw kolumn wyjściowych (42P13 na
--     świeżym `db reset`; hostowana baza ma wersję 102702),
--   * search_people - wersja 102702 nadpisała utwardzoną (escapowanie LIKE,
--     unaccent/trgm) wersją ILIKE bez escapowania,
--   * personality_result_history - dwa triggery historii (podwójne wpisy na
--     świeżej bazie), kolumna answers z surowymi odpowiedziami quizu oraz
--     polityka odczytu dla adminów tenanta (dane wrażliwe!),
--   * utwardzenia z 100000 (REVOKE anon na personality_results, anty-spam
--     follow, meta powiadomień) najpewniej nigdy nie trafiły na hostowaną bazę.
--
-- Ten plik jest IDEMPOTENTNY i domyka oba światy do jednego stanu końcowego:
-- działa zarówno po samym 102702 (hostowana baza), jak i po 100000+102702
-- (świeży reset; 102702 dostał brakujący DROP FUNCTION, patrz komentarz tam).
--
-- Dodatkowo (audyt platformy):
--   * rate_limits.subject_id: uuid -> text. Publiczny endpoint TTS kluczuje
--     limity po IP i po "postId:lang" - z typem uuid KAŻDE zapytanie limitera
--     padało błędem typu, a limiter celowo "fails open", więc limity nigdy
--     nie działały (otwarta ścieżka drenażu budżetu ElevenLabs).
--   * enqueue_notification honoruje notification_preferences.enabled_* -
--     dotąd 5 z 7 przełączników preferencji nie było nigdzie konsultowane.
--   * get_chat_peers: gałąź discoverable ograniczona do tenanta wołającego
--     (wyciek profili cross-tenant po UUID).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) rate_limits.subject_id: uuid -> text (limity po IP / kluczach złożonych)
-- ----------------------------------------------------------------------------
ALTER TABLE public.rate_limits
  ALTER COLUMN subject_id TYPE text USING subject_id::text;

-- ----------------------------------------------------------------------------
-- 1) POWIADOMIENIA: meta + CHECK + indeksy + producenci (idempotentnie z 100000)
-- ----------------------------------------------------------------------------
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_kind_check' AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('system','comment','follow','subscription','content','security','message'))
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_follows_target
  ON public.user_follows (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_post_categories_category
  ON public.post_categories (category_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag
  ON public.post_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_posts_author_published
  ON public.posts (author_id, published_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;

-- enqueue_notification: wspólny producent honoruje preferencje odbiorcy.
-- Brak wiersza preferencji = wszystko włączone (domyślne opt-in jak w UI).
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
  v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN
    RETURN NULL;
  END IF;

  -- Preferencje odbiorcy: wyłączony rodzaj = cicho pomijamy.
  SELECT CASE p_kind
           WHEN 'message'      THEN np.enabled_message
           WHEN 'comment'      THEN np.enabled_comment
           WHEN 'follow'       THEN np.enabled_follow
           WHEN 'subscription' THEN np.enabled_subscription
           WHEN 'content'      THEN np.enabled_content
           WHEN 'system'       THEN np.enabled_system
           WHEN 'security'     THEN np.enabled_security
           ELSE true
         END
    INTO v_enabled
    FROM public.notification_preferences np
   WHERE np.user_id = p_user_id;
  IF v_enabled IS FALSE THEN
    RETURN NULL;
  END IF;

  v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

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
  RETURN NULL;
END;
$$;

-- Anty-spam follow: jeden ping od danego obserwującego na 7 dni (meta.actor_id).
CREATE OR REPLACE FUNCTION public.notify_new_follower()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_follower_name text;
  v_follower_slug text;
  v_href text;
  v_id uuid;
BEGIN
  IF NEW.target_type <> 'author' OR NEW.target_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id = NEW.target_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = NEW.target_id
      AND n.kind = 'follow'
      AND n.meta->>'actor_id' = NEW.user_id::text
      AND n.created_at > now() - interval '7 days'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Użytkownik'), slug
    INTO v_follower_name, v_follower_slug
    FROM public.profiles WHERE id = NEW.user_id;

  v_href := CASE
    WHEN v_follower_slug IS NOT NULL THEN '/author/' || v_follower_slug
    ELSE NULL
  END;

  v_id := public.enqueue_notification(
    NEW.target_id,
    'follow',
    v_follower_name || ' zaczął(-ęła) Cię obserwować',
    v_follower_name || ' started following you',
    NULL, NULL,
    v_href,
    'user-plus'
  );

  IF v_id IS NOT NULL THEN
    UPDATE public.notifications
       SET meta = jsonb_build_object('actor_id', NEW.user_id)
     WHERE id = v_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Powitanie po rejestracji (bez zmian; idempotentnie dla hostowanej bazy).
CREATE OR REPLACE FUNCTION public.notify_profile_welcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.notifications
      (user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon, meta)
    VALUES (
      NEW.id, NEW.tenant_id, 'system',
      'Witamy! Dopasuj swoje zainteresowania',
      'Welcome! Customize your interests',
      'Wybierz tematy i autorów, a rekomendacje oraz powiadomienia dopasują się do Ciebie.',
      'Pick topics and authors - recommendations and notifications will adapt to you.',
      '/profile/interests', 'Sparkles',
      jsonb_build_object('event', 'welcome')
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_profile_welcome failed: %', SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_notify_welcome_trg ON public.profiles;
CREATE TRIGGER profiles_notify_welcome_trg
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_profile_welcome();

-- ----------------------------------------------------------------------------
-- 2) KATALOG OSÓB: infrastruktura discovery_search + utwardzone RPC
--    (hostowana baza nigdy nie dostała wersji z 100000)
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discovery_search text;

CREATE OR REPLACE FUNCTION public.profiles_discovery_search_refresh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  BEGIN
    NEW.discovery_search := unaccent(lower(concat_ws(' ',
      NEW.display_name, NEW.first_name, NEW.last_name,
      NEW.job_title, NEW.current_company, NEW.specialization, NEW.location
    )));
  EXCEPTION WHEN OTHERS THEN
    NEW.discovery_search := lower(concat_ws(' ',
      NEW.display_name, NEW.first_name, NEW.last_name,
      NEW.job_title, NEW.current_company, NEW.specialization, NEW.location
    ));
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_discovery_search_trg ON public.profiles;
CREATE TRIGGER profiles_discovery_search_trg
  BEFORE INSERT OR UPDATE OF
    display_name, first_name, last_name, job_title,
    current_company, specialization, location
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_discovery_search_refresh();

DO $$
BEGIN
  BEGIN
    UPDATE public.profiles
       SET discovery_search = extensions.unaccent(lower(concat_ws(' ',
         display_name, first_name, last_name, job_title,
         current_company, specialization, location
       )))
     WHERE discovery_search IS NULL;
  EXCEPTION WHEN undefined_function OR invalid_schema_name THEN
    BEGIN
      UPDATE public.profiles
         SET discovery_search = public.unaccent(lower(concat_ws(' ',
           display_name, first_name, last_name, job_title,
           current_company, specialization, location
         )))
       WHERE discovery_search IS NULL;
    EXCEPTION WHEN undefined_function THEN
      UPDATE public.profiles
         SET discovery_search = lower(concat_ws(' ',
           display_name, first_name, last_name, job_title,
           current_company, specialization, location
         ))
       WHERE discovery_search IS NULL;
    END;
  END;
END $$;

CREATE INDEX IF NOT EXISTS profiles_discovery_trgm_idx
  ON public.profiles USING gin (discovery_search extensions.gin_trgm_ops)
  WHERE discoverable;

-- Kanoniczne search_people: unaccent + escapowanie wzorca LIKE + ranking trgm.
-- Sygnatura i kolumny wyjściowe identyczne z obiema wcześniejszymi wersjami,
-- więc CREATE OR REPLACE domyka oba stany baz.
CREATE OR REPLACE FUNCTION public.search_people(
  p_query text DEFAULT '',
  p_specialization text DEFAULT NULL,
  p_company text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
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
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT
      unaccent(lower(btrim(COALESCE(p_query, '')))) AS raw,
      replace(replace(replace(
        unaccent(lower(btrim(COALESCE(p_query, '')))),
        '\', '\\'), '%', '\%'), '_', '\_') AS esc
  )
  SELECT
    p.id,
    COALESCE(
      NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'User'
    ) AS display_name,
    p.avatar_url,
    p.job_title,
    p.current_company,
    p.specialization,
    p.location,
    p.slug,
    count(*) OVER () AS total_count
  FROM public.profiles p, q
  WHERE auth.uid() IS NOT NULL
    AND p.discoverable
    AND p.id <> auth.uid()
    AND p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
    AND (q.raw = '' OR p.discovery_search LIKE '%' || q.esc || '%')
    AND (COALESCE(btrim(p_specialization), '') = ''
         OR lower(btrim(p.specialization)) = lower(btrim(p_specialization)))
    AND (COALESCE(btrim(p_company), '') = ''
         OR lower(btrim(p.current_company)) = lower(btrim(p_company)))
    AND (COALESCE(btrim(p_location), '') = ''
         OR lower(btrim(p.location)) = lower(btrim(p_location)))
  ORDER BY
    (q.raw <> '' AND p.discovery_search LIKE q.esc || '%') DESC,
    CASE WHEN q.raw <> '' THEN similarity(p.discovery_search, q.raw) ELSE 0 END DESC,
    lower(COALESCE(
      NULLIF(btrim(p.display_name), ''),
      concat_ws(' ', p.first_name, p.last_name)
    )) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

REVOKE EXECUTE ON FUNCTION public.search_people(text, text, text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_people(text, text, text, text, integer, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.people_filter_options()
RETURNS TABLE (field text, value text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH base AS (
    SELECT p.specialization, p.current_company, p.location
      FROM public.profiles p
     WHERE auth.uid() IS NOT NULL
       AND p.discoverable
       AND p.id <> auth.uid()
       AND p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
  )
  SELECT * FROM (
    SELECT 'specialization'::text AS field, btrim(b.specialization) AS value, count(*) AS cnt
      FROM base b
     WHERE COALESCE(btrim(b.specialization), '') <> ''
     GROUP BY btrim(b.specialization)
    UNION ALL
    SELECT 'company'::text, btrim(b.current_company), count(*)
      FROM base b
     WHERE COALESCE(btrim(b.current_company), '') <> ''
     GROUP BY btrim(b.current_company)
    UNION ALL
    SELECT 'location'::text, btrim(b.location), count(*)
      FROM base b
     WHERE COALESCE(btrim(b.location), '') <> ''
     GROUP BY btrim(b.location)
  ) opts
  ORDER BY opts.field ASC, opts.cnt DESC, opts.value ASC
$$;

REVOKE EXECUTE ON FUNCTION public.people_filter_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.people_filter_options() TO authenticated, service_role;

-- get_chat_peers: gałąź "discoverable" ograniczona do tenanta wołającego -
-- dotąd dowolny zalogowany użytkownik dowolnego tenanta mógł po UUID pobrać
-- imię/avatar/stanowisko profilu z innego tenanta.
CREATE OR REPLACE FUNCTION public.get_chat_peers(p_user_ids uuid[])
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name, p.avatar_url, p.job_title, p.current_company, p.specialization
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id = ANY (p_user_ids)
    AND (
      p.id = auth.uid()
      OR (
        p.discoverable = true
        AND p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
      )
      OR EXISTS (
        SELECT 1
        FROM public.conversation_participants me
        JOIN public.conversation_participants them
          ON them.conversation_id = me.conversation_id
        WHERE me.user_id = auth.uid()
          AND them.user_id = p.id
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) FEED OBSERWOWANYCH + REKOMENDACJE: jedna kanoniczna implementacja
-- ----------------------------------------------------------------------------
-- get_followed_feed: wersja z pre-filtrem dopasowań (nie skanuje wszystkich
-- postów), tenant z profilu wołającego. Kolumny bez zmian.
CREATE OR REPLACE FUNCTION public.get_followed_feed(
  p_limit integer DEFAULT 12,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  slug text,
  title_pl text,
  title_en text,
  excerpt_pl text,
  excerpt_en text,
  cover_image_url text,
  published_at timestamptz,
  parent_page_id uuid,
  author_id uuid,
  reasons text[],
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT pr.tenant_id AS tid
      FROM public.profiles pr
     WHERE pr.id = auth.uid()
  ),
  f AS (
    SELECT uf.target_type, uf.target_id
      FROM public.user_follows uf
     WHERE uf.user_id = auth.uid()
  ),
  matches AS (
    SELECT p.id AS post_id, 'author'::text AS reason
      FROM public.posts p
      JOIN f ON f.target_type = 'author' AND f.target_id = p.author_id
    UNION
    SELECT pc.post_id, 'category'::text
      FROM public.post_categories pc
      JOIN f ON f.target_type = 'category' AND f.target_id = pc.category_id
    UNION
    SELECT pt.post_id, 'tag'::text
      FROM public.post_tags pt
      JOIN f ON f.target_type = 'tag' AND f.target_id = pt.tag_id
  )
  SELECT
    p.id, p.slug, p.title_pl, p.title_en, p.excerpt_pl, p.excerpt_en,
    p.cover_image_url, p.published_at, p.parent_page_id, p.author_id,
    array_agg(DISTINCT m.reason) AS reasons,
    count(*) OVER () AS total_count
  FROM public.posts p
  JOIN matches m ON m.post_id = p.id
  JOIN me ON me.tid = p.tenant_id
  WHERE auth.uid() IS NOT NULL
    AND p.status = 'published'
    AND p.deleted_at IS NULL
  GROUP BY p.id
  ORDER BY p.published_at DESC NULLS LAST, p.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

REVOKE EXECUTE ON FUNCTION public.get_followed_feed(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_followed_feed(integer, integer) TO authenticated, service_role;

-- get_recommended_posts_v2: kolumny wyjściowe zgodne z klientem (author_id +
-- reasons text[], jak w 102702), wnętrze utwardzone jak w 100000: cap 300
-- kandydatów zamiast pełnego skanu tabeli, stopniowany scoring (krotności
-- kategorii/tagów), afinicja historii liczona wyłącznie z kategorii/tagów
-- spoza jawnych obserwacji (poprawny powód 'history'), tenant z
-- current_tenant_id() z fallbackiem na public_tenant_id().
DROP FUNCTION IF EXISTS public.get_recommended_posts_v2(integer, integer, uuid[], uuid[]);

CREATE FUNCTION public.get_recommended_posts_v2(
  p_limit integer DEFAULT 9,
  p_offset integer DEFAULT 0,
  p_category_ids uuid[] DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  slug text,
  title_pl text,
  title_en text,
  excerpt_pl text,
  excerpt_en text,
  cover_image_url text,
  published_at timestamptz,
  parent_page_id uuid,
  author_id uuid,
  score numeric,
  reasons text[]
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH tenant AS (
    SELECT COALESCE(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  f AS (
    SELECT uf.target_type, uf.target_id
      FROM public.user_follows uf
     WHERE uf.user_id = auth.uid()
  ),
  eff_cats AS (
    SELECT f.target_id AS cid FROM f WHERE f.target_type = 'category'
    UNION
    SELECT unnest(COALESCE(p_category_ids, '{}'::uuid[])) WHERE auth.uid() IS NULL
  ),
  eff_tags AS (
    SELECT f.target_id AS tid FROM f WHERE f.target_type = 'tag'
    UNION
    SELECT unnest(COALESCE(p_tag_ids, '{}'::uuid[])) WHERE auth.uid() IS NULL
  ),
  followed_authors AS (
    SELECT f.target_id AS aid FROM f WHERE f.target_type = 'author'
  ),
  hist AS (
    SELECT h.post_id
      FROM public.user_read_history h
     WHERE h.user_id = auth.uid()
     ORDER BY h.read_at DESC
     LIMIT 50
  ),
  hist_cats AS (
    SELECT DISTINCT pc.category_id AS cid
      FROM public.post_categories pc
     WHERE pc.post_id IN (SELECT post_id FROM hist)
       AND pc.category_id NOT IN (SELECT cid FROM eff_cats)
  ),
  hist_tags AS (
    SELECT DISTINCT pt.tag_id AS tid
      FROM public.post_tags pt
     WHERE pt.post_id IN (SELECT post_id FROM hist)
       AND pt.tag_id NOT IN (SELECT tid FROM eff_tags)
  ),
  cand AS (
    SELECT p.id, p.slug, p.title_pl, p.title_en, p.excerpt_pl, p.excerpt_en,
           p.cover_image_url, p.published_at, p.parent_page_id, p.author_id
      FROM public.posts p
      JOIN tenant t ON t.tid = p.tenant_id
     WHERE p.status = 'published'
       AND p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM hist h WHERE h.post_id = p.id)
     ORDER BY p.published_at DESC NULLS LAST
     LIMIT 300
  ),
  scored AS (
    SELECT
      c.*,
      (CASE WHEN c.author_id IN (SELECT aid FROM followed_authors) THEN 4 ELSE 0 END)::numeric AS s_author,
      COALESCE((SELECT 3 * count(*) FROM public.post_categories pc
                 WHERE pc.post_id = c.id AND pc.category_id IN (SELECT cid FROM eff_cats)), 0)::numeric AS s_cat,
      COALESCE((SELECT 2 * count(*) FROM public.post_tags pt
                 WHERE pt.post_id = c.id AND pt.tag_id IN (SELECT tid FROM eff_tags)), 0)::numeric AS s_tag,
      COALESCE((SELECT count(*) FROM public.post_categories pc
                 WHERE pc.post_id = c.id AND pc.category_id IN (SELECT cid FROM hist_cats)), 0)::numeric
      + COALESCE((SELECT count(*) FROM public.post_tags pt
                 WHERE pt.post_id = c.id AND pt.tag_id IN (SELECT tid FROM hist_tags)), 0)::numeric AS s_hist,
      (CASE
         WHEN c.published_at > now() - interval '7 days' THEN 2
         WHEN c.published_at > now() - interval '30 days' THEN 1
         ELSE 0
       END)::numeric AS s_fresh
    FROM cand c
  )
  SELECT
    s.id, s.slug, s.title_pl, s.title_en, s.excerpt_pl, s.excerpt_en,
    s.cover_image_url, s.published_at, s.parent_page_id, s.author_id,
    (s.s_author + s.s_cat + s.s_tag + s.s_hist + s.s_fresh) AS score,
    array_remove(ARRAY[
      CASE WHEN s.s_author > 0 THEN 'author' END,
      CASE WHEN s.s_cat > 0 THEN 'category' END,
      CASE WHEN s.s_tag > 0 THEN 'tag' END,
      CASE WHEN s.s_hist > 0 THEN 'history' END,
      CASE WHEN s.s_fresh > 0 THEN 'fresh' END
    ], NULL) AS reasons
  FROM scored s
  ORDER BY (s.s_author + s.s_cat + s.s_tag + s.s_hist + s.s_fresh) DESC,
           s.published_at DESC NULLS LAST, s.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 9), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

REVOKE EXECUTE ON FUNCTION public.get_recommended_posts_v2(integer, integer, uuid[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recommended_posts_v2(integer, integer, uuid[], uuid[])
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) QUIZ OSOBOWOŚCI: prywatność danych wrażliwych + jeden trigger historii
-- ----------------------------------------------------------------------------
-- Wyniki psychometryczne nie są publiczne: ani dla anon (profil publiczny
-- autora nie ujawnia Big Five), ani dla adminów tenanta (historia podejść).
DROP POLICY IF EXISTS "public read personality" ON public.personality_results;
REVOKE SELECT ON public.personality_results FROM anon;

DROP POLICY IF EXISTS personality_history_admin_read ON public.personality_result_history;

-- Surowe odpowiedzi quizu nie należą do append-only historii (minimalizacja
-- danych; bieżące odpowiedzi zostają w personality_results, tylko dla właściciela).
ALTER TABLE public.personality_result_history DROP COLUMN IF EXISTS answers;

-- Jedna kanoniczna polityka odczytu właściciela (obie migracje tworzyły
-- wariant pod inną nazwą).
DROP POLICY IF EXISTS "personality history owner read" ON public.personality_result_history;
DROP POLICY IF EXISTS personality_history_owner_read ON public.personality_result_history;
CREATE POLICY personality_history_owner_read
  ON public.personality_result_history FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Jeden trigger historii (na świeżej bazie 100000+102702 zostawały dwa,
-- czyli podwójne wpisy przy każdym podejściu).
CREATE OR REPLACE FUNCTION public.personality_results_append_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- UPDATE bez zmiany wyników ani daty podejścia nie tworzy wpisu.
  IF TG_OP = 'UPDATE'
     AND NEW.taken_at IS NOT DISTINCT FROM OLD.taken_at
     AND NEW.openness = OLD.openness
     AND NEW.conscientiousness = OLD.conscientiousness
     AND NEW.extraversion = OLD.extraversion
     AND NEW.agreeableness = OLD.agreeableness
     AND NEW.neuroticism = OLD.neuroticism THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.personality_result_history
      (user_id, tenant_id, openness, conscientiousness, extraversion, agreeableness, neuroticism, taken_at)
    VALUES
      (NEW.user_id, NEW.tenant_id, NEW.openness, NEW.conscientiousness,
       NEW.extraversion, NEW.agreeableness, NEW.neuroticism, COALESCE(NEW.taken_at, now()));
  EXCEPTION WHEN OTHERS THEN
    -- Historia nigdy nie może zablokować zapisu samego wyniku.
    RAISE WARNING 'personality history append failed: %', SQLERRM;
  END;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS personality_results_history_trg ON public.personality_results;
DROP TRIGGER IF EXISTS personality_results_append_history_trg ON public.personality_results;
CREATE TRIGGER personality_results_append_history_trg
  AFTER INSERT OR UPDATE ON public.personality_results
  FOR EACH ROW EXECUTE FUNCTION public.personality_results_append_history();
