-- ============================================================================
-- SPOŁECZNOŚĆ: reputacja/poziomy na bazie istniejących odznak i aktywności
-- + tablica kontrybutorów.
--
-- Zero nowych tabel zdarzeń - punkty liczone są z danych, które już istnieją
-- (odznaki, Q&A, ankiety, komentarze, RSVP, zgłoszenia gościnne). Jedna
-- funkcja wewnętrzna trzyma wagi, dwa RPC konsumują:
--
--   * contribution_scores(p_since)     wewnętrzna, set-based; wagi w jednym
--                                      miejscu (breakdown jsonb per źródło),
--   * get_contributor_leaderboard      tablica kontrybutorów - wyłącznie
--                                      profile discoverable=true (ta sama
--                                      granica prywatności co katalog /people)
--                                      i bez kont redakcyjnych (redakcja nie
--                                      konkuruje ze społecznością),
--   * get_my_reputation                własne punkty niezależnie od
--                                      widoczności (każdy widzi swój wynik,
--                                      na tablicy pojawia się po opt-in).
--
-- Oba RPC tylko dla zalogowanych - tak jak katalog osób. Poziomy (Obserwator
-- -> Filar społeczności) są czystą prezentacją progów punktowych po stronie
-- klienta (src/lib/community/reputation.ts).
--
-- Wagi (przejrzyste, do strojenia w jednym CASE):
--   odpowiedziane pytanie Q&A 10 | zaakceptowane pytanie 3 | głos otrzymany 2
--   udział w wydarzeniu (going, po starcie) 5 | komentarz approved 2
--   głos w ankiecie 1 | przyjęty tekst gościnny 25
--   odznaki: expert 50 | contributor 30 | verified 10 (bezterminowe)
--
-- Wszystko idempotentne.
-- ============================================================================

