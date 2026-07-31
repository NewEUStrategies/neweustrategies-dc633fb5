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

-- ============================================================================
-- SCALONE Z: 20260725120000_email_suppression_bounce_complaint.sql
--
-- Supabase CLI bierze `version` z prefiksu nazwy pliku, więc DWA pliki o tym
-- samym znaczniku czasu wywalają `duplicate key value violates unique
-- constraint "schema_migrations_pkey"` i przerywają CAŁY `supabase db start` -
-- to dlatego job pgtap w CI nie dobiegał nawet do pierwszego testu. Treść
-- poniżej jest przeniesiona BEZ ZMIAN, w tej samej kolejności, w jakiej CLI
-- stosował pliki (leksykograficznie), więc semantyka migracji się nie zmienia,
-- a każda wersja występuje dokładnie raz (produkcja nie widzi nowych wersji i
-- niczego nie stosuje ponownie).
-- ============================================================================

-- ============================================================================
-- Suppression list + telemetria dostarczalności (bounce / complaint).
--
-- PRZYCZYNA ŹRÓDŁOWA: platforma wysyłała newsletter przez Resend, ale NIE
-- konsumowała webhooków zwrotnych. Twarde odbicia (nieistniejące skrzynki) i
-- skargi na spam ("this is spam" w Gmailu) nigdzie nie lądowały, więc kolejna
-- kampania waliła w te same adresy. To dokładnie ten sygnał, po którym
-- dostawcy obniżają reputację domeny nadawczej, a wytyczne Google dla nadawców
-- masowych (>5000 wiadomości/dzień na Gmaila) wymagają UTRZYMANIA wskaźnika
-- zgłoszeń spamu poniżej 0,30% (docelowo <0,10%) - przekroczenie oznacza
-- throttling albo odrzucanie poczty z całej domeny.
--
-- Ta migracja wprowadza brakującą warstwę danych:
--
--   1) email_suppressions   - kanoniczna lista adresów, na które NIE wolno
--                             wysyłać (tenant-scoped, jeden wiersz na adres).
--                             Trwałe (hard bounce, skarga, blokada) i czasowe
--                             (soft bounce z wygaśnięciem + eskalacją).
--   2) email_delivery_events- append-only log zdarzeń dostawcy (idempotentny
--                             po (provider, provider_event_id) = svix-id),
--                             źródło prawdy dla wskaźników reputacji.
--   3) newsletter_campaign_recipients + provider_message_id / delivery_state
--                             - korelacja webhooka z odbiorcą kampanii oraz
--                             per-odbiorca stan dostawy (delivered/bounced/...).
--   4) RPC: email_record_suppression / email_filter_suppressed /
--           email_apply_delivery_event / email_suppression_release /
--           email_suppression_add / newsletter_deliverability_metrics.
--
-- Izolacja tenantów: KAŻDA tabela i funkcja jest pinowana po tenant_id.
-- Funkcje stafowe autoryzują po is_staff() i skalują po current_tenant_id()
-- (nigdy po public_tenant_id() - patrz scripts/check-sql-tenant-scope.ts).
-- Funkcje pisane przez webhooka są service-role only (REVOKE od authenticated).
--
-- Idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Lista wykluczeń (suppression list)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  -- Klucz porównań: adresy z webhooków przychodzą w różnym case'ie.
  email_norm text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  reason text NOT NULL DEFAULT 'hard_bounce'
    CHECK (reason IN ('hard_bounce','soft_bounce','complaint','manual','unsubscribe','invalid','blocked')),
  -- 'permanent' = blokada bezterminowa; 'transient' = wygasa (expires_at).
  scope text NOT NULL DEFAULT 'permanent' CHECK (scope IN ('permanent','transient')),
  source text NOT NULL DEFAULT 'resend_webhook'
    CHECK (source IN ('resend_webhook','manual','import','system')),
  provider text NOT NULL DEFAULT 'resend',
  provider_message_id text,
  last_event_id text,
  campaign_id uuid REFERENCES public.newsletter_campaigns(id) ON DELETE SET NULL,
  subscriber_id uuid REFERENCES public.newsletter_subscribers(id) ON DELETE SET NULL,
  -- Licznik zdarzeń tej samej klasy - napędza eskalację soft -> hard bounce.
  occurrences integer NOT NULL DEFAULT 1 CHECK (occurrences >= 0),
  diagnostic text,
  expires_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_suppressions IS
  'Lista adresów wykluczonych z wysyłki (bounce/complaint/manual). Aktywna blokada = released_at IS NULL AND (expires_at IS NULL OR expires_at > now()).';
COMMENT ON COLUMN public.email_suppressions.scope IS
  'permanent = bezterminowa (hard bounce, skarga); transient = wygasa (soft bounce z backoffem).';
