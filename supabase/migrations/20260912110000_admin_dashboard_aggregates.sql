-- pg-harness: exclude
--   Znacznik dla `scripts/pg-harness/run.sh` (harness modulu Discussion Club).
--
--   DLACZEGO SELEKTOR TO LAPIE. Harness dobiera migracje PO TRESCI:
--   `grep -lE 'public\.(club_|admin_club_)'`. Ten plik ma DOKLADNIE JEDNO
--   takie trafienie - `count(*) FROM public.club_members` w jednym polu
--   `admin_dashboard_audience` (kafelek "czlonkowie klubow" na pulpicie).
--   To jest ODCZYT, a nie udzial w module.
--
--   DLACZEGO NIE DA SIE GO TU ZAAPLIKOWAC. Atrapa harnessu odtwarza
--   POWIERZCHNIE STYKU MODULU KLUBOW i nic poza nia (patrz README: "to nie jest
--   replika bazy produkcyjnej"). Ten plik zaczyna od `ALTER TABLE
--   public.analytics_events`, a dalej czyta `crm_leads`, `newsletter_*`,
--   `payment_orders`, `donations`, `posts` i `post_views` - czyli powierzchnie,
--   ktorej harness klubowy CELOWO nie stawia. Stad `relation
--   "public.analytics_events" does not exist` i wywrocony caly przebieg.
--
--   WYKLUCZENIE NIE TRACI POKRYCIA KLUBOWEGO - ZERO, nie "niewiele". Plik nie
--   tworzy ani nie zmienia ZADNEGO obiektu klubowego: zero `CREATE FUNCTION`,
--   `CREATE TABLE`, `CREATE VIEW` i `CREATE POLICY` dotykajacych `public.club_`
--   albo `public.admin_club_`. Harness ma dowodzic, ze migracje modulu klubow
--   WYKONUJA sie na jego powierzchni; ta do modulu nie nalezy i nie ma czego
--   dolozyc do tego dowodu.
--
--   ROZSZERZANIE ATRAPY BYLOBY ZLYM LEKARSTWEM. Zeby ten plik przeszedl,
--   harness klubowy musialby postawic kilkanascie tabel analitycznych,
--   sprzedazowych i platniczych - czyli przestac byc atrapa modulu i stac sie
--   replika bazy, ktora README wprost odrzuca.
--
--   CZEGO TO WYKLUCZENIE NIE ZALATWIA, powiedziane wprost: agregaty pulpitu nie
--   maja wlasnego harnessu wykonaniowego w CI. Bramki `check:sql-*` czytaja je
--   jako tekst, a wiec nie zlapia bledu, ktory ujawnia sie dopiero przy
--   wywolaniu. Wlasciwym miejscem na ten dowod jest osobny harness pulpitu
--   (wzorem `scripts/careers-harness` i `scripts/events-harness`), a nie
--   doklejenie sie do harnessu cudzego modulu.

-- PULPIT ADMINA: kraj odwiedzającego + agregaty okresowe.
--
-- DLACZEGO AGREGAT SIEDZI W BAZIE, A NIE W FUNKCJI SERWEROWEJ. Pulpit liczy
-- wielkości, których PostgREST policzyć nie umie: liczbę RÓŻNYCH sesji, rozkład
-- po kraju, szereg dzienny. Jedyną alternatywą dla agregatu w bazie jest
-- ściągnięcie surowych wierszy do Node i policzenie ich tam - a `analytics_events`
-- rośnie o wiersz na odsłonę, więc "rok" to miliony wierszy przez sieć na każde
-- wejście na /admin. Te funkcje zwracają zamiast tego kilka kilobajtów jsonb.
--
-- KAŻDA FUNKCJA DOSTAJE OBA OKNA - bieżące i odniesienia. Nie po to, żeby
-- oszczędzić jedno zapytanie, tylko żeby obie strony porównania liczył TEN SAM
-- kod: gdyby okno poprzednie liczyła druga funkcja (albo drugie wywołanie
-- z innym filtrem), różnica na pulpicie mogłaby pochodzić z rozjazdu definicji,
-- a nie ze zmiany w danych.
--
-- IZOLACJA NAJEMCÓW. Wszystkie funkcje są SECURITY DEFINER (omijają RLS), więc
-- tenant jest brany Z PROFILU WOŁAJĄCEGO, nigdy z `public_tenant_id()` - ten
-- ostatni pochodzi z nagłówka x-tenant-host, który klient może podrobić, a
-- połączenie go z bramką roli jest dokładnie tą klasą wycieku, którą pilnuje
-- `check:sql-tenant-scope`.
--
-- BRAMKA ROLI TO ADMIN ALBO EDYTOR - świadomie WĘŻEJ niż `is_staff()`, które
-- przepuszcza też autora. Pulpit pokazuje przychód, lejek sprzedaży i dane
-- kontaktowe; autor ma prawo do swoich wpisów, nie do rozliczeń. Ta sama para
-- ról stoi w politykach RLS `analytics_events`, `ad_events` i
-- `newsletter_campaign_events`, więc agregat nie otwiera niczego, czego rola nie
-- mogła już przeczytać wierszami.

-- ---------------------------------------------------------------------------
-- 1) Kraj odwiedzającego
-- ---------------------------------------------------------------------------
-- Ruch miał dotąd `lang`, ale język NIE JEST krajem: polszczyzna czytelnika
-- z Brukseli mówi o jego przeglądarce, a nie o tym, skąd ogląda. Kod kraju
-- ustawia ingest z nagłówka geolokalizacyjnego CDN-a (patrz
-- src/routes/api/public/track.ts); kolumna jest NULLOWALNA, bo nagłówka może nie
-- być (dev, self-hosting, odwiedzający bez rozpoznanego kraju), a zgadywanie
-- kraju byłoby gorsze od przyznania się do jego braku.
ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS country text;

-- Indeks CZĘŚCIOWY: wiersze bez kraju nie wchodzą do mapy, więc nie ma po co
-- trzymać ich w indeksie, który wyłącznie mapa czyta.
CREATE INDEX IF NOT EXISTS analytics_events_tenant_country_created_idx
  ON public.analytics_events (tenant_id, country, created_at DESC)
  WHERE country IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Wspólna bramka
-- ---------------------------------------------------------------------------
-- Tenant wołającego albo NULL, gdy wołający nie ma prawa czytać pulpitu.
-- Wydzielone, bo powtarzało się w pięciu funkcjach, a bramka skopiowana pięć
-- razy to pięć miejsc, w których można ją poluzować pojedynczo.
CREATE OR REPLACE FUNCTION public.admin_dashboard_tenant()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.tenant_id
    FROM public.profiles p
   WHERE p.id = auth.uid()
     AND auth.uid() IS NOT NULL
     AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
$$;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_tenant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_tenant() TO authenticated, service_role;

-- Ziarno szeregu sprowadzone do wartości, którą zna `date_trunc`. Nieznane
-- ziarno degraduje się do doby, zamiast wywracać zapytanie: parametr przychodzi
-- z klienta, a pulpit ma pokazać wykres, nie pięćsetkę.
CREATE OR REPLACE FUNCTION public.admin_dashboard_bucket(p_bucket text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT CASE lower(coalesce(p_bucket, 'day'))
           WHEN 'minute' THEN 'minute'
           WHEN 'hour'   THEN 'hour'
           WHEN 'week'   THEN 'week'
           WHEN 'month'  THEN 'month'
           ELSE 'day'
         END
$$;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_bucket(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_bucket(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Ruch na stronie + pochodzenie geograficzne
-- ---------------------------------------------------------------------------
-- KUBEŁKOWANIE IDZIE W STREFIE OGLĄDAJĄCEGO. `created_at` jest w UTC, a "doba"
-- na pulpicie ma znaczyć dobę osoby, która na niego patrzy - inaczej poniedziałek
-- w Warszawie zaczynałby się na wykresie o 2:00. Przesunięcie przychodzi
-- minutami z klienta i jest tu doklejane PRZED `date_trunc`; zwracany znacznik
-- jest więc czasem ŚCIENNYM i klient formatuje go bez dalszej konwersji.
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
               'members',    count(DISTINCT e.user_id) FILTER (WHERE e.user_id IS NOT NULL),
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
               'members',    count(DISTINCT e.user_id) FILTER (WHERE e.user_id IS NOT NULL),
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
-- 4) CRM
-- ---------------------------------------------------------------------------
-- Lejek, zadania i pochodzenie kontaktów. `crm_leads.country` istnieje od
-- początku modułu, więc mapa "skąd są pozyskani ludzie" nie czeka na żaden
-- backfill - w odróżnieniu od mapy ruchu, która rusza dopiero z nowym
-- `analytics_events.country`.
CREATE OR REPLACE FUNCTION public.admin_dashboard_crm(
  p_since timestamptz,
  p_until timestamptz,
  p_prev_since timestamptz,
  p_prev_until timestamptz,
  p_bucket text DEFAULT 'day',
  p_offset_minutes integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.admin_dashboard_tenant();
  v_bucket text := public.admin_dashboard_bucket(p_bucket);
  v_shift  interval := make_interval(mins => coalesce(p_offset_minutes, 0));
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Forbidden: admin or editor role required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'current', (
      SELECT jsonb_build_object(
               'newLeads',   count(*),
               'won',        count(*) FILTER (WHERE l.stage = 'won'),
               'lost',       count(*) FILTER (WHERE l.stage = 'lost'),
               'hot',        count(*) FILTER (WHERE l.score_band = 'hot'),
               'consented',  count(*) FILTER (WHERE l.marketing_consent)
             )
        FROM public.crm_leads l
       WHERE l.tenant_id = v_tenant
         AND l.created_at >= p_since AND l.created_at < p_until
    ),
    'previous', (
      SELECT jsonb_build_object(
               'newLeads',   count(*),
               'won',        count(*) FILTER (WHERE l.stage = 'won'),
               'lost',       count(*) FILTER (WHERE l.stage = 'lost'),
               'hot',        count(*) FILTER (WHERE l.score_band = 'hot'),
               'consented',  count(*) FILTER (WHERE l.marketing_consent)
             )
        FROM public.crm_leads l
       WHERE l.tenant_id = v_tenant
         AND l.created_at >= p_prev_since AND l.created_at < p_prev_until
    ),
    -- STAN LEJKA JEST STANEM NA TERAZ, nie sumą z okna. Etap kontaktu zmienia
    -- się w miejscu (kolumna `stage`), więc historii etapów w tej tabeli NIE MA
    -- i "ilu było zakwalifikowanych we wrześniu" nie da się z niej odczytać.
    -- Zamiast zmyślać taką liczbę, pulpit pokazuje lejek bieżący i mówi o tym
    -- wprost w podpisie.
    'stages', coalesce((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.stage)
        FROM (
          SELECT l.stage::text AS stage, count(*) AS leads
            FROM public.crm_leads l
           WHERE l.tenant_id = v_tenant
           GROUP BY l.stage
        ) s
    ), '[]'::jsonb),
    'sources', coalesce((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.leads DESC, s.source)
        FROM (
          SELECT coalesce(l.source_type::text, 'other') AS source, count(*) AS leads
            FROM public.crm_leads l
           WHERE l.tenant_id = v_tenant
             AND l.created_at >= p_since AND l.created_at < p_until
           GROUP BY 1
        ) s
    ), '[]'::jsonb),
    'countries', coalesce((
      SELECT jsonb_agg(row_to_json(c) ORDER BY c.leads DESC, c.code)
        FROM (
          SELECT upper(l.country) AS code, count(*) AS leads
            FROM public.crm_leads l
           WHERE l.tenant_id = v_tenant
             AND l.country IS NOT NULL AND length(trim(l.country)) = 2
           GROUP BY 1
        ) c
    ), '[]'::jsonb),
    'series', coalesce((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.bucket)
        FROM (
          SELECT to_char(date_trunc(v_bucket, l.created_at + v_shift), 'YYYY-MM-DD HH24:MI') AS bucket,
                 count(*) AS leads
            FROM public.crm_leads l
           WHERE l.tenant_id = v_tenant
             AND l.created_at >= p_since AND l.created_at < p_until
           GROUP BY 1
        ) s
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'leads',     (SELECT count(*) FROM public.crm_leads l WHERE l.tenant_id = v_tenant),
      'companies', (SELECT count(*) FROM public.crm_companies c WHERE c.tenant_id = v_tenant),
      'tasksOpen', (SELECT count(*) FROM public.crm_tasks t
                     WHERE t.tenant_id = v_tenant AND t.status <> 'done'),
      'tasksOverdue', (SELECT count(*) FROM public.crm_tasks t
                        WHERE t.tenant_id = v_tenant AND t.status <> 'done'
                          AND t.due_at IS NOT NULL AND t.due_at < now()),
      'tasksDone', (SELECT count(*) FROM public.crm_tasks t
                     WHERE t.tenant_id = v_tenant AND t.completed_at IS NOT NULL
                       AND t.completed_at >= p_since AND t.completed_at < p_until)
    )
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_crm(timestamptz, timestamptz, timestamptz, timestamptz, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_crm(timestamptz, timestamptz, timestamptz, timestamptz, text, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Marketing
-- ---------------------------------------------------------------------------
-- Newsletter, pop-upy, reklamy i pieniądze w jednym odczycie. Przychód sumuje
-- PŁATNOŚCI ZAKSIĘGOWANE (`paid_at`), nie zamówienia złożone: zamówienie
-- w stanie `pending` nie jest przychodem i pulpit nie ma prawa go tak pokazać.
CREATE OR REPLACE FUNCTION public.admin_dashboard_marketing(
  p_since timestamptz,
  p_until timestamptz,
  p_prev_since timestamptz,
  p_prev_until timestamptz,
  p_bucket text DEFAULT 'day',
  p_offset_minutes integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.admin_dashboard_tenant();
  v_bucket text := public.admin_dashboard_bucket(p_bucket);
  v_shift  interval := make_interval(mins => coalesce(p_offset_minutes, 0));
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Forbidden: admin or editor role required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'current', jsonb_build_object(
      'subscribed',   (SELECT count(*) FROM public.newsletter_subscribers s
                        WHERE s.tenant_id = v_tenant AND s.confirmed_at IS NOT NULL
                          AND s.confirmed_at >= p_since AND s.confirmed_at < p_until),
      'unsubscribed', (SELECT count(*) FROM public.newsletter_subscribers s
                        WHERE s.tenant_id = v_tenant AND s.unsubscribed_at IS NOT NULL
                          AND s.unsubscribed_at >= p_since AND s.unsubscribed_at < p_until),
      'sent',         (SELECT coalesce(sum(c.sent_count), 0) FROM public.newsletter_campaigns c
                        WHERE c.tenant_id = v_tenant AND c.finished_at IS NOT NULL
                          AND c.finished_at >= p_since AND c.finished_at < p_until),
      'opens',        (SELECT count(*) FROM public.newsletter_campaign_events e
                        WHERE e.tenant_id = v_tenant AND e.kind = 'open'
                          AND e.created_at >= p_since AND e.created_at < p_until),
      'clicks',       (SELECT count(*) FROM public.newsletter_campaign_events e
                        WHERE e.tenant_id = v_tenant AND e.kind = 'click'
                          AND e.created_at >= p_since AND e.created_at < p_until),
      'popupViews',   (SELECT count(*) FROM public.popup_events p
                        WHERE p.tenant_id = v_tenant AND p.kind = 'view'
                          AND p.created_at >= p_since AND p.created_at < p_until),
      'popupConversions', (SELECT count(*) FROM public.popup_events p
                        WHERE p.tenant_id = v_tenant AND p.kind = 'conversion'
                          AND p.created_at >= p_since AND p.created_at < p_until),
      'adImpressions',(SELECT count(*) FROM public.ad_events a
                        WHERE a.tenant_id = v_tenant AND a.kind = 'impression'
                          AND a.created_at >= p_since AND a.created_at < p_until),
      'adClicks',     (SELECT count(*) FROM public.ad_events a
                        WHERE a.tenant_id = v_tenant AND a.kind = 'click'
                          AND a.created_at >= p_since AND a.created_at < p_until),
      'orders',       (SELECT count(*) FROM public.payment_orders o
                        WHERE o.tenant_id = v_tenant AND o.paid_at IS NOT NULL
                          AND o.paid_at >= p_since AND o.paid_at < p_until),
      -- PIENIĄDZE ROZBITE PO WALUCIE, nie zsumowane w jedną liczbę.
      -- `payment_orders.currency` jest per zamówienie, więc `sum(amount_cents)`
      -- po całej tabeli dodaje złotówki do euro i daje wielkość, która nie jest
      -- kwotą w żadnej walucie. Panel wybiera z tej listy walutę wiodącą
      -- i mówi wprost, gdy są inne.
      'revenue', coalesce((
        SELECT jsonb_agg(row_to_json(r) ORDER BY r.cents DESC, r.currency)
          FROM (
            SELECT upper(coalesce(nullif(trim(o.currency), ''), 'PLN')) AS currency,
                   sum(o.amount_cents - coalesce(o.refunded_amount_cents, 0)) AS cents,
                   count(*) AS orders
              FROM public.payment_orders o
             WHERE o.tenant_id = v_tenant AND o.paid_at IS NOT NULL
               AND o.paid_at >= p_since AND o.paid_at < p_until
             GROUP BY 1
          ) r
      ), '[]'::jsonb),
      'donations', coalesce((
        SELECT jsonb_agg(row_to_json(r) ORDER BY r.cents DESC, r.currency)
          FROM (
            SELECT upper(coalesce(nullif(trim(d.currency), ''), 'PLN')) AS currency,
                   sum(d.amount_cents) AS cents,
                   count(*) AS orders
              FROM public.donations d
             WHERE d.tenant_id = v_tenant AND d.paid_at IS NOT NULL
               AND d.paid_at >= p_since AND d.paid_at < p_until
             GROUP BY 1
          ) r
      ), '[]'::jsonb),
      'leadForms',    (SELECT count(*) FROM public.contact_messages m
                        WHERE m.tenant_id = v_tenant
                          AND m.created_at >= p_since AND m.created_at < p_until)
    ),
    'previous', jsonb_build_object(
      'subscribed',   (SELECT count(*) FROM public.newsletter_subscribers s
                        WHERE s.tenant_id = v_tenant AND s.confirmed_at IS NOT NULL
                          AND s.confirmed_at >= p_prev_since AND s.confirmed_at < p_prev_until),
      'unsubscribed', (SELECT count(*) FROM public.newsletter_subscribers s
                        WHERE s.tenant_id = v_tenant AND s.unsubscribed_at IS NOT NULL
                          AND s.unsubscribed_at >= p_prev_since AND s.unsubscribed_at < p_prev_until),
      'sent',         (SELECT coalesce(sum(c.sent_count), 0) FROM public.newsletter_campaigns c
                        WHERE c.tenant_id = v_tenant AND c.finished_at IS NOT NULL
                          AND c.finished_at >= p_prev_since AND c.finished_at < p_prev_until),
      'opens',        (SELECT count(*) FROM public.newsletter_campaign_events e
                        WHERE e.tenant_id = v_tenant AND e.kind = 'open'
                          AND e.created_at >= p_prev_since AND e.created_at < p_prev_until),
      'clicks',       (SELECT count(*) FROM public.newsletter_campaign_events e
                        WHERE e.tenant_id = v_tenant AND e.kind = 'click'
                          AND e.created_at >= p_prev_since AND e.created_at < p_prev_until),
      'popupViews',   (SELECT count(*) FROM public.popup_events p
                        WHERE p.tenant_id = v_tenant AND p.kind = 'view'
                          AND p.created_at >= p_prev_since AND p.created_at < p_prev_until),
      'popupConversions', (SELECT count(*) FROM public.popup_events p
                        WHERE p.tenant_id = v_tenant AND p.kind = 'conversion'
                          AND p.created_at >= p_prev_since AND p.created_at < p_prev_until),
      'adImpressions',(SELECT count(*) FROM public.ad_events a
                        WHERE a.tenant_id = v_tenant AND a.kind = 'impression'
                          AND a.created_at >= p_prev_since AND a.created_at < p_prev_until),
      'adClicks',     (SELECT count(*) FROM public.ad_events a
                        WHERE a.tenant_id = v_tenant AND a.kind = 'click'
                          AND a.created_at >= p_prev_since AND a.created_at < p_prev_until),
      'orders',       (SELECT count(*) FROM public.payment_orders o
                        WHERE o.tenant_id = v_tenant AND o.paid_at IS NOT NULL
                          AND o.paid_at >= p_prev_since AND o.paid_at < p_prev_until),
      -- PIENIĄDZE ROZBITE PO WALUCIE, nie zsumowane w jedną liczbę.
      -- `payment_orders.currency` jest per zamówienie, więc `sum(amount_cents)`
      -- po całej tabeli dodaje złotówki do euro i daje wielkość, która nie jest
      -- kwotą w żadnej walucie. Panel wybiera z tej listy walutę wiodącą
      -- i mówi wprost, gdy są inne.
      'revenue', coalesce((
        SELECT jsonb_agg(row_to_json(r) ORDER BY r.cents DESC, r.currency)
          FROM (
            SELECT upper(coalesce(nullif(trim(o.currency), ''), 'PLN')) AS currency,
                   sum(o.amount_cents - coalesce(o.refunded_amount_cents, 0)) AS cents,
                   count(*) AS orders
              FROM public.payment_orders o
             WHERE o.tenant_id = v_tenant AND o.paid_at IS NOT NULL
               AND o.paid_at >= p_prev_since AND o.paid_at < p_prev_until
             GROUP BY 1
          ) r
      ), '[]'::jsonb),
      'donations', coalesce((
        SELECT jsonb_agg(row_to_json(r) ORDER BY r.cents DESC, r.currency)
          FROM (
            SELECT upper(coalesce(nullif(trim(d.currency), ''), 'PLN')) AS currency,
                   sum(d.amount_cents) AS cents,
                   count(*) AS orders
              FROM public.donations d
             WHERE d.tenant_id = v_tenant AND d.paid_at IS NOT NULL
               AND d.paid_at >= p_prev_since AND d.paid_at < p_prev_until
             GROUP BY 1
          ) r
      ), '[]'::jsonb),
      'leadForms',    (SELECT count(*) FROM public.contact_messages m
                        WHERE m.tenant_id = v_tenant
                          AND m.created_at >= p_prev_since AND m.created_at < p_prev_until)
    ),
    'series', coalesce((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.bucket)
        FROM (
          SELECT to_char(date_trunc(v_bucket, s.confirmed_at + v_shift), 'YYYY-MM-DD HH24:MI') AS bucket,
                 count(*) AS subscribed
            FROM public.newsletter_subscribers s
           WHERE s.tenant_id = v_tenant AND s.confirmed_at IS NOT NULL
             AND s.confirmed_at >= p_since AND s.confirmed_at < p_until
           GROUP BY 1
        ) s
    ), '[]'::jsonb),
    'campaigns', coalesce((
      SELECT jsonb_agg(row_to_json(c) ORDER BY c.finished_at DESC)
        FROM (
          SELECT c.name,
                 c.sent_count,
                 c.failed_count,
                 c.recipient_count,
                 to_char(c.finished_at + v_shift, 'YYYY-MM-DD HH24:MI') AS finished_at,
                 (SELECT count(*) FROM public.newsletter_campaign_events e
                   WHERE e.campaign_id = c.id AND e.kind = 'open')  AS opens,
                 (SELECT count(*) FROM public.newsletter_campaign_events e
                   WHERE e.campaign_id = c.id AND e.kind = 'click') AS clicks
            FROM public.newsletter_campaigns c
           WHERE c.tenant_id = v_tenant AND c.finished_at IS NOT NULL
             AND c.finished_at >= p_since AND c.finished_at < p_until
           ORDER BY c.finished_at DESC
           LIMIT 8
        ) c
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'subscribers', (SELECT count(*) FROM public.newsletter_subscribers s
                       WHERE s.tenant_id = v_tenant AND s.status = 'subscribed'),
      'pending',     (SELECT count(*) FROM public.newsletter_subscribers s
                       WHERE s.tenant_id = v_tenant AND s.status = 'pending')
    )
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_marketing(timestamptz, timestamptz, timestamptz, timestamptz, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_marketing(timestamptz, timestamptz, timestamptz, timestamptz, text, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Użytkownicy platformy
-- ---------------------------------------------------------------------------
-- "Ilu nas jest" liczymy z `profiles`, nie z `auth.users`: profil powstaje
-- w tenancie, a konto Supabase jest globalne - liczba kont mieszałaby najemców.
-- Członkostwo AKTYWNE to nadanie nieodwołane i nieprzeterminowane; samo
-- istnienie wiersza w `membership_grants` nim nie jest.
CREATE OR REPLACE FUNCTION public.admin_dashboard_audience(
  p_since timestamptz,
  p_until timestamptz,
  p_prev_since timestamptz,
  p_prev_until timestamptz,
  p_bucket text DEFAULT 'day',
  p_offset_minutes integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.admin_dashboard_tenant();
  v_bucket text := public.admin_dashboard_bucket(p_bucket);
  v_shift  interval := make_interval(mins => coalesce(p_offset_minutes, 0));
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Forbidden: admin or editor role required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'current', jsonb_build_object(
      'signups',     (SELECT count(*) FROM public.profiles p
                       WHERE p.tenant_id = v_tenant
                         AND p.created_at >= p_since AND p.created_at < p_until),
      'memberships', (SELECT count(*) FROM public.membership_grants g
                       WHERE g.tenant_id = v_tenant
                         AND g.created_at >= p_since AND g.created_at < p_until
                         AND g.revoked_at IS NULL),
      'registrations', (SELECT count(*) FROM public.event_registrations r
                       WHERE r.tenant_id = v_tenant
                         AND r.created_at >= p_since AND r.created_at < p_until),
      'comments',    (SELECT count(*) FROM public.comments c
                       WHERE c.tenant_id = v_tenant
                         AND c.created_at >= p_since AND c.created_at < p_until)
    ),
    'previous', jsonb_build_object(
      'signups',     (SELECT count(*) FROM public.profiles p
                       WHERE p.tenant_id = v_tenant
                         AND p.created_at >= p_prev_since AND p.created_at < p_prev_until),
      'memberships', (SELECT count(*) FROM public.membership_grants g
                       WHERE g.tenant_id = v_tenant
                         AND g.created_at >= p_prev_since AND g.created_at < p_prev_until
                         AND g.revoked_at IS NULL),
      'registrations', (SELECT count(*) FROM public.event_registrations r
                       WHERE r.tenant_id = v_tenant
                         AND r.created_at >= p_prev_since AND r.created_at < p_prev_until),
      'comments',    (SELECT count(*) FROM public.comments c
                       WHERE c.tenant_id = v_tenant
                         AND c.created_at >= p_prev_since AND c.created_at < p_prev_until)
    ),
    'series', coalesce((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.bucket)
        FROM (
          SELECT to_char(date_trunc(v_bucket, p.created_at + v_shift), 'YYYY-MM-DD HH24:MI') AS bucket,
                 count(*) AS signups
            FROM public.profiles p
           WHERE p.tenant_id = v_tenant
             AND p.created_at >= p_since AND p.created_at < p_until
           GROUP BY 1
        ) s
    ), '[]'::jsonb),
    'tiers', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.members DESC, t.tier)
        FROM (
          SELECT g.tier_key AS tier, count(DISTINCT g.user_id) AS members
            FROM public.membership_grants g
           WHERE g.tenant_id = v_tenant
             AND g.revoked_at IS NULL
             AND (g.expires_at IS NULL OR g.expires_at > now())
             AND (g.starts_at IS NULL OR g.starts_at <= now())
           GROUP BY g.tier_key
        ) t
    ), '[]'::jsonb),
    'roles', coalesce((
      SELECT jsonb_agg(row_to_json(r) ORDER BY r.people DESC, r.role)
        FROM (
          SELECT ur.role::text AS role, count(DISTINCT ur.user_id) AS people
            FROM public.user_roles ur
           WHERE ur.tenant_id = v_tenant
           GROUP BY ur.role
        ) r
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'users',       (SELECT count(*) FROM public.profiles p WHERE p.tenant_id = v_tenant),
      'members',     (SELECT count(DISTINCT g.user_id) FROM public.membership_grants g
                       WHERE g.tenant_id = v_tenant AND g.revoked_at IS NULL
                         AND (g.expires_at IS NULL OR g.expires_at > now())
                         AND (g.starts_at IS NULL OR g.starts_at <= now())),
      'subscriptions', (SELECT count(*) FROM public.user_subscriptions s
                         WHERE s.tenant_id = v_tenant AND s.status = 'active'),
      'clubMembers', (SELECT count(*) FROM public.club_members m
                       WHERE m.tenant_id = v_tenant AND m.status = 'active'),
      'pendingComments', (SELECT count(*) FROM public.comments c
                           WHERE c.tenant_id = v_tenant AND c.status = 'pending')
    )
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_audience(timestamptz, timestamptz, timestamptz, timestamptz, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_audience(timestamptz, timestamptz, timestamptz, timestamptz, text, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) Podgląd na żywo
-- ---------------------------------------------------------------------------
-- ODDZIELNA, CELOWO MAŁA FUNKCJA. Pulpit odpytuje ją co kilkanaście sekund, więc
-- nie może przy okazji liczyć lejka sprzedaży ani przychodu.
--
-- "Aktywny teraz" NIE POTRZEBUJE osobnej infrastruktury obecności (kanały
-- Realtime, tabela pulsu). `analytics_events` dostaje wiersz przy każdej odsłonie
-- i przy zdarzeniach interakcji, więc sesja widziana w ciągu ostatnich kilku
-- minut JEST sesją żywą - z dokładnością do okna, które podajemy wprost przy
-- kafelku, zamiast obiecywać sekundową precyzję, której ten pomiar nie ma.
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
    'activeMembers',  (SELECT count(DISTINCT e.user_id) FROM public.analytics_events e
                        WHERE e.tenant_id = v_tenant AND e.created_at >= now() - v_active
                          AND e.user_id IS NOT NULL),
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
-- 8) Treść
-- ---------------------------------------------------------------------------
-- Redakcyjna połowa pulpitu: co wyszło w okresie i co ludzie faktycznie czytali.
-- Czytelność bierzemy z `post_views` (pomiar własny, 5-minutowe okno
-- antyspamowe w `record_post_view`), a nie z `analytics_events`: tam odsłona
-- wpisu jest jedną ze ścieżek, tu jest wprost wierszem o wpisie.
CREATE OR REPLACE FUNCTION public.admin_dashboard_content(
  p_since timestamptz,
  p_until timestamptz,
  p_prev_since timestamptz,
  p_prev_until timestamptz,
  p_lang text DEFAULT 'pl'
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.admin_dashboard_tenant();
  v_pl boolean := lower(coalesce(p_lang, 'pl')) NOT LIKE 'en%';
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Forbidden: admin or editor role required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'current', jsonb_build_object(
      'published', (SELECT count(*) FROM public.posts p
                     WHERE p.tenant_id = v_tenant AND p.deleted_at IS NULL
                       AND p.published_at IS NOT NULL
                       AND p.published_at >= p_since AND p.published_at < p_until),
      'views',     (SELECT count(*) FROM public.post_views v
                     WHERE v.tenant_id = v_tenant
                       AND v.viewed_at >= p_since AND v.viewed_at < p_until),
      'readers',   (SELECT count(DISTINCT v.viewer_hash) FROM public.post_views v
                     WHERE v.tenant_id = v_tenant
                       AND v.viewed_at >= p_since AND v.viewed_at < p_until)
    ),
    'previous', jsonb_build_object(
      'published', (SELECT count(*) FROM public.posts p
                     WHERE p.tenant_id = v_tenant AND p.deleted_at IS NULL
                       AND p.published_at IS NOT NULL
                       AND p.published_at >= p_prev_since AND p.published_at < p_prev_until),
      'views',     (SELECT count(*) FROM public.post_views v
                     WHERE v.tenant_id = v_tenant
                       AND v.viewed_at >= p_prev_since AND v.viewed_at < p_prev_until),
      'readers',   (SELECT count(DISTINCT v.viewer_hash) FROM public.post_views v
                     WHERE v.tenant_id = v_tenant
                       AND v.viewed_at >= p_prev_since AND v.viewed_at < p_prev_until)
    ),
    'topPosts', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.views DESC, t.title)
        FROM (
          SELECT p.slug,
                 coalesce(nullif(CASE WHEN v_pl THEN p.title_pl ELSE p.title_en END, ''),
                          p.title_pl, p.title_en, p.slug) AS title,
                 count(*) AS views,
                 count(DISTINCT v.viewer_hash) AS readers
            FROM public.post_views v
            JOIN public.posts p ON p.id = v.post_id
           WHERE v.tenant_id = v_tenant
             AND v.viewed_at >= p_since AND v.viewed_at < p_until
             AND p.deleted_at IS NULL
           GROUP BY p.slug, p.title_pl, p.title_en
           ORDER BY count(*) DESC, 2
           LIMIT 10
        ) t
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'posts',     (SELECT count(*) FROM public.posts p
                     WHERE p.tenant_id = v_tenant AND p.deleted_at IS NULL),
      'published', (SELECT count(*) FROM public.posts p
                     WHERE p.tenant_id = v_tenant AND p.deleted_at IS NULL AND p.status = 'published'),
      'drafts',    (SELECT count(*) FROM public.posts p
                     WHERE p.tenant_id = v_tenant AND p.deleted_at IS NULL AND p.status = 'draft'),
      'scheduled', (SELECT count(*) FROM public.posts p
                     WHERE p.tenant_id = v_tenant AND p.deleted_at IS NULL AND p.status = 'scheduled')
    )
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_content(timestamptz, timestamptz, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_content(timestamptz, timestamptz, timestamptz, timestamptz, text) TO authenticated, service_role;
