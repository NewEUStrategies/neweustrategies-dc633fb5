-- Warstwa semantyczna analityki (PR #97) — zastosowanie migracji nieaplikowanej wcześniej w bazie.
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
  IF v_since > v_until THEN
    RAISE EXCEPTION 'analytics_semantic_snapshot: since must not exceed until';
  END IF;

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

  SELECT jsonb_build_object(
    'impressions', COUNT(*) FILTER (WHERE kind = 'impression'),
    'clicks',      COUNT(*) FILTER (WHERE kind = 'click')
  )
  INTO v_ads
  FROM public.ad_events
  WHERE tenant_id = v_tenant
    AND created_at >= v_since
    AND created_at <= v_until;

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
  'Jedna migawka wszystkich strumieni first-party dla IDENTYCZNEGO okna. Zasila warstwe semantyczna (src/lib/analytics/semantic) i uzgadnianie liczb z GA4. Tenant pochodzi z assert_admin_tenant() (profil wywolujacego). p75 Web Vitals liczone percentile_disc = nearest rank.';

REVOKE ALL ON FUNCTION public.analytics_semantic_snapshot(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_semantic_snapshot(timestamptz, timestamptz)
  TO authenticated, service_role;

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
  'Dzienny p75 Core Web Vitals per tenant, metoda NEAREST RANK (percentile_disc), identyczna z agregatorem w pamieci. Dzien kubkowany w UTC.';

REVOKE ALL ON FUNCTION public.web_vitals_daily_p75(timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.web_vitals_daily_p75(timestamptz, uuid) TO service_role;

COMMENT ON COLUMN public.analytics_events.session_id IS
  'Sesja PER KARTA: sessionStorage, TTL 30 min bezczynnosci (src/lib/analytics/track.ts). Jeden odwiedzajacy z trzema kartami wygeneruje trzy sesje, wiec COUNT(DISTINCT session_id) jest strukturalnie >= sesji GA4. NIE jest to sesja 24-godzinna.';

COMMENT ON COLUMN public.analytics_events.anon_id IS
  'Identyfikator przegladarki: localStorage, bez wygasania (src/lib/analytics/track.ts). Pusty, gdy localStorage jest niedostepny (tryb prywatny) - COUNT(DISTINCT anon_id) pomija wtedy tych odwiedzajacych.';

COMMENT ON TABLE public.analytics_events IS
  'Strumien first-party warstwy semantycznej (streamId=first_party). Bramka zgody: analytics. Brak filtrowania botow i brak deduplikacji.';

COMMENT ON TABLE public.web_vitals IS
  'Strumien RUM warstwy semantycznej (streamId=web_vitals). Bramka zgody: analytics. Probki bez tozsamosci sesji/uzytkownika.';

COMMENT ON TABLE public.ad_events IS
  'Strumien reklamowy warstwy semantycznej (streamId=ad_events). Bramka zgody: MARKETING - inna populacja niz odslony (analytics), dlatego CTR liczymy wylacznie wewnatrz tego strumienia.';

COMMENT ON TABLE public.newsletter_campaign_events IS
  'Strumien newslettera warstwy semantycznej (streamId=newsletter). Bez bramki cookie (opt-in mailowy). Otwarcia sa zaszumione przez proxy prywatnosci - wiarygodnym sygnalem sa klikniecia.';

COMMENT ON TABLE public.post_views IS
  'Strumien odslon tresci warstwy semantycznej (streamId=content_views). Wiersz powstaje po 1,5 s obecnosci na stronie, z deduplikacja (post, viewer_hash) w oknie 5 minut.';

COMMENT ON TABLE public.user_read_history IS
  'Stan, nie zdarzenie: UPSERT na (user_id, post_id), wiec read_at to OSTATNIE przeczytanie pary.';