COMMENT ON COLUMN public.email_suppressions.occurrences IS
  'Liczba zdarzeń tej samej klasy; SOFT_BOUNCE_LIMIT powtórzeń eskaluje wykluczenie do trwałego.';

CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_tenant_email_key
  ON public.email_suppressions (tenant_id, email_norm);
CREATE INDEX IF NOT EXISTS email_suppressions_active_idx
  ON public.email_suppressions (tenant_id, email_norm)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS email_suppressions_tenant_reason_idx
  ON public.email_suppressions (tenant_id, reason, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS email_suppressions_tenant_seen_idx
  ON public.email_suppressions (tenant_id, last_seen_at DESC);

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

-- Adres e-mail to PII: odczyt wyłącznie dla staffu własnego tenanta, zapis
-- wyłącznie przez SECURITY DEFINER RPC (poniżej) i service_role.
REVOKE ALL ON public.email_suppressions FROM PUBLIC, anon;
GRANT SELECT ON public.email_suppressions TO authenticated;
GRANT ALL ON public.email_suppressions TO service_role;

DROP POLICY IF EXISTS email_suppressions_staff_select ON public.email_suppressions;
CREATE POLICY email_suppressions_staff_select
  ON public.email_suppressions FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

DROP TRIGGER IF EXISTS email_suppressions_updated_at ON public.email_suppressions;
CREATE TRIGGER email_suppressions_updated_at
  BEFORE UPDATE ON public.email_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2) Log zdarzeń dostawcy (append-only, idempotentny)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL dopuszczalny: zdarzenie dla adresu, którego nie umiemy przypisać do
  -- tenanta, i tak zapisujemy (diagnostyka), ale nigdy nie liczy się do metryk.
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'resend',
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  kind text NOT NULL CHECK (kind IN
    ('sent','delivered','delayed','bounced','complained','opened','clicked','failed','other')),
  bounce_class text CHECK (bounce_class IN ('hard','soft','block','unknown')),
  email text,
  email_norm text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  provider_message_id text,
  campaign_id uuid REFERENCES public.newsletter_campaigns(id) ON DELETE SET NULL,
  subscriber_id uuid REFERENCES public.newsletter_subscribers(id) ON DELETE SET NULL,
  diagnostic text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

COMMENT ON TABLE public.email_delivery_events IS
  'Surowe zdarzenia dostarczalności od dostawcy (Resend/Svix). Idempotentne po (provider, provider_event_id) - retry webhooka nie dubluje metryk.';

CREATE INDEX IF NOT EXISTS email_delivery_events_tenant_kind_idx
  ON public.email_delivery_events (tenant_id, kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS email_delivery_events_campaign_idx
  ON public.email_delivery_events (campaign_id, kind);
CREATE INDEX IF NOT EXISTS email_delivery_events_message_idx
  ON public.email_delivery_events (provider_message_id);
CREATE INDEX IF NOT EXISTS email_delivery_events_tenant_email_idx
  ON public.email_delivery_events (tenant_id, email_norm, occurred_at DESC);

ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_delivery_events FROM PUBLIC, anon;
GRANT SELECT ON public.email_delivery_events TO authenticated;
GRANT ALL ON public.email_delivery_events TO service_role;

DROP POLICY IF EXISTS email_delivery_events_staff_select ON public.email_delivery_events;
CREATE POLICY email_delivery_events_staff_select
  ON public.email_delivery_events FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

-- ----------------------------------------------------------------------------
-- 3) Korelacja webhooka z odbiorcą kampanii
-- ----------------------------------------------------------------------------
ALTER TABLE public.newsletter_campaign_recipients
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS delivery_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS bounced_at timestamptz,
  ADD COLUMN IF NOT EXISTS complained_at timestamptz,
  ADD COLUMN IF NOT EXISTS bounce_class text;

DO $mig$
BEGIN
  -- 'suppressed' dochodzi do statusów logu: odbiorca pominięty świadomie
  -- (aktywna blokada), a nie z powodu błędu wysyłki.
  ALTER TABLE public.newsletter_campaign_recipients
    DROP CONSTRAINT IF EXISTS newsletter_campaign_recipients_status_check;
  ALTER TABLE public.newsletter_campaign_recipients
    ADD CONSTRAINT newsletter_campaign_recipients_status_check
    CHECK (status IN ('pending','sent','failed','skipped','suppressed'));

  ALTER TABLE public.newsletter_campaign_recipients
    DROP CONSTRAINT IF EXISTS newsletter_campaign_recipients_delivery_state_check;
  ALTER TABLE public.newsletter_campaign_recipients
    ADD CONSTRAINT newsletter_campaign_recipients_delivery_state_check
    CHECK (delivery_state IN
      ('pending','sent','delivered','delayed','bounced','complained','failed','skipped','suppressed'));

  ALTER TABLE public.newsletter_campaign_recipients
    DROP CONSTRAINT IF EXISTS newsletter_campaign_recipients_bounce_class_check;
  ALTER TABLE public.newsletter_campaign_recipients
    ADD CONSTRAINT newsletter_campaign_recipients_bounce_class_check
    CHECK (bounce_class IS NULL OR bounce_class IN ('hard','soft','block','unknown'));
