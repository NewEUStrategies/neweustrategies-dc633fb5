-- Alerty do zapisanych wyszukiwań (P0 z OCENA_MODULOW_2026-07-20 §3.5).
--
-- Kontekst:
--   * saved_searches istnieje (nazwa + snapshot parametrów URL), a cała
--     dalsza rura doręczeń już działa: enqueue_notification -> in-app +
--     web push (notification_push_queue) + digest e-mail (claim_due_digests).
--     Brakowało wyłącznie PRODUCENTA: "pojawiły się nowe wyniki dla
--     zapisanego zapytania" nie jest zdarzeniem jednego wiersza, więc
--     wymaga skanu cyklicznego, nie triggera (por. follow_publish_alerts).
--
-- Zakres:
--   1. saved_searches: alert_enabled + url (kanoniczny link do wyników) +
--      znaki wodne (last_seen_published_at / last_alert_at /
--      last_alert_check_at) + trigger stemplujący znak wodny przy włączeniu.
--   2. Nowy kind powiadomień 'saved_search' (CHECK + kolumna preferencji
--      enabled_saved_search + rozszerzony CASE w enqueue_notification) -
--      wzorzec z 20260714120000 / 20260717162432.
--   3. nes_post_matches_term_group: dopasowanie grupy termów (CSV uuid-ów,
--      OR wewnątrz grupy, poddrzewo jak term_tree w search_posts) - gotowe
--      na multi-select fasetów (dziś grupy są 1-elementowe).
--   4. run_saved_search_alerts: skan zapisanych wyszukiwań z alertem,
--      zliczenie NOWYCH opublikowanych wpisów ponad znak wodny w tenancie
--      zapisu (bez zależności od kontekstu żądania - pg_cron nie ma
--      current_tenant_id) i enqueue_notification per zapis.
--   5. Harmonogram pg_cron co 20 minut (wzorzec guardowany jak jobs-tick).
--
-- Świadome uproszczenia producenta względem search_posts: bez fallbacku
-- trigramowego (alert od literówki byłby szumem) i bez rankingu (liczy się
-- "ile nowych", nie kolejność).

-- 1. Kolumny + trigger znaku wodnego ------------------------------------------

ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS alert_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS url text,
  ADD COLUMN IF NOT EXISTS last_seen_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_alert_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_alert_check_at timestamptz;

CREATE INDEX IF NOT EXISTS saved_searches_alert_enabled_idx
  ON public.saved_searches (last_alert_check_at)
  WHERE alert_enabled;

-- Włączenie alertu bez znaku wodnego = alert "od teraz" - nigdy zalew
-- powiadomień o historycznych wynikach.
CREATE OR REPLACE FUNCTION public.saved_searches_alert_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.alert_enabled
     AND (TG_OP = 'INSERT' OR NOT OLD.alert_enabled)
     AND NEW.last_seen_published_at IS NULL THEN
    NEW.last_seen_published_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saved_searches_alert_defaults ON public.saved_searches;
CREATE TRIGGER trg_saved_searches_alert_defaults
  BEFORE INSERT OR UPDATE OF alert_enabled ON public.saved_searches
  FOR EACH ROW
  EXECUTE FUNCTION public.saved_searches_alert_defaults();

-- 2. Kind 'saved_search' ------------------------------------------------------

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_saved_search boolean NOT NULL DEFAULT true;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection','saved_search'))
  NOT VALID;

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text, p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tenant uuid; v_id uuid; v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN RETURN NULL; END IF;
  IF p_kind <> 'security' THEN
    SELECT CASE p_kind
             WHEN 'message'      THEN np.enabled_message
             WHEN 'comment'      THEN np.enabled_comment
             WHEN 'follow'       THEN np.enabled_follow
             WHEN 'subscription' THEN np.enabled_subscription
             WHEN 'content'      THEN np.enabled_content
             WHEN 'system'       THEN np.enabled_system
             WHEN 'tracker'      THEN np.enabled_tracker
             WHEN 'connection'   THEN np.enabled_connection
             WHEN 'saved_search' THEN np.enabled_saved_search
             ELSE true END
      INTO v_enabled FROM public.notification_preferences np WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN RETURN NULL; END IF;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '')
      AND n.created_at > now() - interval '5 minutes') THEN RETURN NULL; END IF;
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
  ) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$;

