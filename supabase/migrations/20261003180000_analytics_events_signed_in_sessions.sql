-- Analityka first-party: flaga `signed_in` zamiast identyfikatora konta,
-- a miary „zalogowanych" liczone w SESJACH.
--
-- STAN WYJŚCIOWY - ZNALEZISKO. Kolumna `analytics_events.user_id` istnieje od
-- 20260722234931 (FK do auth.users), ale NIGDY nie była zapisywana. Klient
-- (src/lib/analytics/track.ts, `QueuedEvent`) nie ma pola użytkownika, ingest
-- (src/routes/api/public/track.ts) nie wpisuje go do wiersza, a żaden trigger
-- nie ustawia go z `auth.uid()` - zresztą wiersze wstawia service_role, więc
-- `auth.uid()` byłby tam NULL-em. `git log -S user_id` na obu plikach jest
-- pusty. Skutek: wszystkie cztery miary „zalogowanych" - `members`
-- i `activeMembers` pulpitu, `signed_in_users` warstwy semantycznej oraz
-- `unique_users` widoku dziennego - od początku zwracały ZERO, niezależnie od
-- ruchu. Nie ma więc czego przenosić ani uzupełniać wstecz: stare wiersze
-- dostają `signed_in = false` z wartości domyślnej, a to jest dokładnie to, co
-- o nich wiadomo.
--
-- DLACZEGO BIT, A NIE NAPRAWA ZAPISU `user_id`. Wiersz zdarzenia niesie
-- ścieżkę, referrer i niewygasający `anon_id`. Identyfikator konta obok nich
-- zamieniłby statystykę w dziennik lektury konkretnej osoby i unieważnił
-- uzasadnienie, którym bramka eksportu RODO wyłącza tę tabelę z eksportu
-- („zdarzenia analityczne bez identyfikatora konta",
-- exportManifestParity.gate.test.ts). Pulpit pyta „ilu z ruchu to nasi ludzie",
-- a na to pytanie wystarcza jeden bit na wiersz.
--
-- CO SIĘ ZMIENIA:
--   1. `signed_in boolean NOT NULL DEFAULT false`. Ustawia ją WYŁĄCZNIE ingest,
--      z bearera zweryfikowanego po stronie serwera
--      (src/lib/analytics/signedIn.server.ts); treść żądania nie ma na nią
--      wpływu. Stała wartość domyślna nie przepisuje tabeli (od PG11 trafia do
--      katalogu, nie do wierszy), więc ALTER jest natychmiastowy także na dużej
--      tabeli.
--   2. Komentarz na `user_id`: kolumna zostaje (jej usunięcie to osobna,
--      nieodwracalna decyzja, a FK na samych NULL-ach nic nie kosztuje), ale
--      jest opisana jako CELOWO niezapisywana - żeby nikt jej nie „naprawił".
--   3. Miary „zalogowanych" liczą RÓŻNE `session_id` z flagą `signed_in`. Bez
--      konta nie ma czego liczyć unikalnie, a sesja to ta sama jednostka,
--      w której pulpit liczy resztę ruchu (`sessions`). Klucze JSON pulpitu
--      zostają (`members`, `activeMembers`): parser
--      (src/lib/admin/dashboard/parse.ts) ich nie zmienia, a kafelek ruchu
--      i tak był podpisany „Sesje zalogowanych". Klucz warstwy semantycznej
--      i kolumna widoku zmieniają nazwę na `signed_in_sessions`, bo stare nazwy
--      (`signed_in_users`, `unique_users`) obiecywały osoby, których tu nie ma.
--   4. Ciała `admin_dashboard_traffic` i `admin_dashboard_realtime`
--      (20260912110000) oraz `analytics_semantic_snapshot` (20260725162011) są
--      przepisane DOSŁOWNIE; zmienia się wyłącznie liczone wyrażenie.
--      Wyjątek: `analytics_semantic_snapshot` dostaje jawne `search_path =
--      public, pg_temp`. Jej ostatni tekst źródłowy ma samo `public`, a `pg_temp`
--      dopisała później pętla 20260830120000 przez ALTER FUNCTION - dosłowna
--      kopia przez CREATE OR REPLACE cofnęłaby to utwardzenie po cichu.
--   5. Widok `analytics_events_daily`: zmiana nazwy kolumny wymaga DROP + CREATE
--      (CREATE OR REPLACE VIEW nie przemianowuje kolumn). Od widoku nic nie
--      zależy - zero widoków i funkcji na nim, zero odczytów w TS.
--
-- BEZPIECZEŃSTWO. Funkcje zostają SECURITY DEFINER z najemcą z profilu
-- wołającego (`admin_dashboard_tenant()`, `assert_admin_tenant()`), bez
-- najemcy z nagłówka hosta - zgodnie z `check:sql-tenant-scope`. REVOKE/GRANT
-- i COMMENT są powtórzone bez zmian: CREATE OR REPLACE zachowuje ACL, więc
-- powtórzenie jest idempotentne i dokumentuje kontrakt w miejscu. Widok wraca
-- z `security_invoker = on`, więc nadal dziedziczy RLS tabeli (admin albo
-- edytor własnego najemcy). DROP kasuje ACL widoku, a domyślne uprawnienia
-- schematu `public` nadałyby nowemu obiektowi dostęp roli anon - stąd jawne
-- REVOKE przed GRANT SELECT dla authenticated. Tabela nie dostaje żadnej
-- polityki INSERT (`check:sql-anon-insert`): zapis idzie tylko przez
-- service_role w ingeście.
--
-- Idempotentna: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE dla funkcji,
-- DROP VIEW IF EXISTS + CREATE VIEW, COMMENT/REVOKE/GRANT powtarzalne.

