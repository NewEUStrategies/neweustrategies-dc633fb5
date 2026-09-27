-- CZESC 6/6 MIGRACJI 0057_event_cfp.sql
-- migration-split: part 6/6 of 0057_event_cfp.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 0057_event_cfp.sql,
-- potem 0057_event_cfp_part2.sql .. 0057_event_cfp_part6.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.

CREATE OR REPLACE FUNCTION public.event_cfp_review_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_submission uuid := NULLIF(p_payload->>'submission_id', '')::uuid;
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_rv public.event_cfp_reviewers%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_max integer;
  v_keys text[];
  v_scores jsonb := '{}'::jsonb;
  v_entry record;
  v_value integer;
  v_overall integer;
  v_recommendation text := NULLIF(p_payload->>'recommendation', '');
  v_conflict boolean := COALESCE(CASE WHEN jsonb_typeof(p_payload->'conflict_of_interest') = 'boolean'
    THEN (p_payload->>'conflict_of_interest')::boolean END, false);
  v_private text := btrim(COALESCE(p_payload->>'comment_private', ''));
  v_to_speaker text := btrim(COALESCE(p_payload->>'comment_to_speaker', ''));
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to review submissions';
  END IF;
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = v_submission
   FOR UPDATE;
  SELECT rv.* INTO v_rv
    FROM public.event_cfp_reviewers rv
   WHERE rv.tenant_id = v_tenant AND rv.event_id = v_sub.event_id AND rv.user_id = v_uid AND rv.is_active;
  IF v_rv.id IS NULL OR NOT public._event_cfp_reviewable(v_tenant, v_uid, v_rv.id, v_submission) THEN
    RAISE EXCEPTION 'not_found: submission is not in your review queue';
  END IF;
  SELECT s.* INTO v_s
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_sub.event_id;
  v_max := COALESCE(v_s.score_max, 5);
  SELECT COALESCE(array_agg(c->>'key'), ARRAY[]::text[]) INTO v_keys
    FROM jsonb_array_elements(COALESCE(v_s.review_criteria, '[]'::jsonb)) c;

  IF v_recommendation IS NOT NULL AND v_recommendation NOT IN ('accept', 'maybe', 'reject', 'abstain') THEN
    RAISE EXCEPTION 'invalid_recommendation: recommendation must be accept, maybe, reject or abstain';
  END IF;

  IF p_payload ? 'scores' AND jsonb_typeof(p_payload->'scores') IS DISTINCT FROM 'null' THEN
    IF jsonb_typeof(p_payload->'scores') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_scores: scores must be an object';
    END IF;
    FOR v_entry IN SELECT key, value FROM jsonb_each(p_payload->'scores') LOOP
      CONTINUE WHEN jsonb_typeof(v_entry.value) = 'null';
      v_value := public._event_cfp_jsonb_int(v_entry.value);
      IF NOT (v_entry.key = ANY (v_keys)) OR v_value IS NULL OR v_value NOT BETWEEN 1 AND v_max THEN
        RAISE EXCEPTION 'invalid_scores: every score must be a known criterion scored 1-%', v_max;
      END IF;
      v_scores := v_scores || jsonb_build_object(v_entry.key, v_value);
    END LOOP;
  END IF;

  IF jsonb_typeof(p_payload->'overall') IN ('number', 'string') THEN
    v_overall := public._event_cfp_jsonb_int(p_payload->'overall');
    IF v_overall IS NULL OR v_overall NOT BETWEEN 1 AND v_max THEN
      RAISE EXCEPTION 'invalid_score: the overall score must be 1-%', v_max;
    END IF;
  END IF;
  IF v_overall IS NULL AND NOT v_conflict AND v_recommendation IS DISTINCT FROM 'abstain' THEN
    RAISE EXCEPTION 'score_required: give an overall score, abstain or declare a conflict of interest';
  END IF;
  IF char_length(v_private) > 4000 OR char_length(v_to_speaker) > 4000 THEN
    RAISE EXCEPTION 'invalid_comment: comments are limited to 4000 characters';
  END IF;

  INSERT INTO public.event_cfp_reviews AS r (
    tenant_id, event_id, submission_id, reviewer_id, scores, overall, recommendation,
    comment_private, comment_to_speaker, conflict_of_interest
  ) VALUES (
    v_tenant, v_sub.event_id, v_submission, v_rv.id, v_scores, v_overall, v_recommendation,
    v_private, v_to_speaker, v_conflict
  )
  ON CONFLICT (tenant_id, submission_id, reviewer_id) DO UPDATE SET
    scores = EXCLUDED.scores,
    overall = EXCLUDED.overall,
    recommendation = EXCLUDED.recommendation,
    comment_private = EXCLUDED.comment_private,
    comment_to_speaker = EXCLUDED.comment_to_speaker,
    conflict_of_interest = EXCLUDED.conflict_of_interest
  RETURNING r.id INTO v_id;

  -- Pierwsza ocena rusza zgloszenie z kolejki "wyslane" do "w ocenie" - bez
  -- sladu decyzji czlowieka.
  IF v_sub.status = 'submitted' THEN
    UPDATE public.event_cfp_submissions s SET status = 'under_review'
     WHERE s.tenant_id = v_tenant AND s.id = v_submission;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_cfp_review',
    v_id::text,
    'event_cfp_review.saved.v1',
    jsonb_build_object('event_id', v_sub.event_id, 'submission_id', v_submission, 'review_id', v_id),
    v_uid
  );

  RETURN jsonb_build_object('id', v_id, 'submission_id', v_submission);
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_review_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_review_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_review_save(jsonb) IS
  'Zapis oceny recenzenta (kryteria 1..score_max, ocena ogolna, rekomendacja, komentarze, konflikt interesow). Pierwsza ocena przestawia submitted na under_review. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