-- 3. Dopasowanie grupy termów (CSV uuid, OR w grupie, AND między grupami) -----
-- Poddrzewo jak term_tree w search_posts v5 (region -> państwa); pusta /
-- nie-uuid grupa = brak filtra. Gotowe na multi-select (CSV wielu uuid-ów).

CREATE OR REPLACE FUNCTION public.nes_post_matches_term_group(
  p_post_id uuid,
  p_group_csv text
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE req AS (
    SELECT btrim(x)::uuid AS term_id
      FROM unnest(string_to_array(coalesce(p_group_csv, ''), ',')) AS x
     WHERE btrim(x) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  tree AS (
    SELECT r.term_id AS match_id, 0 AS depth FROM req r
    UNION ALL
    SELECT c.id, t.depth + 1
      FROM public.categories c
      JOIN tree t ON c.parent_id = t.match_id
     WHERE t.depth < 10
  )
  SELECT NOT EXISTS (SELECT 1 FROM req)
      OR EXISTS (
           SELECT 1
             FROM public.post_categories pc
             JOIN tree t ON t.match_id = pc.category_id
            WHERE pc.post_id = p_post_id
         );
$$;

-- 4. Producent ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_saved_search_alerts(p_max_searches integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  s record;
  v_q text; v_match text; v_scope text;
  v_tq tsquery;
  v_author uuid;
  v_format text; v_lang text; v_access text;
  v_from timestamptz; v_to timestamptz;
  v_year text;
  v_count bigint; v_max_pub timestamptz;
  v_href text; v_body_pl text; v_body_en text;
  v_sent integer := 0;
BEGIN
  FOR s IN
    SELECT ss.id, ss.user_id, ss.tenant_id, ss.name, ss.params, ss.url,
           coalesce(ss.last_seen_published_at, ss.created_at) AS watermark
      FROM public.saved_searches ss
     WHERE ss.alert_enabled
     ORDER BY coalesce(ss.last_alert_check_at, to_timestamp(0)) ASC
     LIMIT GREATEST(LEAST(coalesce(p_max_searches, 200), 1000), 1)
  LOOP
    BEGIN
      v_q := nullif(btrim(coalesce(s.params->>'q', '')), '');
      v_match := coalesce(nullif(s.params->>'match', ''), 'all');
      v_scope := coalesce(nullif(s.params->>'scope', ''),
                          CASE WHEN s.params->>'tab' = 'titles' THEN 'title' ELSE 'all' END);
      v_tq := CASE WHEN v_q IS NULL THEN NULL
                   ELSE public.nes_search_tsquery_adv(v_q, v_match) END;
      v_author := CASE
        WHEN coalesce(s.params->>'author', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (s.params->>'author')::uuid END;
      v_format := nullif(s.params->>'format', '');
      v_lang := nullif(s.params->>'lang', '');
      v_access := nullif(s.params->>'access', '');
      v_year := nullif(s.params->>'year', '');
      v_from := CASE WHEN nullif(s.params->>'from', '') IS NOT NULL
                     THEN (s.params->>'from')::timestamptz END;
      v_to := CASE WHEN nullif(s.params->>'to', '') IS NOT NULL
                   THEN (s.params->>'to')::timestamptz END;
      -- Rok mapuje się na zakres dat tylko przy braku jawnych from/to
      -- (lustro urlToFilters po stronie klienta).
      IF v_year ~ '^[0-9]{4}$' AND v_from IS NULL AND v_to IS NULL THEN
        v_from := (v_year || '-01-01')::timestamptz;
        v_to := (v_year || '-12-31')::timestamptz;
      END IF;

      SELECT count(*), max(p.published_at)
        INTO v_count, v_max_pub
        FROM public.posts p
        LEFT JOIN public.content_access ca
          ON ca.entity_type = 'post' AND ca.entity_id = p.id
       WHERE p.tenant_id = s.tenant_id
         AND p.status = 'published'
         AND p.deleted_at IS NULL
         AND p.published_at > s.watermark
         AND p.published_at <= now()
         AND (v_tq IS NULL OR p.search_vector @@ v_tq)
         AND (v_tq IS NULL OR v_scope IS DISTINCT FROM 'title'
              OR to_tsvector('simple', unaccent(
                   coalesce(p.title_pl, '') || ' ' || coalesce(p.title_en, ''))) @@ v_tq)
         AND (v_author IS NULL OR p.author_id = v_author)
         AND (v_format IS NULL OR p.post_format = v_format)
         AND (v_lang IS NULL
              OR (v_lang = 'pl' AND btrim(p.title_pl) <> '')
              OR (v_lang = 'en' AND btrim(p.title_en) <> ''))
         AND (v_access IS NULL OR coalesce(ca.mode::text, 'public') = v_access)
         AND (v_from IS NULL OR p.published_at >= v_from)
         AND (v_to IS NULL OR p.published_at <= v_to)
         AND public.nes_post_matches_term_group(p.id, s.params->>'spec')
         AND public.nes_post_matches_term_group(p.id, s.params->>'type')
         AND public.nes_post_matches_term_group(p.id, s.params->>'region')
         AND public.nes_post_matches_term_group(p.id, s.params->>'topic')
         AND public.nes_post_matches_term_group(p.id, s.params->>'project')
         AND public.nes_post_matches_term_group(p.id, s.params->>'series')
         AND public.nes_post_matches_term_group(p.id, s.params->>'org');

      UPDATE public.saved_searches SET last_alert_check_at = now() WHERE id = s.id;

      IF coalesce(v_count, 0) > 0 THEN
        v_href := coalesce(nullif(btrim(s.url), ''), '/search');
        v_body_pl := CASE
          WHEN v_count = 1 THEN '1 nowa publikacja dla zapisanego wyszukiwania'
          WHEN v_count % 10 BETWEEN 2 AND 4 AND v_count % 100 NOT BETWEEN 12 AND 14
            THEN v_count::text || ' nowe publikacje dla zapisanego wyszukiwania'
          ELSE v_count::text || ' nowych publikacji dla zapisanego wyszukiwania'
        END;
        v_body_en := CASE
          WHEN v_count = 1 THEN '1 new publication for your saved search'
          ELSE v_count::text || ' new publications for your saved search'
        END;
        PERFORM public.enqueue_notification(
          s.user_id, 'saved_search',
          'Nowe wyniki: ' || s.name,
          'New results: ' || s.name,
          v_body_pl, v_body_en, v_href, 'search');
        UPDATE public.saved_searches
           SET last_seen_published_at = greatest(coalesce(v_max_pub, now()), s.watermark),
               last_alert_at = now()
         WHERE id = s.id;
        v_sent := v_sent + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Zepsuty pojedynczy zapis (np. ręcznie zmodyfikowane params) nie może
      -- zatrzymać całego przebiegu - odnotuj próbę i idź dalej.
      UPDATE public.saved_searches SET last_alert_check_at = now() WHERE id = s.id;
    END;
  END LOOP;
  RETURN v_sent;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_saved_search_alerts(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_saved_search_alerts(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.run_saved_search_alerts(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_saved_search_alerts(integer) TO service_role;

-- 5. Harmonogram (guardowany wzorzec jak jobs-tick) ---------------------------

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron not installed - saved-search-alerts not scheduled';
    RETURN;
  END IF;
  PERFORM cron.schedule(
    'saved-search-alerts',
    '*/20 * * * *',
    'SELECT public.run_saved_search_alerts()'
  );
END $$;
