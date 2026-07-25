-- ============================================================================
-- WARSTWA SEMANTYCZNA ANALITYKI - strona bazy danych.
--
-- Problem: platforma czytała liczby z szesciu niezaleznych strumieni (GA4,
-- analytics_events, web_vitals, ad_events, newsletter_campaign_events,
-- post_views/related_post_clicks). Kazdy dashboard budowal wlasne zapytanie i
-- wlasne okno czasowe, wiec ta sama metryka miala rozne wartosci na roznych
-- zakladkach, a raport zarzadczy nie mial jak stwierdzic, ktora jest wlasciwa.
--
-- Ta migracja robi trzy rzeczy:
--
--   1) analytics_semantic_snapshot(p_since, p_until) - JEDEN odczyt zwracajacy
--      wszystkie obserwacje first-party dla tego samego, jawnie podanego okna.
--      Dotad kazdy dashboard pytal osobno i o inny przedzial; teraz Postgres
--      liczy je razem, wiec sa policzone na identycznych granicach.
--
--   2) web_vitals_daily_p75 - percentile_cont -> percentile_disc. Komentarz przy
--      funkcji twierdzil, ze percentile_cont "mirrors the in-memory p75", ale
--      agregator w JS (src/lib/observability/aggregate.ts) liczy NEAREST RANK
--      (wartosc faktycznie zmierzona). percentile_cont INTERPOLUJE, wiec trend
--      dzienny z bazy i p75 z pamieci pokazywaly dwie rozne liczby dla tych
--      samych probek. percentile_disc(0.75) jest dokladnym odpowiednikiem
--      nearest-rank: zwraca pierwsza wartosc, ktorej pozycja w uporzadkowanym
--      zbiorze osiaga 0,75 - czyli element o indeksie ceil(0,75 * n).
--
--   3) COMMENT ON dla kolumn/tabel strumieni - definicje w bazie przestaja
--      klamac (session_id NIE jest sesja 24-godzinna) i wskazuja rejestr w
--      kodzie (src/lib/analytics/semantic), zeby oba miejsca zostaly zgodne.
--
-- Izolacja tenantow: snapshot NIE przyjmuje tenant_id od klienta. Uzywa
-- assert_admin_tenant(), ktory wymaga roli admina i zwraca tenant Z PROFILU
-- wywolujacego, wiec naglowek x-tenant-host (podrabialny) nie ma tu wplywu.
-- Idempotentna.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Migawka wszystkich strumieni first-party dla jednego okna
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_semantic_snapshot(
  p_since timestamptz,
  p_until timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_since  timestamptz := p_since;
  v_until  timestamptz := p_until;
  v_first_party jsonb;
  v_vitals jsonb;
  v_ads jsonb;
  v_newsletter jsonb;
  v_content jsonb;
BEGIN
  IF v_since IS NULL OR v_until IS NULL THEN
    RAISE EXCEPTION 'analytics_semantic_snapshot: since/until are required';
  END IF;
  -- Granice odwrocone przez pomylke nie moga cicho zwrocic zer.
  IF v_since > v_until THEN
    RAISE EXCEPTION 'analytics_semantic_snapshot: since must not exceed until';
  END IF;

  -- Zdarzenia first-party. Sesje licza DISTINCT session_id (sesja PER KARTA -
  -- patrz komentarz przy kolumnie), wizytujacy DISTINCT anon_id.
  SELECT jsonb_build_object(
    'events_total',   COUNT(*),
    'page_views',     COUNT(*) FILTER (WHERE event_type = 'page_view'),
    'entity_views',   COUNT(*) FILTER (WHERE event_type = 'view'),
    'cta_clicks',     COUNT(*) FILTER (WHERE event_type = 'cta_click'),
    'searches',       COUNT(*) FILTER (WHERE event_type = 'search'),
    'sessions',       COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL),
    'visitors',       COUNT(DISTINCT anon_id)    FILTER (WHERE anon_id IS NOT NULL),
    'signed_in_users', COUNT(DISTINCT user_id)   FILTER (WHERE user_id IS NOT NULL)
  )
  INTO v_first_party
  FROM public.analytics_events
  WHERE tenant_id = v_tenant
    AND created_at >= v_since
    AND created_at <= v_until;

  -- Web Vitals: p75 metoda NEAREST RANK (percentile_disc), zgodnie z agregatorem
  -- w JS. Zwracamy tez liczbe probek per metryka - p75 z 3 probek nic nie znaczy.
  SELECT jsonb_build_object(
    'samples', COALESCE(SUM(samples), 0),
    'metrics', COALESCE(jsonb_object_agg(metric, jsonb_build_object('p75', p75, 'samples', samples)), '{}'::jsonb)
  )
  INTO v_vitals
  FROM (
    SELECT
      metric,
      percentile_disc(0.75) WITHIN GROUP (ORDER BY value) AS p75,
      COUNT(*)::bigint AS samples
    FROM public.web_vitals
    WHERE tenant_id = v_tenant
      AND created_at >= v_since
      AND created_at <= v_until
    GROUP BY metric
  ) t;

  -- Reklamy: bramka zgody MARKETINGOWA (inna populacja niz odslony) - dlatego
  -- CTR jest liczony wewnatrz tego strumienia i nigdy na odslonach stron.
  SELECT jsonb_build_object(
    'impressions', COUNT(*) FILTER (WHERE kind = 'impression'),
    'clicks',      COUNT(*) FILTER (WHERE kind = 'click')
  )
  INTO v_ads
  FROM public.ad_events
  WHERE tenant_id = v_tenant
    AND created_at >= v_since
    AND created_at <= v_until;

  -- Newsletter: obok surowych zdarzen podajemy UNIKALNYCH odbiorcow, bo otwarcia
  -- sa zaszumione przez proxy prywatnosci pobierajace piksel bez udzialu czlowieka.
  SELECT jsonb_build_object(
    'opens',              COUNT(*) FILTER (WHERE kind = 'open'),
    'clicks',             COUNT(*) FILTER (WHERE kind = 'click'),
    'distinct_openers',   COUNT(DISTINCT subscriber_id) FILTER (WHERE kind = 'open'  AND subscriber_id IS NOT NULL),
    'distinct_clickers',  COUNT(DISTINCT subscriber_id) FILTER (WHERE kind = 'click' AND subscriber_id IS NOT NULL),
    'campaigns',          COUNT(DISTINCT campaign_id)
  )
  INTO v_newsletter
  FROM public.newsletter_campaign_events
  WHERE tenant_id = v_tenant
    AND created_at >= v_since
    AND created_at <= v_until;

  -- Odslony tresci (dwell 1,5 s + dedup 5 min), klikniecia rekomendacji i
  -- przeczytane pary uzytkownik-wpis. To trzy rozne pytania o ten sam strumien.
  SELECT jsonb_build_object(
    'content_views',  (
      SELECT COUNT(*) FROM public.post_views pv
      WHERE pv.tenant_id = v_tenant AND pv.viewed_at >= v_since AND pv.viewed_at <= v_until
    ),
    'unique_viewers', (
      SELECT COUNT(DISTINCT pv.viewer_hash) FROM public.post_views pv
      WHERE pv.tenant_id = v_tenant AND pv.viewed_at >= v_since AND pv.viewed_at <= v_until
    ),
    'related_clicks', (
      SELECT COUNT(*) FROM public.related_post_clicks rc
      WHERE rc.tenant_id = v_tenant AND rc.clicked_at >= v_since AND rc.clicked_at <= v_until
    ),
    'reads', (
      SELECT COUNT(*) FROM public.user_read_history urh
      WHERE urh.tenant_id = v_tenant AND urh.read_at >= v_since AND urh.read_at <= v_until
    )
  )
  INTO v_content;

  RETURN jsonb_build_object(
    'window', jsonb_build_object('since', v_since, 'until', v_until),
    'first_party', COALESCE(v_first_party, '{}'::jsonb),
    'web_vitals',  COALESCE(v_vitals, '{}'::jsonb),
    'ad_events',   COALESCE(v_ads, '{}'::jsonb),
    'newsletter',  COALESCE(v_newsletter, '{}'::jsonb),
    'content_views', COALESCE(v_content, '{}'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.analytics_semantic_snapshot(timestamptz, timestamptz) IS
  'Jedna migawka wszystkich strumieni first-party dla IDENTYCZNEGO okna. Zasila '
  'warstwe semantyczna (src/lib/analytics/semantic) i uzgadnianie liczb z GA4. '
  'Tenant pochodzi z assert_admin_tenant() (profil wywolujacego), nie z parametru '
  'ani z naglowka hosta. p75 Web Vitals liczone percentile_disc = nearest rank, '
  'zgodnie z src/lib/observability/aggregate.ts.';

REVOKE ALL ON FUNCTION public.analytics_semantic_snapshot(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_semantic_snapshot(timestamptz, timestamptz)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Trend dzienny Web Vitals: percentile_cont -> percentile_disc
-- ---------------------------------------------------------------------------
-- Przed ta zmiana trend z bazy (interpolowany) i p75 z pamieci (nearest rank)
-- rozjezdzaly sie na tych samych probkach - ten sam wykres i ta sama etykieta,
-- dwie rozne liczby. percentile_disc(0.75) zwraca pierwsza wartosc, ktorej
-- pozycja osiaga 0,75, czyli element ceil(0,75 * n) - dokladnie to, co robi
-- funkcja percentile() w src/lib/observability/aggregate.ts. Dodatkowa korzysc:
-- zwracana wartosc jest ZAWSZE wartoscia, ktora ktos naprawde zmierzyl.
CREATE OR REPLACE FUNCTION public.web_vitals_daily_p75(p_since timestamptz, p_tenant uuid)
RETURNS TABLE (day date, metric text, p75 double precision, samples bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    (created_at AT TIME ZONE 'UTC')::date AS day,
    metric,
    percentile_disc(0.75) WITHIN GROUP (ORDER BY value) AS p75,
    count(*)::bigint AS samples
  FROM public.web_vitals
  WHERE created_at >= p_since
    AND tenant_id = p_tenant
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

COMMENT ON FUNCTION public.web_vitals_daily_p75(timestamptz, uuid) IS
  'Dzienny p75 Core Web Vitals per tenant, metoda NEAREST RANK (percentile_disc), '
  'identyczna z agregatorem w pamieci (src/lib/observability/aggregate.ts). Dzien '
  'kubkowany w UTC, zgodnie z dayKey() po stronie JS.';

REVOKE ALL ON FUNCTION public.web_vitals_daily_p75(timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.web_vitals_daily_p75(timestamptz, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Definicje w bazie zgodne z rejestrem w kodzie
-- ---------------------------------------------------------------------------
-- Kolumna session_id byla opisana w migracji jako "anon session (24h)", a klient
-- (src/lib/analytics/track.ts) trzyma ja w sessionStorage z 30-minutowym TTL
-- bezczynnosci - czyli PER KARTA przegladarki. Ta roznica jest wlasnie powodem,
-- dla ktorego sesje first-party sa strukturalnie wyzsze od sesji GA4; opis w
-- bazie musi to mowic, a nie zaprzeczac.
COMMENT ON COLUMN public.analytics_events.session_id IS
  'Sesja PER KARTA: sessionStorage, TTL 30 min bezczynnosci (src/lib/analytics/track.ts). '
  'Jeden odwiedzajacy z trzema kartami wygeneruje trzy sesje, wiec COUNT(DISTINCT session_id) '
  'jest strukturalnie >= sesji GA4. NIE jest to sesja 24-godzinna.';

COMMENT ON COLUMN public.analytics_events.anon_id IS
  'Identyfikator przegladarki: localStorage, bez wygasania (src/lib/analytics/track.ts). '
  'Pusty, gdy localStorage jest niedostepny (tryb prywatny) - COUNT(DISTINCT anon_id) '
  'pomija wtedy tych odwiedzajacych.';

COMMENT ON TABLE public.analytics_events IS
  'Strumien first-party warstwy semantycznej (streamId=first_party). Bramka zgody: '
  'analytics. Brak filtrowania botow i brak deduplikacji - liczby sa surowe i '
  'strukturalnie wyzsze od GA4. Rejestr semantyki: src/lib/analytics/semantic/streams.ts.';

COMMENT ON TABLE public.web_vitals IS
  'Strumien RUM warstwy semantycznej (streamId=web_vitals). Bramka zgody: analytics. '
  'Probki bez tozsamosci sesji/uzytkownika, wiec metryk nie da sie wyrazic per sesje. '
  'Rejestr semantyki: src/lib/analytics/semantic/streams.ts.';

COMMENT ON TABLE public.ad_events IS
  'Strumien reklamowy warstwy semantycznej (streamId=ad_events). Bramka zgody: '
  'MARKETING - inna populacja niz odslony (analytics), dlatego CTR liczymy wylacznie '
  'wewnatrz tego strumienia. Rejestr semantyki: src/lib/analytics/semantic/streams.ts.';

COMMENT ON TABLE public.newsletter_campaign_events IS
  'Strumien newslettera warstwy semantycznej (streamId=newsletter). Bez bramki cookie '
  '(opt-in mailowy). Otwarcia sa zaszumione przez proxy prywatnosci - wiarygodnym '
  'sygnalem sa klikniecia. Rejestr semantyki: src/lib/analytics/semantic/streams.ts.';

COMMENT ON TABLE public.post_views IS
  'Strumien odslon tresci warstwy semantycznej (streamId=content_views). Wiersz powstaje '
  'po 1,5 s obecnosci na stronie, z deduplikacja (post, viewer_hash) w oknie 5 minut i bez '
  'odslon autora - to metryka REDAKCYJNA, z definicji nizsza od odslon stron w GA4. '
  'Rejestr semantyki: src/lib/analytics/semantic/streams.ts.';

COMMENT ON TABLE public.user_read_history IS
  'Stan, nie zdarzenie: UPSERT na (user_id, post_id), wiec read_at to OSTATNIE '
  'przeczytanie pary. Liczba wierszy w oknie odpowiada na pytanie o pary ostatnio '
  'czytane w tym oknie, a NIE o liczbe przeczytan. Rejestr semantyki: '
  'src/lib/analytics/semantic/streams.ts.';