-- ----------------------------------------------------------------------------
-- 22) EKSPORT RODO: DANE NABORU WOLAJACEGO
--
-- Eksport danych osobowych (`src/lib/profile/export.functions.ts`) sklada
-- paczke z sekcji; tabele naboru maja wylacznie polityki odczytu dla
-- administratora, wiec zapytanie `.from("event_cfp_*")` z klienta uzytkownika
-- oddaloby PUSTKE wygladajaca jak "nie korzystam". Jedno RPC SECURITY DEFINER
-- (wzorzec `club_export_my_data`) oddaje dane wolajacego, rozbite w TS na
-- sekcje manifestu:
--   * `event_cfp_submissions` - zgloszenia, ktore wolajacy wyslal albo w ktorych
--     jest wpisany jako prelegent (karta uczestnika z `event_people.user_id`
--     ALBO - zanim przyjecie zalozy kartoteke - adres KONTA wpisany przez
--     zglaszajacego): tresc wystapienia, stany i daty oraz wlasne wiersze
--     wystepujacego (`my_speaker_entries` - to, co ktos wpisal o wolajacym).
--     Tylko ZGLASZAJACY dostaje dodatkowo odpowiedzi, jezyk poczty,
--     informacje zwrotna i ocene zbiorcza (srednia po decyzji i z co najmniej
--     dwoch ocen) - to jego dane, nie wspolprelegenta. Pozostali wystepujacy:
--     imie, nazwisko i rola - BEZ adresu e-mail, stanowiska i firmy (dane
--     kontaktowe innych osob, art. 15 ust. 4 RODO);
--   * `event_speaker_materials` - materialy nakladek scenicznych wolajacego;
--   * `event_cfp_reviewer_roles` - role recenzenta w naborach;
--   * `event_cfp_reviews_written` - WLASNE oceny recenzenta (tresc autorska
--     wolajacego), z tytulem zgloszenia bez danych prelegentow.
-- NIE wychodza: notatka wewnetrzna decyzji (`decision_note`) i pojedyncze oceny
-- recenzentow o zgloszeniu wolajacego - wewnetrzna ocena pisana przez inne
-- osoby (wylaczenie `event_cfp_assessments` w manifescie).
--
-- Najemca z profilu wolajacego (jak `club_export_my_data`): eksport biegnie po
-- stronie serwera i nie niesie naglowka hosta.
-- ----------------------------------------------------------------------------

-- Czy wiersz wystepujacego opisuje WOLAJACEGO: po kartotece z kontem albo -
-- zanim przyjecie zalozy kartoteke - po adresie KONTA wpisanym przez
-- zglaszajacego (ten sam dowod, co w `_event_cfp_reviewable`). Adres nie
-- wygrywa z wierszem przypietym do kartoteki INNEGO konta.
CREATE OR REPLACE FUNCTION public._event_cfp_speaker_row_is_mine(
  p_tenant uuid, p_person_id uuid, p_email text, p_uid uuid, p_people uuid[], p_account_email text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (p_person_id IS NOT NULL AND p_person_id = ANY (COALESCE(p_people, '{}'::uuid[])))
    OR (
      p_account_email IS NOT NULL
      AND lower(btrim(p_email)) = p_account_email
      AND NOT EXISTS (
        SELECT 1 FROM public.event_people p
         WHERE p.tenant_id = p_tenant AND p.id = p_person_id
           AND p.user_id IS NOT NULL AND p.user_id <> p_uid
      )
    ),
    false)
$$;

