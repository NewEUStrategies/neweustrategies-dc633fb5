-- Linki do profilu: slug i trasa (author / people / NULL) z _profile_link_route w trzech RPC, rola wprowadzen 22023, intro_read: cel tylko forwarded (blizniak 20261002100000).
-- -- 0. Dokad link do osoby doprowadzi wolajacego ----------------------------
CREATE OR REPLACE FUNCTION public._profile_link_route(p_profile_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN btrim(COALESCE(p.slug, '')) = '' THEN NULL
           WHEN public.is_platform_author(p.id)
            AND p.tenant_id = public.public_tenant_id()
            AND public.profile_has_public_presence(p.id, p.tenant_id)
             THEN 'author'
           WHEN auth.uid() IS NOT NULL
            AND public.get_member_profile(p.slug) ->> 'id' = p.id::text
             THEN 'people'
         END
    FROM public.profiles p
   WHERE p.id = p_profile_id;
$$;

COMMENT ON FUNCTION public._profile_link_route(uuid) IS
  'Dokad link do osoby doprowadzi wolajacego: author (autor z publicznym hubem, '
  'otwiera sie takze bez sesji), people (get_member_profile rozwiazuje te osobe) '
  'albo NULL = nie linkuj. Bramki tras wolane, nie kopiowane. Nigdy UUID.';

REVOKE ALL ON FUNCTION public._profile_link_route(uuid) FROM PUBLIC, anon, authenticated;

-- -- 1. my_introduction_requests ---------------------------------------------
DROP FUNCTION IF EXISTS public.my_introduction_requests(TEXT);
CREATE FUNCTION public.my_introduction_requests(p_role TEXT DEFAULT 'bridge')
RETURNS TABLE (
  id UUID, requester_id UUID, requester_name TEXT, requester_avatar TEXT,
  target_id UUID, target_name TEXT, target_avatar TEXT,
  bridge_id UUID, bridge_name TEXT, bridge_avatar TEXT,
  message TEXT, status TEXT, created_at TIMESTAMPTZ,
  requester_slug TEXT, requester_route TEXT,
  target_slug TEXT, target_route TEXT,
  bridge_slug TEXT, bridge_route TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  -- Rola spoza trzech nie ma znaczenia: wpadala w `ELSE FALSE` i dawala pusta
  -- liste bez sygnalu. Teraz odmowa - wolajacy widzi blad, nie "brak danych".
  IF p_role IS NULL OR p_role NOT IN ('bridge', 'requester', 'target') THEN
    RAISE EXCEPTION 'invalid introduction role: %', COALESCE(p_role, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT i.id, i.requester_id, pr.display_name, pr.avatar_url,
           i.target_id, pt.display_name, pt.avatar_url,
           i.bridge_id, pb.display_name, pb.avatar_url,
           i.message, i.status, i.created_at,
           CASE WHEN lr.route IS NOT NULL THEN pr.slug END, lr.route,
           CASE WHEN lt.route IS NOT NULL THEN pt.slug END, lt.route,
           CASE WHEN lb.route IS NOT NULL THEN pb.slug END, lb.route
      FROM public.introduction_requests i
      JOIN public.profiles pr ON pr.id = i.requester_id
      JOIN public.profiles pt ON pt.id = i.target_id
      JOIN public.profiles pb ON pb.id = i.bridge_id
      -- OFFSET 0: bez niego planer wciaga podzapytanie do zapytania i wola
      -- helper osobno dla sluga i dla trasy (dwa razy na osobe).
      CROSS JOIN LATERAL (SELECT public._profile_link_route(pr.id) AS route OFFSET 0) lr
      CROSS JOIN LATERAL (SELECT public._profile_link_route(pt.id) AS route OFFSET 0) lt
      CROSS JOIN LATERAL (SELECT public._profile_link_route(pb.id) AS route OFFSET 0) lb
     WHERE CASE p_role
             WHEN 'bridge'    THEN i.bridge_id = auth.uid()
             WHEN 'requester' THEN i.requester_id = auth.uid()
             WHEN 'target'    THEN i.target_id = auth.uid() AND i.status = 'forwarded'
             ELSE FALSE END
     ORDER BY i.created_at DESC;
END; $$;

COMMENT ON FUNCTION public.my_introduction_requests(text) IS
  'Wprowadzenia zalogowanego w jednej roli (bridge / requester / target); inna '
  'wartosc albo NULL -> blad 22023, nie pusta lista. Pary *_slug / *_route: '
  'niepuste wylacznie wtedy, gdy link doprowadzi wolajacego do tej osoby '
  '(_profile_link_route: author albo people); NULL = nie linkuj.';

REVOKE EXECUTE ON FUNCTION public.my_introduction_requests(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_introduction_requests(text) TO authenticated;

-- -- 2. list_recommendations -------------------------------------------------
DROP FUNCTION IF EXISTS public.list_recommendations(UUID);
CREATE FUNCTION public.list_recommendations(p_recipient UUID)
RETURNS TABLE (
  id UUID, author_id UUID, author_name TEXT, author_avatar TEXT,
  author_headline TEXT, relationship TEXT, body TEXT, status TEXT, created_at TIMESTAMPTZ,
  author_slug TEXT, author_route TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid           UUID := auth.uid();
  v_owner_tenant  UUID;
  v_caller_tenant UUID;
BEGIN
  IF p_recipient IS NULL THEN RETURN; END IF;

  -- Skalowanie tenantem WLASCICIELA profilu: sekcja jest publiczna, wiec
  -- anonimowy czytelnik (bez wiersza w profiles) tez musi zobaczyc
  -- opublikowane rekomendacje.
  SELECT p.tenant_id INTO v_owner_tenant FROM public.profiles p WHERE p.id = p_recipient;
  IF v_owner_tenant IS NULL THEN RETURN; END IF;

  -- Zalogowany czytelnik widzi tylko profile ze swojego tenanta.
  IF v_uid IS NOT NULL THEN
    SELECT p.tenant_id INTO v_caller_tenant FROM public.profiles p WHERE p.id = v_uid;
    IF v_caller_tenant IS DISTINCT FROM v_owner_tenant THEN RETURN; END IF;
  END IF;

  RETURN QUERY
    SELECT r.id, r.author_id, p.display_name, p.avatar_url,
           p.job_title, r.relationship, r.body,
           -- Prywatnosc moderacji: autor nie dowiaduje sie o odmowie/ukryciu -
           -- w jego widoku rekomendacja zostaje "pending".
           CASE
             WHEN r.recipient_id = v_uid THEN r.status
             WHEN r.author_id = v_uid AND r.status IN ('hidden', 'declined') THEN 'pending'
             ELSE r.status
           END AS status,
           r.created_at,
           CASE WHEN la.route IS NOT NULL THEN p.slug END,
           la.route
      FROM public.profile_recommendations r
      JOIN public.profiles p ON p.id = r.author_id
      CROSS JOIN LATERAL (SELECT public._profile_link_route(p.id) AS route OFFSET 0) la
     WHERE r.recipient_id = p_recipient
       AND r.tenant_id = v_owner_tenant
       AND (r.status = 'published' OR r.recipient_id = v_uid OR r.author_id = v_uid)
     ORDER BY r.created_at DESC;
END; $$;

COMMENT ON FUNCTION public.list_recommendations(uuid) IS
  'Rekomendacje profilu skalowane tenantem wlasciciela profilu. Anonim/inny czytelnik: '
  'tylko published. Autor nie widzi hidden/declined (prezentowane jako pending). '
  'author_slug / author_route niepuste wylacznie wtedy, gdy link doprowadzi wolajacego '
  'do autora rekomendacji (_profile_link_route); NULL = nie linkuj.';

-- Sekcja rekomendacji jest czescia publicznego profilu (renderowana takze dla
-- niezalogowanych), wiec odczyt musi byc dostepny dla `anon`.
REVOKE ALL ON FUNCTION public.list_recommendations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_recommendations(uuid) TO anon, authenticated;

-- -- 3. my_profile_viewers ---------------------------------------------------
DROP FUNCTION IF EXISTS public.my_profile_viewers(INT);
CREATE FUNCTION public.my_profile_viewers(p_limit INT DEFAULT 20)
RETURNS TABLE (
  viewed_at TIMESTAMPTZ, viewer_mode TEXT,
  viewer_id UUID, display_name TEXT, avatar_url TEXT, job_title TEXT, company TEXT,
  viewer_slug TEXT, viewer_route TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT v.viewed_at, v.viewer_mode, v.viewer_id,
           v.display_name, v.avatar_url, v.job_title, v.company,
           CASE WHEN lv.route IS NOT NULL THEN p.slug END,
           lv.route
      FROM (
        -- Maskowanie i LIMIT najpierw: trasa liczona tylko dla zwracanych
        -- wierszy i tylko dla widza publicznego (zamaskowany viewer_id = NULL
        -- nie dolacza profilu).
        SELECT e.viewed_at, e.viewer_mode,
               CASE WHEN e.viewer_mode = 'public' THEN e.viewer_id END AS viewer_id,
               CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'display_name') END AS display_name,
               CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'avatar_url') END AS avatar_url,
               CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'job_title') END AS job_title,
               CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'company') END AS company
          FROM public.profile_view_events e
         WHERE e.profile_id = auth.uid()
           AND e.viewer_mode <> 'private'   -- wiersze historyczne (20260913170000)
         ORDER BY e.viewed_at DESC
         LIMIT LEAST(GREATEST(p_limit, 1), 100)
      ) v
      LEFT JOIN public.profiles p ON p.id = v.viewer_id
      LEFT JOIN LATERAL (SELECT public._profile_link_route(p.id) AS route OFFSET 0) lv ON p.id IS NOT NULL
     ORDER BY v.viewed_at DESC;
END; $$;

COMMENT ON FUNCTION public.my_profile_viewers(int) IS
  'Kto ogladal profil wolajacego. Tozsamosc (viewer_id, snapshot) oraz viewer_slug / '
  'viewer_route wylacznie dla viewer_mode = public. viewer_route z _profile_link_route '
  '(author / people); NULL = nie linkuj. Nigdy UUID.';

REVOKE EXECUTE ON FUNCTION public.my_profile_viewers(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_profile_viewers(int) TO authenticated;

-- -- 6. intro_read: cel widzi wprost tylko prosby przekazane -------------------
DROP POLICY IF EXISTS intro_read ON public.introduction_requests;
CREATE POLICY intro_read ON public.introduction_requests
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      (SELECT auth.uid()) = requester_id
      OR (SELECT auth.uid()) = bridge_id
      OR ((SELECT auth.uid()) = target_id AND status = 'forwarded')
    )
  );