-- Indeks pod agregacje per użytkownik (poll_votes ma tylko PK poll_id+user_id).
CREATE INDEX IF NOT EXISTS idx_poll_votes_user
  ON public.poll_votes (user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.contribution_scores(p_since timestamptz)
RETURNS TABLE (user_id uuid, points integer, breakdown jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (
    -- Q&A: pytania, na które ekspert odpowiedział (najwyższa wartość wiedzy).
    SELECT q.user_id, 'qa_answered'::text AS kind, count(*)::integer AS n
      FROM public.qa_questions q
     WHERE q.tenant_id = public.public_tenant_id()
       AND q.status = 'answered'
       AND q.created_at >= p_since
     GROUP BY q.user_id

    UNION ALL
    -- Q&A: pytania przyjęte przez moderację (statusy są rozłączne z 'answered').
    SELECT q.user_id, 'qa_approved', count(*)::integer
      FROM public.qa_questions q
     WHERE q.tenant_id = public.public_tenant_id()
       AND q.status = 'approved'
       AND q.created_at >= p_since
     GROUP BY q.user_id

    UNION ALL
    -- Q&A: głosy społeczności otrzymane na własne pytania.
    SELECT q.user_id, 'qa_votes_received', count(*)::integer
      FROM public.qa_question_votes qv
      JOIN public.qa_questions q ON q.id = qv.question_id
     WHERE q.tenant_id = public.public_tenant_id()
       AND qv.created_at >= p_since
     GROUP BY q.user_id

    UNION ALL
    -- Wydarzenia: potwierdzony udział (going) w wydarzeniach, które już
    -- wystartowały w oknie - RSVP na przyszłe terminy jeszcze nie punktuje.
    SELECT r.user_id, 'events_attended', count(*)::integer
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
     WHERE e.tenant_id = public.public_tenant_id()
       AND e.status = 'published'
       AND r.status = 'going'
       AND e.starts_at < now()
       AND e.starts_at >= p_since
     GROUP BY r.user_id

    UNION ALL
    -- Dyskusja: komentarze przyjęte przez moderację.
    SELECT c.user_id, 'comments', count(*)::integer
      FROM public.comments c
     WHERE c.tenant_id = public.public_tenant_id()
       AND c.status = 'approved'
       AND c.user_id IS NOT NULL
       AND c.created_at >= p_since
     GROUP BY c.user_id

    UNION ALL
    -- Ankiety: oddane głosy (niski, ale realny sygnał uczestnictwa).
    SELECT pv.user_id, 'poll_votes', count(*)::integer
      FROM public.poll_votes pv
     WHERE pv.tenant_id = public.public_tenant_id()
       AND pv.updated_at >= p_since
     GROUP BY pv.user_id

    UNION ALL
    -- Program kontrybutorów: przyjęte zgłoszenia tekstów gościnnych.
    SELECT cs.user_id, 'submissions_accepted', count(*)::integer
      FROM public.contributor_submissions cs
     WHERE cs.tenant_id = public.public_tenant_id()
       AND cs.status = 'accepted'
       AND cs.updated_at >= p_since
     GROUP BY cs.user_id

    UNION ALL
    -- Odznaki: bezterminowe sygnały zaufania nadane przez redakcję
    -- ('staff' celowo bez punktów - nie jest zasługą społecznościową).
    SELECT pb.user_id, 'badge_' || pb.badge, 1
      FROM public.profile_badges pb
     WHERE pb.tenant_id = public.public_tenant_id()
       AND pb.badge IN ('expert', 'contributor', 'verified')
  ),
  weighted AS (
    SELECT src.user_id, src.kind, src.n,
           src.n * CASE src.kind
             WHEN 'qa_answered'          THEN 10
             WHEN 'qa_approved'          THEN 3
             WHEN 'qa_votes_received'    THEN 2
             WHEN 'events_attended'      THEN 5
             WHEN 'comments'             THEN 2
             WHEN 'poll_votes'           THEN 1
             WHEN 'submissions_accepted' THEN 25
             WHEN 'badge_expert'         THEN 50
             WHEN 'badge_contributor'    THEN 30
             WHEN 'badge_verified'       THEN 10
             ELSE 0
           END AS pts
      FROM src
  )
  SELECT w.user_id,
         sum(w.pts)::integer AS points,
         jsonb_object_agg(w.kind, jsonb_build_object('count', w.n, 'points', w.pts)) AS breakdown
    FROM weighted w
   GROUP BY w.user_id;
$$;

-- Wewnętrzna: wagi nie są API klienckim.
REVOKE EXECUTE ON FUNCTION public.contribution_scores(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contribution_scores(timestamptz) TO service_role;

-- ----------------------------------------------------------------------------
-- Tablica kontrybutorów (opt-in prywatności jak /people, bez redakcji)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_contributor_leaderboard(
  p_days integer DEFAULT 90,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  board_position integer,
  user_id uuid,
  display_name text,
  avatar_url text,
  slug text,
  points integer,
  breakdown jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 90), 7), 365);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'reputation: authentication required';
  END IF;

  RETURN QUERY
  SELECT row_number() OVER (ORDER BY s.points DESC, p.display_name ASC NULLS LAST)::integer,
         s.user_id,
         COALESCE(NULLIF(btrim(p.display_name), ''), split_part(p.email, '@', 1)),
         p.avatar_url,
         p.slug,
         s.points,
         s.breakdown
    FROM public.contribution_scores(now() - make_interval(days => v_days)) s
    JOIN public.profiles p
      ON p.id = s.user_id
     AND p.tenant_id = public.public_tenant_id()
   WHERE p.discoverable = true
     AND NOT public.user_is_editorial(s.user_id)
     AND s.points > 0
   ORDER BY s.points DESC, p.display_name ASC NULLS LAST
   LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_contributor_leaderboard(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contributor_leaderboard(integer, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Własna reputacja (widoczna dla siebie także bez opt-in do tablicy)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_reputation(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 90), 7), 365);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_points integer := 0;
  v_breakdown jsonb := '{}'::jsonb;
  v_discoverable boolean := false;
  v_editorial boolean;
  v_position integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'reputation: authentication required';
  END IF;

  SELECT s.points, s.breakdown INTO v_points, v_breakdown
    FROM public.contribution_scores(v_since) s
   WHERE s.user_id = v_user;

  SELECT COALESCE(p.discoverable, false) INTO v_discoverable
    FROM public.profiles p
   WHERE p.id = v_user AND p.tenant_id = public.public_tenant_id();

  v_editorial := public.user_is_editorial(v_user);

  -- Pozycja na tablicy tylko dla widocznych na niej (spójne z leaderboardem).
  IF v_discoverable AND NOT v_editorial AND COALESCE(v_points, 0) > 0 THEN
    SELECT count(*) + 1 INTO v_position
      FROM public.contribution_scores(v_since) s
      JOIN public.profiles p
        ON p.id = s.user_id
       AND p.tenant_id = public.public_tenant_id()
     WHERE p.discoverable = true
       AND NOT public.user_is_editorial(s.user_id)
       AND s.points > COALESCE(v_points, 0);
  END IF;

  RETURN jsonb_build_object(
    'points', COALESCE(v_points, 0),
    'breakdown', COALESCE(v_breakdown, '{}'::jsonb),
    'window_days', v_days,
    'board_visible', v_discoverable AND NOT v_editorial,
    'position', v_position
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_reputation(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_reputation(integer) TO authenticated, service_role;