REVOKE ALL ON FUNCTION public._event_cfp_speaker_row_is_mine(uuid, uuid, text, uuid, uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_speaker_row_is_mine(uuid, uuid, text, uuid, uuid[], text) TO service_role;

COMMENT ON FUNCTION public._event_cfp_speaker_row_is_mine(uuid, uuid, text, uuid, uuid[], text) IS
  'Czy wiersz wystepujacego nalezy do wolajacego: kartoteka z jego kontem albo adres jego konta wpisany przez zglaszajacego (o ile wiersz nie jest przypiety do kartoteki innego konta).';

CREATE OR REPLACE FUNCTION public.event_cfp_export_my_data(p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  -- Sufit przychodzi z warstwy aplikacji, bramka jest tutaj: eksport ma byc
  -- plikiem, nie zrzutem bazy.
  v_limit integer := greatest(1, least(COALESCE(p_limit, 2000), 5000));
  v_people uuid[];
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to export your data';
  END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: profile does not exist';
  END IF;
  SELECT COALESCE(array_agg(p.id), '{}'::uuid[]) INTO v_people
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.user_id = v_uid;
  SELECT NULLIF(lower(btrim(u.email)), '') INTO v_email FROM auth.users u WHERE u.id = v_uid;

  RETURN jsonb_build_object(
    'event_cfp_submissions', (
      SELECT COALESCE(jsonb_agg(t.doc ORDER BY t.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT s.created_at,
            jsonb_build_object(
              'event_slug', e.slug, 'event_title_pl', e.title_pl, 'event_title_en', e.title_en,
              'status', s.status,
              'is_submitter', mine.is_submitter,
              'my_roles', (
                SELECT COALESCE(jsonb_agg(ss.role ORDER BY ss.sort_order), '[]'::jsonb)
                  FROM public.event_cfp_submission_speakers ss
                 WHERE ss.tenant_id = s.tenant_id AND ss.submission_id = s.id
                   AND public._event_cfp_speaker_row_is_mine(ss.tenant_id, ss.person_id, ss.email, v_uid, v_people, v_email)
              ),
              -- Dane, ktore zglaszajacy (albo organizator) wpisal O WOLAJACYM.
              'my_speaker_entries', (
                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'first_name', ss.first_name, 'last_name', ss.last_name, 'email', ss.email,
                  'job_title', ss.job_title, 'company_text', ss.company_text, 'role', ss.role,
                  'is_primary', ss.is_primary)
                  ORDER BY ss.sort_order), '[]'::jsonb)
                  FROM public.event_cfp_submission_speakers ss
                 WHERE ss.tenant_id = s.tenant_id AND ss.submission_id = s.id
                   AND public._event_cfp_speaker_row_is_mine(ss.tenant_id, ss.person_id, ss.email, v_uid, v_people, v_email)
              ),
              'title_pl', s.title_pl, 'title_en', s.title_en,
              'abstract_pl', s.abstract_pl, 'abstract_en', s.abstract_en,
              'talk_language', s.talk_language,
              'format_key', s.format_key, 'duration_min', s.duration_min,
              'track_name_pl', tr.name_pl, 'track_name_en', tr.name_en,
              'topics', to_jsonb(s.topics),
              'co_speakers', (
                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'first_name', ss.first_name, 'last_name', ss.last_name, 'role', ss.role)
                  ORDER BY ss.sort_order), '[]'::jsonb)
                  FROM public.event_cfp_submission_speakers ss
                 WHERE ss.tenant_id = s.tenant_id AND ss.submission_id = s.id
                   AND NOT public._event_cfp_speaker_row_is_mine(ss.tenant_id, ss.person_id, ss.email, v_uid, v_people, v_email)
              ),
              'submitted_at', s.submitted_at, 'decided_at', s.decided_at,
              'withdrawn_at', s.withdrawn_at, 'confirmed_at', s.confirmed_at,
              'declined_at', s.declined_at,
              'created_at', s.created_at, 'updated_at', s.updated_at
            )
            -- Tylko ZGLASZAJACY: odpowiedzi na pytania organizatora, jezyk
            -- jego poczty, informacja zwrotna do niego i ocena zbiorcza. To dane
            -- zglaszajacego, nie wspolprelegenta - ten dostaje metadane
            -- wystapienia i wlasny wiersz wystepujacego.
            || CASE WHEN mine.is_submitter THEN jsonb_build_object(
              'answers', s.answers,
              'notify_lang', s.notify_lang,
              'feedback_to_speaker', CASE
                WHEN s.status IN ('changes_requested', 'accepted', 'waitlisted', 'rejected', 'confirmed', 'declined')
                  THEN s.feedback_to_speaker ELSE '' END,
              -- Ocena zbiorcza jak w panelu prelegenta: liczba ocen zawsze,
              -- srednia po decyzji i z co najmniej dwoch ocen - nigdy
              -- pojedyncze oceny.
              'review_summary', public._event_cfp_speaker_review_summary(
                s.tenant_id, s.id, s.status, cs.min_reviews)
            ) ELSE '{}'::jsonb END AS doc
            FROM public.event_cfp_submissions s
            JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
            LEFT JOIN public.event_tracks tr ON tr.tenant_id = s.tenant_id AND tr.id = s.track_id
            LEFT JOIN public.event_cfp_settings cs ON cs.tenant_id = s.tenant_id AND cs.event_id = s.event_id
            CROSS JOIN LATERAL (SELECT s.person_id = ANY (v_people) AS is_submitter) mine
           WHERE s.tenant_id = v_tenant
             AND (
               mine.is_submitter
               OR EXISTS (
                 SELECT 1 FROM public.event_cfp_submission_speakers ss
                  WHERE ss.tenant_id = s.tenant_id AND ss.submission_id = s.id
                    AND public._event_cfp_speaker_row_is_mine(ss.tenant_id, ss.person_id, ss.email, v_uid, v_people, v_email)
               )
             )
           ORDER BY s.created_at DESC
           LIMIT v_limit
        ) t
    ),
    'event_speaker_materials', (
      SELECT COALESCE(jsonb_agg(t.doc ORDER BY t.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT m.created_at, jsonb_build_object(
            'event_slug', e.slug, 'kind', m.kind,
            'title_pl', m.title_pl, 'title_en', m.title_en, 'url', m.url,
            'visibility', m.visibility, 'is_published', m.is_published,
            'published_at', m.published_at,
            'created_at', m.created_at, 'updated_at', m.updated_at
          ) AS doc
            FROM public.event_speaker_materials m
            JOIN public.events e ON e.tenant_id = m.tenant_id AND e.id = m.event_id
            JOIN public.speaker_profiles sp ON sp.tenant_id = m.tenant_id AND sp.id = m.speaker_profile_id
           WHERE m.tenant_id = v_tenant
             AND (sp.user_id = v_uid OR sp.person_id = ANY (v_people))
           ORDER BY m.created_at DESC
           LIMIT v_limit
        ) t
    ),
    'event_cfp_reviewer_roles', (
      SELECT COALESCE(jsonb_agg(t.doc ORDER BY t.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT rv.created_at, jsonb_build_object(
            'event_slug', e.slug, 'event_title_pl', e.title_pl, 'event_title_en', e.title_en,
            'is_active', rv.is_active, 'can_see_identity', rv.can_see_identity,
            'track_names', (
              SELECT COALESCE(jsonb_agg(jsonb_build_object('name_pl', tr.name_pl, 'name_en', tr.name_en)
                ORDER BY tr.sort_order, tr.key), '[]'::jsonb)
                FROM public.event_tracks tr
               WHERE tr.tenant_id = rv.tenant_id AND tr.id = ANY (rv.track_ids)
            ),
            'created_at', rv.created_at, 'updated_at', rv.updated_at
          ) AS doc
            FROM public.event_cfp_reviewers rv
            JOIN public.events e ON e.tenant_id = rv.tenant_id AND e.id = rv.event_id
           WHERE rv.tenant_id = v_tenant AND rv.user_id = v_uid
           ORDER BY rv.created_at DESC
           LIMIT v_limit
        ) t
    ),
    'event_cfp_reviews_written', (
      SELECT COALESCE(jsonb_agg(t.doc ORDER BY t.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT r.created_at, jsonb_build_object(
            'event_slug', e.slug,
            'submission_title_pl', s.title_pl, 'submission_title_en', s.title_en,
            'scores', r.scores, 'overall', r.overall, 'recommendation', r.recommendation,
            'comment_private', r.comment_private, 'comment_to_speaker', r.comment_to_speaker,
            'conflict_of_interest', r.conflict_of_interest,
            'created_at', r.created_at, 'updated_at', r.updated_at
          ) AS doc
            FROM public.event_cfp_reviews r
            JOIN public.event_cfp_reviewers rv ON rv.tenant_id = r.tenant_id AND rv.id = r.reviewer_id
            JOIN public.event_cfp_submissions s ON s.tenant_id = r.tenant_id AND s.id = r.submission_id
            JOIN public.events e ON e.tenant_id = r.tenant_id AND e.id = r.event_id
           WHERE r.tenant_id = v_tenant AND rv.user_id = v_uid
           ORDER BY r.created_at DESC
           LIMIT v_limit
        ) t
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_export_my_data(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_export_my_data(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_export_my_data(integer) IS
  'Eksport RODO naboru prelegentow WOLAJACEGO: zgloszenia (wlasne i z jego udzialem - takze po adresie konta, zanim powstanie kartoteka), materialy prelegenta, role i wlasne oceny recenzenta. Wspolprelegent bez odpowiedzi i informacji zwrotnej zglaszajacego. Bez notatki decyzji, cudzych ocen i danych kontaktowych innych wystepujacych (art. 15 ust. 4 RODO). Najemca z profilu wolajacego, tozsamosc z auth.uid().';
