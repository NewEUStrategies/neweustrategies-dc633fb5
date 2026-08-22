-- ============================================================================
-- DECISION LAB W KALENDARZU KLUBU: PRÓG RANGI NA `club_events`
--
-- Ostatnia z siedmiu pozycji [B?] listy wdrożeniowej katalogu v6.1: „2 Decision
-- Laby rocznie w roli obserwatora [B?] - wymaga bramki na club_events wobec
-- rangi" (próg Rada Instytutu).
--
-- STAN PRZED: `club_events` nie ma żadnego progu własnego. Kalendarz klubu
-- bramkuje WYŁĄCZNIE `club_capabilities(...).can_read`, czyli członkostwo
-- w klubie albo jego publiczna widoczność. To wystarcza, dopóki wszystkie
-- terminy w klubie są tej samej wagi - i przestaje wystarczać dokładnie tam,
-- gdzie katalog stawia Decision Lab: cykl spotkań, do którego wstęp ma wąskie
-- grono, umieszczony w kalendarzu klubu, który sam w sobie jest szerszy.
-- Bez progu własnego jedynym sposobem ograniczenia wstępu byłoby założenie
-- osobnego klubu na każdy Decision Lab.
--
-- STAN PO: `club_events.min_tier_rank` (0 = bez progu, zachowanie dotychczasowe).
-- Próg działa NA WIERZCHU bramki klubu, nigdy zamiast niej - kto nie może
-- czytać klubu, nie zobaczy terminu niezależnie od rangi. Kurator klubu
-- (`can_moderate`) widzi wszystko, bo to on te terminy prowadzi.
--
-- Zmiana sygnatury `club_events_list`: dokładamy kolumnę do zwracanej tabeli,
-- więc funkcja musi zostać zdjęta i założona od nowa (Postgres nie pozwala
-- zmienić typu wyniku przez CREATE OR REPLACE). Warstwa TypeScript wyprowadza
-- `ClubEventRow` wprost z typu `Returns` tej funkcji, więc kolumna dojedzie do
-- panelu bez ręcznego przepisywania kontraktu.
-- ============================================================================