END $mig$;

COMMENT ON COLUMN public.newsletter_campaign_recipients.provider_message_id IS
  'Identyfikator wiadomości u dostawcy (Resend email id) - klucz korelacji zdarzeń webhooka z odbiorcą.';
COMMENT ON COLUMN public.newsletter_campaign_recipients.delivery_state IS
  'Stan dostawy po stronie dostawcy: pending -> sent -> delivered | delayed | bounced | complained | failed.';

CREATE INDEX IF NOT EXISTS campaign_recipients_message_idx
  ON public.newsletter_campaign_recipients (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaign_recipients_tenant_state_idx
  ON public.newsletter_campaign_recipients (tenant_id, delivery_state, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_recipients_tenant_email_ci_idx
  ON public.newsletter_campaign_recipients (tenant_id, lower(email));

-- ----------------------------------------------------------------------------
-- 4) Synchronizacja z listą subskrybentów
--
-- Trwała blokada (hard bounce / skarga / blokada / adres nieistniejący) MUSI
-- natychmiast wyjąć adres z audiencji. Ustawiamy istniejący status
-- 'unsubscribed' (a nie nowy), bo wszystkie zapytania audiencji i UI już go
-- rozumieją - powód blokady żyje w email_suppressions i pokazuje go panel
-- dostarczalności. Blokada czasowa (soft bounce) NIE wypisuje subskrybenta -
-- filtr wysyłki i tak go pominie do czasu wygaśnięcia.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_email_suppression_sync_subscriber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.released_at IS NOT NULL
     OR NEW.scope <> 'permanent'
     OR NEW.reason NOT IN ('hard_bounce','complaint','invalid','blocked','unsubscribe') THEN
    RETURN NEW;
  END IF;

  UPDATE public.newsletter_subscribers ns
     SET status = 'unsubscribed',
         unsubscribed_at = COALESCE(ns.unsubscribed_at, now())
   WHERE ns.tenant_id = NEW.tenant_id
     AND lower(ns.email) = NEW.email_norm
     AND ns.status <> 'unsubscribed';

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Synchronizacja jest efektem ubocznym - nigdy nie może wywrócić zapisu
  -- blokady (blokada jest ważniejsza niż flaga na liście).
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_email_suppression_sync_subscriber ON public.email_suppressions;
CREATE TRIGGER trg_email_suppression_sync_subscriber
  AFTER INSERT OR UPDATE OF reason, scope, released_at ON public.email_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.tg_email_suppression_sync_subscriber();

-- ----------------------------------------------------------------------------
-- 5) Zapis blokady (service role - wywoływane z webhooka)
--
-- Jeden wiersz na (tenant, adres). Reguły:
--   - powaga blokady nigdy nie spada samoczynnie (skarga > blokada > hard >
--     invalid > wypis > manual > soft): późniejszy soft bounce nie zdejmuje
--     trwałej blokady po skardze,
--   - soft bounce jest czasowy z rosnącym backoffem (1d, 2d, 4d, 8d...),
--     a po SOFT_BOUNCE_LIMIT powtórzeniach eskaluje do trwałego hard bounce
--     (Google/Yahoo traktują uporczywe dobijanie się do martwej skrzynki jak
--     sygnał nadawcy niedbałego o higienę listy),
--   - ponowny zapis odblokowanego wcześniej adresu czyści released_at.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_suppression_severity(p_reason text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE p_reason
    WHEN 'complaint'   THEN 100
    WHEN 'blocked'     THEN 80
    WHEN 'hard_bounce' THEN 70
    WHEN 'invalid'     THEN 60
    WHEN 'unsubscribe' THEN 50
    WHEN 'manual'      THEN 40
    WHEN 'soft_bounce' THEN 10
    ELSE 0
  END;
$fn$;

REVOKE ALL ON FUNCTION public.email_suppression_severity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_suppression_severity(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.email_record_suppression(
  p_tenant uuid,
  p_email text,
  p_reason text,
  p_source text DEFAULT 'resend_webhook',
  p_provider text DEFAULT 'resend',
  p_provider_message_id text DEFAULT NULL,
  p_event_id text DEFAULT NULL,
  p_campaign uuid DEFAULT NULL,
  p_subscriber uuid DEFAULT NULL,
  p_diagnostic text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  -- Po tylu miękkich odbiciach adres uznajemy za martwy.
  c_soft_limit constant integer := 4;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_existing public.email_suppressions%ROWTYPE;
  -- Jawny znacznik zamiast FOUND: między SELECT-em a jego użyciem stoi kilka
  -- przypisań, więc poleganie na FOUND byłoby kruche.
  v_has_existing boolean := false;
  v_reason text := p_reason;
  v_scope text;
  v_expires timestamptz;
  v_occurrences integer := 1;
  v_escalated boolean := false;
  v_id uuid;
BEGIN
  IF p_tenant IS NULL OR v_email = '' OR position('@' in v_email) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  IF public.email_suppression_severity(v_reason) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_reason');
  END IF;

  SELECT * INTO v_existing
    FROM public.email_suppressions
   WHERE tenant_id = p_tenant AND email_norm = v_email
   FOR UPDATE;
  v_has_existing := FOUND;

  IF v_has_existing AND v_existing.reason = v_reason AND v_existing.released_at IS NULL THEN
    v_occurrences := v_existing.occurrences + 1;
  ELSIF v_has_existing AND v_existing.reason = v_reason THEN
    -- Blokada była zdjęta ręcznie, a problem wrócił: liczymy od nowa, ale
    -- pamiętamy historię (occurrences rośnie od 1).
    v_occurrences := 1;
  END IF;

  IF v_reason = 'soft_bounce' THEN
    IF v_occurrences >= c_soft_limit THEN
      v_reason := 'hard_bounce';
      v_scope := 'permanent';
      v_expires := NULL;
      v_escalated := true;
    ELSE
      v_scope := 'transient';
      -- Backoff wykładniczy: 1d, 2d, 4d, 8d (cap 8d).
      v_expires := now() + make_interval(days => LEAST(power(2, GREATEST(v_occurrences - 1, 0))::integer, 8));
    END IF;
  ELSE
    v_scope := 'permanent';
    v_expires := NULL;
  END IF;

  -- Nigdy nie osłabiamy istniejącej, aktywnej blokady o wyższej powadze.
  IF v_has_existing
     AND v_existing.released_at IS NULL
     AND public.email_suppression_severity(v_existing.reason) > public.email_suppression_severity(v_reason)
  THEN
    UPDATE public.email_suppressions
       SET last_seen_at = now(),
           occurrences = occurrences + 1,
           last_event_id = COALESCE(p_event_id, last_event_id),
           provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
           diagnostic = COALESCE(p_diagnostic, diagnostic)
     WHERE id = v_existing.id
     RETURNING id INTO v_id;
    RETURN jsonb_build_object(
      'ok', true, 'id', v_id, 'reason', v_existing.reason,
      'scope', v_existing.scope, 'escalated', false, 'kept_stronger', true);
  END IF;

  INSERT INTO public.email_suppressions AS es (
    tenant_id, email, reason, scope, source, provider, provider_message_id,
    last_event_id, campaign_id, subscriber_id, occurrences, diagnostic,
    expires_at, first_seen_at, last_seen_at, meta
  ) VALUES (
    p_tenant, v_email, v_reason, v_scope, p_source, COALESCE(p_provider, 'resend'),
    p_provider_message_id, p_event_id, p_campaign, p_subscriber, v_occurrences,
    left(COALESCE(p_diagnostic, ''), 1000), v_expires, now(), now(),
    COALESCE(p_meta, '{}'::jsonb)
  )
  ON CONFLICT (tenant_id, email_norm) DO UPDATE
     SET reason = EXCLUDED.reason,
         scope = EXCLUDED.scope,
         source = EXCLUDED.source,
         provider = EXCLUDED.provider,
         provider_message_id = COALESCE(EXCLUDED.provider_message_id, es.provider_message_id),
         last_event_id = COALESCE(EXCLUDED.last_event_id, es.last_event_id),
         campaign_id = COALESCE(EXCLUDED.campaign_id, es.campaign_id),
         subscriber_id = COALESCE(EXCLUDED.subscriber_id, es.subscriber_id),
         occurrences = EXCLUDED.occurrences,
         diagnostic = COALESCE(EXCLUDED.diagnostic, es.diagnostic),
         expires_at = EXCLUDED.expires_at,
         last_seen_at = now(),
         released_at = NULL,
         released_by = NULL,
         meta = es.meta || EXCLUDED.meta
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true, 'id', v_id, 'reason', v_reason, 'scope', v_scope,
    'occurrences', v_occurrences, 'escalated', v_escalated);
END;
$fn$;

REVOKE ALL ON FUNCTION public.email_record_suppression(
  uuid, text, text, text, text, text, text, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_record_suppression(
  uuid, text, text, text, text, text, text, uuid, uuid, text, jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 6) Filtr wysyłki: które z podanych adresów są zablokowane
--
-- Zwraca WYŁĄCZNIE aktywne blokady tenanta. Jedno wywołanie na porcję
-- odbiorców zamiast N zapytań - wysyłka nie płaci za higienę listy latencją.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_filter_suppressed(p_tenant uuid, p_emails text[])
RETURNS TABLE (email text, reason text, scope text, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT es.email_norm, es.reason, es.scope, es.expires_at
    FROM public.email_suppressions es
   WHERE es.tenant_id = p_tenant
     AND es.released_at IS NULL
     AND (es.expires_at IS NULL OR es.expires_at > now())
     AND es.email_norm = ANY (
       SELECT DISTINCT lower(btrim(e)) FROM unnest(COALESCE(p_emails, '{}'::text[])) AS e
     );
$fn$;

REVOKE ALL ON FUNCTION public.email_filter_suppressed(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_filter_suppressed(uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.email_is_suppressed(p_tenant uuid, p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.email_suppressions es
     WHERE es.tenant_id = p_tenant
       AND es.email_norm = lower(btrim(COALESCE(p_email, '')))
       AND es.released_at IS NULL
       AND (es.expires_at IS NULL OR es.expires_at > now())
  );
$fn$;

REVOKE ALL ON FUNCTION public.email_is_suppressed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_is_suppressed(uuid, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 7) Zapis zdarzenia dostawcy + skutki uboczne (service role)
--
-- Jedna transakcja: log zdarzenia (idempotentny), aktualizacja stanu dostawy
-- odbiorcy kampanii i - dla odbić/skarg - wpis na listę wykluczeń. Dzięki temu
-- retry webhooka nigdy nie policzy zdarzenia dwa razy w metrykach.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_apply_delivery_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_kind text,
  p_email text,
  p_provider_message_id text DEFAULT NULL,
  p_bounce_class text DEFAULT NULL,
  p_diagnostic text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_tenant_hint uuid DEFAULT NULL,
  p_campaign_hint uuid DEFAULT NULL,
  p_subscriber_hint uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_provider text := COALESCE(NULLIF(btrim(p_provider), ''), 'resend');
  v_tenant uuid := p_tenant_hint;
  v_campaign uuid := p_campaign_hint;
  v_subscriber uuid := p_subscriber_hint;
  v_rec record;
  v_match_count integer := 0;
  v_event_id uuid;
  v_reason text;
  v_suppression jsonb := NULL;
  v_state text;
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_event_id');
  END IF;

  -- (a) Korelacja po identyfikatorze wiadomości: najpewniejsze źródło tenanta,
  --     kampanii i subskrybenta (zapisane w chwili wysyłki).
  IF p_provider_message_id IS NOT NULL AND btrim(p_provider_message_id) <> '' THEN
    SELECT r.tenant_id, r.campaign_id, r.subscriber_id, r.id
      INTO v_rec
      FROM public.newsletter_campaign_recipients r
     WHERE r.provider_message_id = p_provider_message_id
     LIMIT 1;
    IF FOUND THEN
      v_tenant := COALESCE(v_tenant, v_rec.tenant_id);
      v_campaign := COALESCE(v_campaign, v_rec.campaign_id);
      v_subscriber := COALESCE(v_subscriber, v_rec.subscriber_id);
    END IF;
  END IF;

  -- (b) Fallback: jednoznaczne dopasowanie adresu do subskrybenta. Gdy ten sam
  --     adres istnieje w kilku tenantach, NIE zgadujemy - zdarzenie zapisze
  --     się bez tenanta (diagnostyka) zamiast trafić do obcego workspace.
  IF v_tenant IS NULL AND v_email <> '' THEN
    SELECT count(*) INTO v_match_count
      FROM public.newsletter_subscribers ns
     WHERE lower(ns.email) = v_email;
    IF v_match_count = 1 THEN
      SELECT ns.tenant_id, ns.id INTO v_tenant, v_subscriber
        FROM public.newsletter_subscribers ns
       WHERE lower(ns.email) = v_email;
    END IF;
  END IF;

  INSERT INTO public.email_delivery_events (
    tenant_id, provider, provider_event_id, event_type, kind, bounce_class,
    email, provider_message_id, campaign_id, subscriber_id, diagnostic,
    occurred_at, payload
  ) VALUES (
    v_tenant, v_provider, p_event_id, left(p_event_type, 120), p_kind, p_bounce_class,
    NULLIF(v_email, ''), p_provider_message_id, v_campaign, v_subscriber,
    left(COALESCE(p_diagnostic, ''), 1000), COALESCE(p_occurred_at, now()),
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    -- Retry tego samego zdarzenia - potwierdzamy 200 bez skutków ubocznych.
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  -- Stan dostawy per odbiorca kampanii (tylko postęp do przodu: 'delivered'
  -- nie nadpisze późniejszego 'bounced', a spóźniony 'sent' nie cofnie stanu).
  v_state := CASE p_kind
    WHEN 'delivered'  THEN 'delivered'
    WHEN 'bounced'    THEN 'bounced'
    WHEN 'complained' THEN 'complained'
    WHEN 'delayed'    THEN 'delayed'
    WHEN 'failed'     THEN 'failed'
    ELSE NULL
  END;

  IF v_state IS NOT NULL AND p_provider_message_id IS NOT NULL THEN
    UPDATE public.newsletter_campaign_recipients r
       SET delivery_state = v_state,
           bounce_class = COALESCE(p_bounce_class, r.bounce_class),
           delivered_at = CASE WHEN p_kind = 'delivered'
                               THEN COALESCE(r.delivered_at, COALESCE(p_occurred_at, now()))
                               ELSE r.delivered_at END,
           bounced_at = CASE WHEN p_kind = 'bounced'
                             THEN COALESCE(r.bounced_at, COALESCE(p_occurred_at, now()))
                             ELSE r.bounced_at END,
           complained_at = CASE WHEN p_kind = 'complained'
                                THEN COALESCE(r.complained_at, COALESCE(p_occurred_at, now()))
                                ELSE r.complained_at END,
           error = CASE WHEN p_kind IN ('bounced','complained','failed')
                        THEN left(COALESCE(p_diagnostic, r.error, p_event_type), 500)
                        ELSE r.error END
     WHERE r.provider_message_id = p_provider_message_id
       AND (v_state <> 'delivered'
            OR r.delivery_state NOT IN ('bounced','complained','failed'));
  END IF;

  -- Wykluczenie adresu: skarga i twarde odbicie natychmiast i trwale,
  -- miękkie odbicie czasowo (z eskalacją w email_record_suppression).
  v_reason := CASE
    WHEN p_kind = 'complained' THEN 'complaint'
    WHEN p_kind = 'bounced' AND p_bounce_class = 'hard' THEN 'hard_bounce'
    WHEN p_kind = 'bounced' AND p_bounce_class = 'block' THEN 'blocked'
    WHEN p_kind = 'bounced' AND p_bounce_class = 'soft' THEN 'soft_bounce'
    WHEN p_kind = 'bounced' THEN 'soft_bounce'
    ELSE NULL
  END;

  IF v_reason IS NOT NULL AND v_tenant IS NOT NULL AND v_email <> '' THEN
    v_suppression := public.email_record_suppression(
      p_tenant => v_tenant,
      p_email => v_email,
      p_reason => v_reason,
      p_source => 'resend_webhook',
      p_provider => v_provider,
      p_provider_message_id => p_provider_message_id,
      p_event_id => p_event_id,
      p_campaign => v_campaign,
      p_subscriber => v_subscriber,
      p_diagnostic => p_diagnostic,
      p_meta => jsonb_build_object('event_type', p_event_type)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'tenant_id', v_tenant,
    'campaign_id', v_campaign,
    'subscriber_id', v_subscriber,
    'kind', p_kind,
    'suppression', v_suppression);
END;
$fn$;

REVOKE ALL ON FUNCTION public.email_apply_delivery_event(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_apply_delivery_event(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, uuid, jsonb)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 8) Operacje panelu admina (staff-gated, tenant = current_tenant_id())
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_suppression_add(
  p_email text,
  p_reason text DEFAULT 'manual',
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_id uuid;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no_tenant' USING ERRCODE = 'P0002';
  END IF;
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  IF p_reason NOT IN ('manual','blocked','complaint','hard_bounce','invalid','unsubscribe') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.email_suppressions AS es (
    tenant_id, email, reason, scope, source, provider, note, created_by,
    first_seen_at, last_seen_at
  ) VALUES (
    v_tenant, v_email, p_reason, 'permanent', 'manual', 'manual',
    left(COALESCE(p_note, ''), 500), auth.uid(), now(), now()
  )
  ON CONFLICT (tenant_id, email_norm) DO UPDATE
     SET reason = CASE
           WHEN public.email_suppression_severity(EXCLUDED.reason)
                >= public.email_suppression_severity(es.reason)
           THEN EXCLUDED.reason ELSE es.reason END,
         scope = 'permanent',
         expires_at = NULL,
         released_at = NULL,
         released_by = NULL,
         note = COALESCE(NULLIF(EXCLUDED.note, ''), es.note),
         last_seen_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.email_suppression_add(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_suppression_add(text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.email_suppression_release(
  p_id uuid,
  p_resubscribe boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid;
  v_row public.email_suppressions%ROWTYPE;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();

  SELECT * INTO v_row FROM public.email_suppressions WHERE id = p_id;
  IF NOT FOUND OR v_row.tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.email_suppressions
     SET released_at = now(),
         released_by = auth.uid(),
         expires_at = now()
   WHERE id = p_id;

  -- Przywrócenie subskrypcji jest ŚWIADOMĄ decyzją operatora: zdjęcie blokady
  -- po skardze bez zgody odbiorcy to prosta droga z powrotem pod próg Google.
  IF p_resubscribe THEN
    UPDATE public.newsletter_subscribers ns
       SET status = 'subscribed', unsubscribed_at = NULL
     WHERE ns.tenant_id = v_tenant
       AND lower(ns.email) = v_row.email_norm
       AND ns.status = 'unsubscribed';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'resubscribed', p_resubscribe);
END;
$fn$;

REVOKE ALL ON FUNCTION public.email_suppression_release(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_suppression_release(uuid, boolean) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9a) Liczniki dostarczalności (service role) - wspólne źródło prawdy
--
-- Mianownik wskaźnika skarg to liczba wiadomości DOSTARCZONYCH (tak liczy
-- Google Postmaster). Gdy webhook 'email.delivered' nie jest włączony,
-- warstwa aplikacji schodzi na liczbę zaakceptowanych wysyłek - wtedy
-- wskaźnik jest konserwatywny (zaniżony mianownik = zawyżony wskaźnik),
-- nigdy odwrotnie.
--
-- Funkcja bierze tenanta JAWNIE (nie z sesji), bo woła ją także preflight
-- wysyłki działający na service_role, gdzie sesji użytkownika po prostu nie ma.
-- Wariant stafowy (9b) pilnuje autoryzacji i przekazuje current_tenant_id().
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_deliverability_counts(
  p_tenant uuid,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_since timestamptz;
  v_sent_log bigint := 0;
  v_suppressed_log bigint := 0;
  v_sent bigint := 0;
  v_delivered bigint := 0;
  v_bounced bigint := 0;
  v_hard bigint := 0;
  v_soft bigint := 0;
  v_complained bigint := 0;
  v_failed bigint := 0;
  v_delayed bigint := 0;
  v_active bigint := 0;
BEGIN
  IF p_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_tenant');
  END IF;
  v_since := now() - make_interval(days => v_days);

  SELECT
    count(*) FILTER (WHERE kind = 'sent'),
    count(*) FILTER (WHERE kind = 'delivered'),
    count(*) FILTER (WHERE kind = 'bounced'),
    count(*) FILTER (WHERE kind = 'bounced' AND bounce_class IN ('hard','block')),
    count(*) FILTER (WHERE kind = 'bounced'
                       AND COALESCE(bounce_class, 'unknown') NOT IN ('hard','block')),
    count(*) FILTER (WHERE kind = 'complained'),
    count(*) FILTER (WHERE kind = 'failed'),
    count(*) FILTER (WHERE kind = 'delayed')
  INTO v_sent, v_delivered, v_bounced, v_hard, v_soft, v_complained, v_failed, v_delayed
  FROM public.email_delivery_events
  WHERE tenant_id = p_tenant AND occurred_at >= v_since;

  SELECT
    count(*) FILTER (WHERE status = 'sent'),
    count(*) FILTER (WHERE status = 'suppressed')
  INTO v_sent_log, v_suppressed_log
  FROM public.newsletter_campaign_recipients
  WHERE tenant_id = p_tenant AND created_at >= v_since;

  -- Log wysyłek jest niezależnym świadkiem liczby zaakceptowanych wiadomości:
  -- bierzemy większą z wartości, bo webhook 'email.sent' bywa wyłączony.
  v_sent := GREATEST(v_sent, v_sent_log);

  SELECT count(*) INTO v_active
    FROM public.email_suppressions
   WHERE tenant_id = p_tenant
     AND released_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());

  RETURN jsonb_build_object(
    'ok', true,
    'days', v_days,
    'sent', v_sent,
    'delivered', v_delivered,
    'bounced', v_bounced,
    'hard_bounced', v_hard,
    'soft_bounced', v_soft,
    'complained', v_complained,
    'failed', v_failed,
    'delayed', v_delayed,
    'suppressed_sends', v_suppressed_log,
    'active_suppressions', v_active);
END;
$fn$;

REVOKE ALL ON FUNCTION public.email_deliverability_counts(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_deliverability_counts(uuid, integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 9b) Metryki dla panelu (staff, tenant = current_tenant_id())
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.newsletter_deliverability_metrics(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid;
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_since timestamptz;
  v_counts jsonb;
  v_series jsonb;
  v_reasons jsonb;
  v_campaigns jsonb;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_tenant');
  END IF;
  v_since := now() - make_interval(days => v_days);
  v_counts := public.email_deliverability_counts(v_tenant, v_days);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'reason', reason, 'count', c, 'scope', scope) ORDER BY c DESC), '[]'::jsonb)
    INTO v_reasons
    FROM (
      SELECT reason, scope, count(*) AS c
        FROM public.email_suppressions
       WHERE tenant_id = v_tenant
         AND released_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
       GROUP BY reason, scope
    ) g;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', to_char(d.day, 'YYYY-MM-DD'),
           'sent', COALESCE(e.sent, 0),
           'delivered', COALESCE(e.delivered, 0),
           'bounced', COALESCE(e.bounced, 0),
           'complained', COALESCE(e.complained, 0)) ORDER BY d.day), '[]'::jsonb)
    INTO v_series
    FROM generate_series(date_trunc('day', v_since), date_trunc('day', now()), interval '1 day') AS d(day)
    LEFT JOIN (
      SELECT date_trunc('day', occurred_at) AS day,
             count(*) FILTER (WHERE kind = 'sent') AS sent,
             count(*) FILTER (WHERE kind = 'delivered') AS delivered,
             count(*) FILTER (WHERE kind = 'bounced') AS bounced,
             count(*) FILTER (WHERE kind = 'complained') AS complained
        FROM public.email_delivery_events
       WHERE tenant_id = v_tenant AND occurred_at >= v_since
       GROUP BY 1
    ) e ON e.day = d.day;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'name', c.name,
           'finished_at', c.finished_at,
           'sent', COALESCE(r.sent, 0),
           'delivered', COALESCE(r.delivered, 0),
           'bounced', COALESCE(r.bounced, 0),
           'complained', COALESCE(r.complained, 0),
           'suppressed', COALESCE(r.suppressed, 0)) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_campaigns
    FROM (
      SELECT id, name, finished_at, created_at
        FROM public.newsletter_campaigns
       WHERE tenant_id = v_tenant AND status IN ('sent','sending','failed')
       ORDER BY created_at DESC
       LIMIT 10
    ) c
    LEFT JOIN (
      SELECT campaign_id,
             count(*) FILTER (WHERE status = 'sent') AS sent,
             count(*) FILTER (WHERE delivery_state = 'delivered') AS delivered,
             count(*) FILTER (WHERE delivery_state = 'bounced') AS bounced,
             count(*) FILTER (WHERE delivery_state = 'complained') AS complained,
             count(*) FILTER (WHERE status = 'suppressed') AS suppressed
        FROM public.newsletter_campaign_recipients
       WHERE tenant_id = v_tenant
       GROUP BY campaign_id
    ) r ON r.campaign_id = c.id;

  RETURN v_counts || jsonb_build_object(
    'suppression_reasons', v_reasons,
    'series', v_series,
    'campaigns', v_campaigns,
    'generated_at', now()
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.newsletter_deliverability_metrics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.newsletter_deliverability_metrics(integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10) Zasiew historyczny: adresy z twardo nieudanych wysyłek już w logu.
--
-- Migracja nie ma dostępu do webhooków wstecz, ale odbiorcy z trwałym błędem
-- ("Invalid `to` field", 4xx/5xx na adres) są w logu kampanii - od razu
-- lądują na liście jako 'invalid', żeby pierwsza wysyłka po wdrożeniu ich
-- pominęła zamiast powtarzać znany błąd.
-- ----------------------------------------------------------------------------
INSERT INTO public.email_suppressions (
  tenant_id, email, reason, scope, source, provider, diagnostic,
  first_seen_at, last_seen_at, meta
)
SELECT s.tenant_id, s.email_norm, 'invalid', 'permanent', 'system', 'resend',
       s.diagnostic, s.first_at, s.last_at, jsonb_build_object('backfill', true)
  FROM (
    SELECT r.tenant_id,
           lower(r.email) AS email_norm,
           left(max(r.error), 1000) AS diagnostic,
           min(r.created_at) AS first_at,
           max(r.created_at) AS last_at
      FROM public.newsletter_campaign_recipients r
     WHERE r.status = 'failed'
       AND r.error IS NOT NULL
       AND (r.error ILIKE '%invalid%' OR r.error ILIKE '%not exist%' OR r.error ILIKE '%no such user%')
     GROUP BY r.tenant_id, lower(r.email)
  ) s
ON CONFLICT (tenant_id, email_norm) DO NOTHING;

-- Stan dostawy dla historycznych wierszy logu (kolumna dodana z DEFAULT
-- 'pending'): wysłane oznaczamy jako 'sent', nieudane jako 'failed'.
UPDATE public.newsletter_campaign_recipients
   SET delivery_state = CASE status
         WHEN 'sent' THEN 'sent'
         WHEN 'failed' THEN 'failed'
         WHEN 'skipped' THEN 'skipped'
         ELSE 'pending' END
 WHERE delivery_state = 'pending' AND status <> 'pending';