-- ---------------------------------------------------------------------------
-- 1) Kolumna i komentarze
-- ---------------------------------------------------------------------------
ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS signed_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.analytics_events.signed_in IS
  'Czy zdarzenie wyslala sesja zalogowanego uzytkownika. Ustawiane WYLACZNIE przez ingest (src/routes/api/public/track.ts) z bearera zweryfikowanego po stronie serwera; tresc zadania nie ma na to wplywu. Jedyna informacja o koncie w tej tabeli - miary zalogowanych licza COUNT(DISTINCT session_id) FILTER (WHERE signed_in), czyli sesje, nie osoby.';

COMMENT ON COLUMN public.analytics_events.user_id IS
  'CELOWO NIEZAPISYWANA (prywatnosc): ingest przechowuje wylacznie flage signed_in, nigdy identyfikatora konta - inaczej wiersz ze sciezka i anon_id bylby dziennikiem lektury konkretnej osoby. Kolumna nie byla zapisywana nigdy, wiec nie ma czego uzupelniac. Nie czytaj jej i nie zaczynaj zapisywac bez decyzji o RODO (eksport, retencja).';

COMMENT ON TABLE public.analytics_events IS
  'Strumien first-party warstwy semantycznej (streamId=first_party). Bramka zgody: analytics. Brak filtrowania botow i brak deduplikacji. Bez identyfikatora konta: zalogowanie to wylacznie flaga signed_in.';

