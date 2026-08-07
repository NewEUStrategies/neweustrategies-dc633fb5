ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS entity text NOT NULL DEFAULT 'posts',
  ADD COLUMN IF NOT EXISTS last_seen_profile_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.saved_searches
    ADD CONSTRAINT saved_searches_entity_check
    CHECK (entity IN ('posts', 'people'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.saved_searches.entity IS
  'Co ten zapis obserwuje: ''posts'' (wyszukiwarka tresci) albo ''people'' (katalog osob). Rozgalezia run_saved_search_alerts.';
COMMENT ON COLUMN public.saved_searches.last_seen_profile_at IS
  'Znak wodny galezi ''people'': najnowszy created_at / intent_updated_at, ktory juz policzono w wyslanym alercie.';

CREATE INDEX IF NOT EXISTS saved_searches_alert_entity_idx
  ON public.saved_searches (entity, last_alert_check_at)
  WHERE alert_enabled;

CREATE OR REPLACE FUNCTION public.saved_searches_alert_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.alert_enabled
     AND (TG_OP = 'INSERT' OR NOT OLD.alert_enabled) THEN
    IF NEW.entity = 'people' THEN
      IF NEW.last_seen_profile_at IS NULL THEN
        NEW.last_seen_profile_at := now();
      END IF;
    ELSE
      IF NEW.last_seen_published_at IS NULL THEN
        NEW.last_seen_published_at := now();
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saved_searches_alert_defaults ON public.saved_searches;
CREATE TRIGGER trg_saved_searches_alert_defaults
  BEFORE INSERT OR UPDATE OF alert_enabled ON public.saved_searches
  FOR EACH ROW
  EXECUTE FUNCTION public.saved_searches_alert_defaults();

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
  v_max_pub timestamptz;
  v_norm text; v_esc text;
  v_spec text; v_company text; v_location text; v_role text;
  v_open text[]; v_verified boolean;
  v_max_seen timestamptz;
  v_count bigint;
  v_href text; v_body_pl text; v_body_en text;
  v_title_pl text; v_title_en text;
  v_sent integer := 0;
BEGIN
  FOR s IN
    SELECT ss.id, ss.user_id, ss.tenant_id, ss.name, ss.params, ss.url,
           COALESCE(ss.entity, 'posts') AS entity,
           COALESCE(ss.last_seen_published_at, ss.created_at) AS watermark_posts,
           COALESCE(ss.last_seen_profile_at, ss.created_at)   AS watermark_people
      FROM public.saved_searches ss
     WHERE ss.alert_enabled
     ORDER BY coalesce(ss.last_alert_check_at, to_timestamp(0)) ASC
     LIMIT GREATEST(LEAST(coalesce(p_max_searches, 200), 1000), 1)
  LOOP
    BEGIN
      IF s.entity = 'people' THEN
        v_norm := public.discovery_search_norm(coalesce(s.params->>'q', ''));
        v_esc  := public.like_escape(v_norm);
        v_spec     := nullif(btrim(coalesce(s.params->>'specialization', '')), '');
        v_company  := nullif(btrim(coalesce(s.params->>'company', '')), '');
        v_location := nullif(btrim(coalesce(s.params->>'location', '')), '');
        v_role     := nullif(btrim(coalesce(s.params->>'role', '')), '');
        v_verified := coalesce(s.params->>'verified', '') IN ('1', 'true');
        SELECT array_agg(code)
          INTO v_open
          FROM (
            SELECT btrim(x) AS code
              FROM unnest(string_to_array(coalesce(s.params->>'open', ''), ',')) AS x
             WHERE btrim(x) = ANY (public.nes_profile_open_to_catalog())
          ) k;

        SELECT count(*),
               max(GREATEST(p.created_at, coalesce(p.intent_updated_at, p.created_at)))
          INTO v_count, v_max_seen
          FROM public.profiles p
         WHERE p.tenant_id = s.tenant_id
           AND p.discoverable
           AND p.id <> s.user_id
           AND GREATEST(p.created_at, coalesce(p.intent_updated_at, p.created_at))
                 > s.watermark_people
           AND GREATEST(p.created_at, coalesce(p.intent_updated_at, p.created_at)) <= now()
           AND (v_norm = '' OR p.discovery_search LIKE '%' || v_esc || '%')
           AND (v_spec     IS NULL OR lower(btrim(p.specialization))  = lower(v_spec))
           AND (v_company  IS NULL OR lower(btrim(p.current_company)) = lower(v_company))
           AND (v_location IS NULL OR lower(btrim(p.location))        = lower(v_location))
           AND (v_role     IS NULL OR lower(btrim(p.job_title))       = lower(v_role))
           AND (v_open IS NULL OR p.open_to && v_open)
           AND (NOT v_verified OR p.verified_at IS NOT NULL);

        UPDATE public.saved_searches SET last_alert_check_at = now() WHERE id = s.id;

        IF coalesce(v_count, 0) > 0 THEN
          v_href := coalesce(nullif(btrim(s.url), ''), '/people');
          v_title_pl := 'Nowe osoby: ' || s.name;
          v_title_en := 'New people: ' || s.name;
          v_body_pl := CASE
            WHEN v_count = 1 THEN '1 nowa osoba dla zapisanego wyszukiwania'
            WHEN v_count % 10 BETWEEN 2 AND 4 AND v_count % 100 NOT BETWEEN 12 AND 14
              THEN v_count::text || ' nowe osoby dla zapisanego wyszukiwania'
            ELSE v_count::text || ' nowych osob dla zapisanego wyszukiwania'
          END;
          v_body_en := CASE
            WHEN v_count = 1 THEN '1 new person matching your saved search'
            ELSE v_count::text || ' new people matching your saved search'
          END;
          PERFORM public.enqueue_notification(
            s.user_id, 'saved_search',
            v_title_pl, v_title_en, v_body_pl, v_body_en, v_href, 'UserSearch');
          UPDATE public.saved_searches
             SET last_seen_profile_at = greatest(coalesce(v_max_seen, now()), s.watermark_people),
                 last_alert_at = now()
           WHERE id = s.id;
          v_sent := v_sent + 1;
        END IF;

      ELSE
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
           AND p.published_at > s.watermark_posts
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
             SET last_seen_published_at = greatest(coalesce(v_max_pub, now()), s.watermark_posts),
                 last_alert_at = now()
           WHERE id = s.id;
          v_sent := v_sent + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.saved_searches SET last_alert_check_at = now() WHERE id = s.id;
    END;
  END LOOP;
  RETURN v_sent;
END;
$$;

COMMENT ON FUNCTION public.run_saved_search_alerts(integer) IS
  'Alerty zapisanych wyszukiwan dla DWOCH encji: posts (nowe publikacje ponad znak wodny) i people (nowy profil albo swiezo zadeklarowana intencja w katalogu tenanta autora zapisu).';

REVOKE EXECUTE ON FUNCTION public.run_saved_search_alerts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_saved_search_alerts(integer) TO service_role;