ALTER TABLE public.club_events
  ADD COLUMN IF NOT EXISTS min_tier_rank integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE public.club_events
    ADD CONSTRAINT club_events_min_tier_rank_check CHECK (min_tier_rank >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.club_events.min_tier_rank IS
  'Próg rangi planu dla POJEDYNCZEGO terminu w kalendarzu klubu (0 = bez progu). Dokładany na wierzchu bramki klubu, nigdy zamiast niej. Katalog v6.1: Decision Lab jako obserwator od rangi 25.';

-- ----------------------------------------------------------------------------
-- Kalendarz klubu: filtr progu + kolumna w wyniku.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_events_list(uuid, timestamptz, timestamptz, text, integer);

CREATE FUNCTION public.club_events_list(
  p_club_id uuid,
  p_from    timestamptz DEFAULT NULL,
  p_to      timestamptz DEFAULT NULL,
  p_kind    text        DEFAULT NULL,
  p_limit   integer     DEFAULT 200
)
RETURNS TABLE (
  id uuid, club_id uuid, group_id uuid, thread_id uuid, anchor_event_id uuid,
  slug text, title_pl text, title_en text, description_pl text, description_en text,
  kind text, starts_at timestamptz, ends_at timestamptz, all_day boolean,
  location text, meeting_url text, status text,
  rsvp_enabled boolean, capacity integer, going_count integer,
  min_tier_rank integer,
  my_rsvp text, thread_slug text, group_name_pl text, group_name_en text,
  created_at timestamptz, can_manage boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id, e.club_id, e.group_id, e.thread_id, e.anchor_event_id,
    e.slug, e.title_pl, e.title_en, e.description_pl, e.description_en,
    e.kind, e.starts_at, e.ends_at, e.all_day,
    e.location,
    -- Link do spotkania jest dla UCZESTNIKOW, nie dla kazdego, kto ma podglad
    -- klubu: adres pokoju wideo wyciekly poza klub jest zaproszeniem dla
    -- kazdego, kto go dostanie dalej.
    CASE WHEN cap.can_reply OR cap.can_moderate THEN e.meeting_url ELSE NULL END,
    e.status,
    e.rsvp_enabled, e.capacity, e.going_count,
    e.min_tier_rank,
    r.state,
    t.slug, g.name_pl, g.name_en,
    e.created_at, cap.can_moderate
  FROM public.club_events e
  CROSS JOIN LATERAL public.club_capabilities(e.club_id, NULL, auth.uid()) cap
  LEFT JOIN public.club_threads t ON t.id = e.thread_id
  LEFT JOIN public.club_groups  g ON g.id = e.group_id
  LEFT JOIN public.club_event_rsvps r ON r.event_id = e.id AND r.user_id = auth.uid()
  WHERE e.club_id = p_club_id
    AND cap.can_read
    -- Próg terminu. Skalar w podzapytaniu, nie wywołanie per wiersz: Postgres
    -- policzy rangę RAZ na zapytanie (InitPlan), a nie 200 razy na kalendarz.
    AND (
      COALESCE(e.min_tier_rank, 0) = 0
      OR cap.can_moderate
      OR (SELECT public.current_tier_rank()) >= e.min_tier_rank
    )
    AND (p_from IS NULL OR COALESCE(e.ends_at, e.starts_at) >= p_from)
    AND (p_to   IS NULL OR e.starts_at <= p_to)
    AND (p_kind IS NULL OR e.kind = p_kind)
  ORDER BY e.starts_at ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
$$;

COMMENT ON FUNCTION public.club_events_list(uuid, timestamptz, timestamptz, text, integer) IS
  'Kalendarz klubu w zakresie dat. Zakres domyka sie po ends_at, wiec wydarzenie trwajace przez granice okna nie znika. meeting_url wychodzi tylko uczestnikom. Termin z wlasnym min_tier_rank widzi kurator i ranga >= progu.';

REVOKE EXECUTE ON FUNCTION public.club_events_list(uuid, timestamptz, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_events_list(uuid, timestamptz, timestamptz, text, integer) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Zapis obecności: ta sama bramka co odczyt.
--
-- Ciało przeniesione z 20260808300000; dopisany jeden warunek zaraz po odczycie
-- wiersza. Bez niego obserwator spoza progu nie widziałby terminu na liście,
-- ale zapisałby się na niego wołając RPC z identyfikatorem - a identyfikator
-- wycieka choćby przez zaproszenie w wątku.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_event_rsvp(
  p_event_id uuid,
  p_state    text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_club     uuid;
  v_tenant   uuid;
  v_enabled  boolean;
  v_capacity integer;
  v_going    integer;
  v_prev     text;
  v_member   boolean;
  v_min_rank integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('going', 'maybe', 'declined') THEN
    RAISE EXCEPTION 'clubs: invalid rsvp state %', p_state USING ERRCODE = '22023';
  END IF;

  SELECT e.club_id, e.tenant_id, e.rsvp_enabled, e.capacity, e.going_count,
         COALESCE(e.min_tier_rank, 0)
    INTO v_club, v_tenant, v_enabled, v_capacity, v_going, v_min_rank
    FROM public.club_events e WHERE e.id = p_event_id;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'clubs: rsvp disabled' USING ERRCODE = '22023';
  END IF;

  -- PRÓG TERMINU (nowe). Zejscie z listy (`declined`) zostaje dozwolone zawsze:
  -- ktos zapisany przed podniesieniem progu musi moc sie wypisac, inaczej
  -- zajmowalby miejsce, ktorego nie moze juz zajmowac.
  IF v_min_rank > 0
     AND p_state <> 'declined'
     AND NOT public.has_tier_rank(v_min_rank) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.club_members m
     WHERE m.club_id = v_club AND m.user_id = v_uid AND m.status = 'active'
  ) INTO v_member;
  IF NOT v_member THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT r.state INTO v_prev
    FROM public.club_event_rsvps r
   WHERE r.event_id = p_event_id AND r.user_id = v_uid;

  -- Limit miejsc liczy sie WYLACZNIE przy wejsciu na liste obecnych. Zmiana
  -- 'going' -> 'going' nie zajmuje drugiego miejsca, a zejscie z listy nigdy
  -- nie moze byc zablokowane przez limit.
  IF p_state = 'going'
     AND v_capacity IS NOT NULL
     AND COALESCE(v_prev, '') <> 'going'
     AND v_going >= v_capacity THEN
    RAISE EXCEPTION 'clubs: event is full' USING ERRCODE = '22023';
  END IF;

  -- Tenant idzie z WYDARZENIA, a nie z wolajacego. Trigger pinujacy i tak by
  -- go nadpisal, ale poleganie na kolejnosci trigger-vs-FK przy kolumnie z
  -- kluczem obcym jest zakladem, ktorego nie ma powodu zawierac.
  INSERT INTO public.club_event_rsvps (event_id, user_id, tenant_id, state)
  VALUES (p_event_id, v_uid, v_tenant, p_state)
  ON CONFLICT (event_id, user_id) DO UPDATE SET state = EXCLUDED.state;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.club_event_rsvp(uuid, text) IS
  'Deklaracja obecnosci. Wymaga AKTYWNEGO czlonkostwa, nie samego can_read - deklaracja osoby spoza klubu jest szumem dla prowadzacego, ktory na jej podstawie rezerwuje sale. Termin z wlasnym min_tier_rank wymaga dodatkowo tej rangi (poza zejsciem z listy).';

REVOKE EXECUTE ON FUNCTION public.club_event_rsvp(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_event_rsvp(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Kurator musi umieć ten próg ustawić.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_event_upsert(
  p_club_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.club_require_curator(p_club_id);
  v_id     uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_slug   text := NULLIF(btrim(COALESCE(p_payload->>'slug', '')), '');
BEGIN
  IF v_id IS NULL THEN
    IF v_slug IS NULL THEN
      RAISE EXCEPTION 'clubs: slug required' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(p_payload->>'starts_at', '') IS NULL THEN
      RAISE EXCEPTION 'clubs: starts_at required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.club_events (
      tenant_id, club_id, group_id, thread_id, anchor_event_id, slug,
      title_pl, title_en, description_pl, description_en, kind,
      starts_at, ends_at, all_day, location, meeting_url, status,
      rsvp_enabled, capacity, min_tier_rank, created_by
    ) VALUES (
      v_tenant, p_club_id,
      NULLIF(p_payload->>'group_id', '')::uuid,
      NULLIF(p_payload->>'thread_id', '')::uuid,
      NULLIF(p_payload->>'anchor_event_id', '')::uuid,
      v_slug,
      COALESCE(p_payload->>'title_pl', ''),
      COALESCE(p_payload->>'title_en', ''),
      NULLIF(p_payload->>'description_pl', ''),
      NULLIF(p_payload->>'description_en', ''),
      COALESCE(NULLIF(p_payload->>'kind', ''), 'meeting'),
      (p_payload->>'starts_at')::timestamptz,
      NULLIF(p_payload->>'ends_at', '')::timestamptz,
      COALESCE((p_payload->>'all_day')::boolean, false),
      NULLIF(p_payload->>'location', ''),
      NULLIF(p_payload->>'meeting_url', ''),
      COALESCE(NULLIF(p_payload->>'status', ''), 'scheduled'),
      COALESCE((p_payload->>'rsvp_enabled')::boolean, false),
      NULLIF(p_payload->>'capacity', '')::integer,
      GREATEST(COALESCE(NULLIF(p_payload->>'min_tier_rank', '')::integer, 0), 0),
      auth.uid()
    )
    RETURNING id INTO v_id;

    RETURN v_id;
  END IF;

  UPDATE public.club_events e SET
    group_id        = CASE WHEN p_payload ? 'group_id'
                           THEN NULLIF(p_payload->>'group_id', '')::uuid ELSE e.group_id END,
    thread_id       = CASE WHEN p_payload ? 'thread_id'
                           THEN NULLIF(p_payload->>'thread_id', '')::uuid ELSE e.thread_id END,
    anchor_event_id = CASE WHEN p_payload ? 'anchor_event_id'
                           THEN NULLIF(p_payload->>'anchor_event_id', '')::uuid ELSE e.anchor_event_id END,
    slug            = COALESCE(v_slug, e.slug),
    title_pl        = COALESCE(NULLIF(p_payload->>'title_pl', ''), e.title_pl),
    title_en        = COALESCE(NULLIF(p_payload->>'title_en', ''), e.title_en),
    description_pl  = CASE WHEN p_payload ? 'description_pl'
                           THEN NULLIF(p_payload->>'description_pl', '') ELSE e.description_pl END,
    description_en  = CASE WHEN p_payload ? 'description_en'
                           THEN NULLIF(p_payload->>'description_en', '') ELSE e.description_en END,
    kind            = COALESCE(NULLIF(p_payload->>'kind', ''), e.kind),
    starts_at       = COALESCE(NULLIF(p_payload->>'starts_at', '')::timestamptz, e.starts_at),
    ends_at         = CASE WHEN p_payload ? 'ends_at'
                           THEN NULLIF(p_payload->>'ends_at', '')::timestamptz ELSE e.ends_at END,
    all_day         = COALESCE((p_payload->>'all_day')::boolean, e.all_day),
    location        = CASE WHEN p_payload ? 'location'
                           THEN NULLIF(p_payload->>'location', '') ELSE e.location END,
    meeting_url     = CASE WHEN p_payload ? 'meeting_url'
                           THEN NULLIF(p_payload->>'meeting_url', '') ELSE e.meeting_url END,
    status          = COALESCE(NULLIF(p_payload->>'status', ''), e.status),
    rsvp_enabled    = COALESCE((p_payload->>'rsvp_enabled')::boolean, e.rsvp_enabled),
    capacity        = CASE WHEN p_payload ? 'capacity'
                           THEN NULLIF(p_payload->>'capacity', '')::integer ELSE e.capacity END,
    min_tier_rank   = CASE WHEN p_payload ? 'min_tier_rank'
                           THEN GREATEST(COALESCE(NULLIF(p_payload->>'min_tier_rank', '')::integer, 0), 0)
                           ELSE e.min_tier_rank END
  WHERE e.id = v_id AND e.club_id = p_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_event_upsert(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_event_upsert(uuid, jsonb) TO authenticated, service_role;