-- ---------------------------------------------------------------------------
-- 2) Pulpit: ruch na stronie (kopia z 20260912110000, zmienione `members`)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_dashboard_traffic(
  p_since timestamptz,
  p_until timestamptz,
  p_prev_since timestamptz,
  p_prev_until timestamptz,
  p_bucket text DEFAULT 'day',
  p_offset_minutes integer DEFAULT 0,
  p_limit integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant  uuid := public.admin_dashboard_tenant();
  v_bucket  text := public.admin_dashboard_bucket(p_bucket);
  v_shift   interval := make_interval(mins => coalesce(p_offset_minutes, 0));
  v_limit   integer := least(greatest(coalesce(p_limit, 12), 1), 100);
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Forbidden: admin or editor role required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'current', (
      SELECT jsonb_build_object(
               'pageViews',  count(*) FILTER (WHERE e.event_type = 'page_view'),
               'events',     count(*),
               'sessions',   count(DISTINCT e.session_id),
               'visitors',   count(DISTINCT e.anon_id),
               'members',    count(DISTINCT e.session_id) FILTER (WHERE e.signed_in),
               'countries',  count(DISTINCT e.country) FILTER (WHERE e.country IS NOT NULL)
             )
        FROM public.analytics_events e
       WHERE e.tenant_id = v_tenant
         AND e.created_at >= p_since AND e.created_at < p_until
    ),
    'previous', (
      SELECT jsonb_build_object(
               'pageViews',  count(*) FILTER (WHERE e.event_type = 'page_view'),
               'events',     count(*),
               'sessions',   count(DISTINCT e.session_id),
               'visitors',   count(DISTINCT e.anon_id),
               'members',    count(DISTINCT e.session_id) FILTER (WHERE e.signed_in),
               'countries',  count(DISTINCT e.country) FILTER (WHERE e.country IS NOT NULL)
             )
        FROM public.analytics_events e
       WHERE e.tenant_id = v_tenant
         AND e.created_at >= p_prev_since AND e.created_at < p_prev_until
    ),
    'series', coalesce((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.bucket)
        FROM (
          SELECT to_char(date_trunc(v_bucket, e.created_at + v_shift), 'YYYY-MM-DD HH24:MI') AS bucket,
                 count(*) FILTER (WHERE e.event_type = 'page_view')                          AS page_views,
                 count(DISTINCT e.session_id)                                                AS sessions,
                 count(DISTINCT e.anon_id)                                                   AS visitors
            FROM public.analytics_events e
           WHERE e.tenant_id = v_tenant
             AND e.created_at >= p_since AND e.created_at < p_until
           GROUP BY 1
        ) s
    ), '[]'::jsonb),
    'countries', coalesce((
      SELECT jsonb_agg(row_to_json(c) ORDER BY c.sessions DESC, c.code)
        FROM (
          SELECT upper(e.country)          AS code,
                 count(DISTINCT e.session_id) AS sessions,
                 count(*) FILTER (WHERE e.event_type = 'page_view') AS page_views
            FROM public.analytics_events e
           WHERE e.tenant_id = v_tenant
             AND e.country IS NOT NULL
             AND e.created_at >= p_since AND e.created_at < p_until
           GROUP BY 1
        ) c
    ), '[]'::jsonb),
    'topPaths', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.views DESC, t.path)
        FROM (
          SELECT e.path,
                 count(*) AS views,
                 count(DISTINCT e.session_id) AS sessions
            FROM public.analytics_events e
           WHERE e.tenant_id = v_tenant
             AND e.event_type = 'page_view'
             AND e.path IS NOT NULL
             AND e.created_at >= p_since AND e.created_at < p_until
           GROUP BY e.path
           ORDER BY count(*) DESC, e.path
           LIMIT v_limit
        ) t
    ), '[]'::jsonb),
    -- ŹRÓDŁO RUCHU LICZONE PO HOŚCIE, nie po pełnym adresie: pięćdziesiąt
    -- adresów z jednego portalu to jedno źródło, a nie pięćdziesiąt wierszy
    -- tabeli. Odsyłacz wewnętrzny odpada - nawigacja po własnej stronie nie
    -- jest pozyskaniem.
    'topReferrers', coalesce((
      SELECT jsonb_agg(row_to_json(r) ORDER BY r.sessions DESC, r.host)
        FROM (
          SELECT split_part(split_part(regexp_replace(e.referrer, '^https?://', ''), '/', 1), ':', 1) AS host,
                 count(DISTINCT e.session_id) AS sessions
            FROM public.analytics_events e
           WHERE e.tenant_id = v_tenant
             AND e.referrer IS NOT NULL AND e.referrer <> ''
             AND e.created_at >= p_since AND e.created_at < p_until
           GROUP BY 1
          HAVING split_part(split_part(regexp_replace(e.referrer, '^https?://', ''), '/', 1), ':', 1) <> ''
           ORDER BY count(DISTINCT e.session_id) DESC, 1
           LIMIT v_limit
        ) r
    ), '[]'::jsonb),
    'languages', coalesce((
      SELECT jsonb_agg(row_to_json(l) ORDER BY l.sessions DESC, l.lang)
        FROM (
          SELECT coalesce(nullif(split_part(e.lang, '-', 1), ''), 'xx') AS lang,
                 count(DISTINCT e.session_id) AS sessions
            FROM public.analytics_events e
           WHERE e.tenant_id = v_tenant
             AND e.created_at >= p_since AND e.created_at < p_until
           GROUP BY 1
           ORDER BY count(DISTINCT e.session_id) DESC, 1
           LIMIT 8
        ) l
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_traffic(timestamptz, timestamptz, timestamptz, timestamptz, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_traffic(timestamptz, timestamptz, timestamptz, timestamptz, text, integer, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Pulpit: podgląd na żywo (kopia z 20260912110000, zmienione `activeMembers`)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_dashboard_realtime(
  p_active_minutes integer DEFAULT 5,
  p_window_minutes integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.admin_dashboard_tenant();
  v_active interval := make_interval(mins => least(greatest(coalesce(p_active_minutes, 5), 1), 60));
  v_window interval := make_interval(mins => least(greatest(coalesce(p_window_minutes, 30), 5), 360));
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Forbidden: admin or editor role required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'activeSessions', (SELECT count(DISTINCT e.session_id) FROM public.analytics_events e
                        WHERE e.tenant_id = v_tenant AND e.created_at >= now() - v_active),
    'activeMembers',  (SELECT count(DISTINCT e.session_id) FROM public.analytics_events e
                        WHERE e.tenant_id = v_tenant AND e.created_at >= now() - v_active
                          AND e.signed_in),
    'windowSessions', (SELECT count(DISTINCT e.session_id) FROM public.analytics_events e
                        WHERE e.tenant_id = v_tenant AND e.created_at >= now() - v_window),
    'windowViews',    (SELECT count(*) FROM public.analytics_events e
                        WHERE e.tenant_id = v_tenant AND e.created_at >= now() - v_window
                          AND e.event_type = 'page_view'),
    'perMinute', coalesce((
      SELECT jsonb_agg(row_to_json(m) ORDER BY m.bucket)
        FROM (
          SELECT to_char(date_trunc('minute', e.created_at), 'YYYY-MM-DD HH24:MI') AS bucket,
                 count(DISTINCT e.session_id) AS sessions,
                 count(*) FILTER (WHERE e.event_type = 'page_view') AS page_views
            FROM public.analytics_events e
           WHERE e.tenant_id = v_tenant AND e.created_at >= now() - v_window
           GROUP BY 1
        ) m
    ), '[]'::jsonb),
    'paths', coalesce((
      SELECT jsonb_agg(row_to_json(p) ORDER BY p.sessions DESC, p.path)
        FROM (
          SELECT e.path, count(DISTINCT e.session_id) AS sessions
            FROM public.analytics_events e
           WHERE e.tenant_id = v_tenant AND e.created_at >= now() - v_active
             AND e.path IS NOT NULL
           GROUP BY e.path
           ORDER BY count(DISTINCT e.session_id) DESC, e.path
           LIMIT 10
        ) p
    ), '[]'::jsonb),
    'countries', coalesce((
      SELECT jsonb_agg(row_to_json(c) ORDER BY c.sessions DESC, c.code)
        FROM (
          SELECT upper(e.country) AS code, count(DISTINCT e.session_id) AS sessions
            FROM public.analytics_events e
           WHERE e.tenant_id = v_tenant AND e.created_at >= now() - v_window
             AND e.country IS NOT NULL
           GROUP BY 1
        ) c
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_realtime(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_realtime(integer, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Warstwa semantyczna (kopia z 20260725162011): `signed_in_users` ->
--    `signed_in_sessions` liczone jak `sessions`, plus jawne `pg_temp`
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_semantic_snapshot(
  p_since timestamptz,
  p_until timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
    'signed_in_sessions', COUNT(DISTINCT session_id) FILTER (WHERE signed_in AND session_id IS NOT NULL)
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

-- ---------------------------------------------------------------------------
-- 5) Widok dzienny: `unique_users` -> `signed_in_sessions`
-- ---------------------------------------------------------------------------
-- Widok agregujący dla panelu admin (SECURITY INVOKER - dziedziczy RLS z tabeli).
-- Kolumny poza przemianowaną są przepisane z 20260722234931 bez zmian.
DROP VIEW IF EXISTS public.analytics_events_daily;
CREATE VIEW public.analytics_events_daily
WITH (security_invoker = on)
AS
SELECT
  tenant_id,
  event_name,
  event_type,
  date_trunc('day', created_at) AS day,
  COUNT(*)::bigint AS hits,
  COUNT(DISTINCT session_id)::bigint AS unique_sessions,
  COUNT(DISTINCT session_id) FILTER (WHERE signed_in)::bigint AS signed_in_sessions
FROM public.analytics_events
GROUP BY tenant_id, event_name, event_type, date_trunc('day', created_at);

REVOKE ALL ON public.analytics_events_daily FROM PUBLIC, anon;
GRANT SELECT ON public.analytics_events_daily TO authenticated;
