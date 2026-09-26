-- ============================================================================
-- LEJEK SPRZEDAZY WYDARZENIA POWIAZANY Z KAMPANIAMI GOOGLE ADS.
--
-- BLIZNIAK drizzle/migrations/0059_event_ads_funnel.sql - ten sam SQL
-- wykonywalny (pilnuje tego `src/lib/ci/migrationLaneParity.ts`).
-- events-harness: include
--
-- PO CO
--   Organizator placi za kampanie Google Ads, a do dzis nie mial jak
--   odpowiedziec na pytanie "ile biletow sprzedala kampania X i za ile".
--   Nikt w repozytorium nie zapisywal `utm_*` ani identyfikatorow klikniec
--   (`gclid`/`gbraid`/`wbraid`), a jedyny strumien analityczny
--   (`analytics_events`) celowo niszczy query string (redactUrl) i dlugie
--   ciagi (redactPii) - wiec kampanii nie da sie z niego odtworzyc. Ta
--   migracja stawia CZTERY tabele i dwie powierzchnie zapisu:
--     * `event_funnel_events` - anonimowe kroki lejka (wizyta, rozpoczecie
--       zapisu, rozpoczecie platnosci) z beaconu `/api/public/event-funnel`;
--     * `event_registration_attributions` - JEDNO dotkniecie kampanii
--       przypiete do zgloszenia (pierwsze + ostatnie nie-bezposrednie);
--     * `event_ad_campaigns` - mapowanie kampanii na wydarzenie (po
--       `utm_campaign` albo po identyfikatorze kampanii Google Ads z
--       `gad_campaignid`) + nazwa konwersji do importu offline;
--     * `event_ad_campaign_costs` - koszt dzienny kampanii (mikro-jednostki
--       waluty, wpis reczny albo wklejony CSV) do CPA i ROAS.
--
-- CO ROBI
--   1) `_event_ads_clean`, `_event_ads_touch` - JEDNA normalizacja dotkniecia
--      kampanii dla obu powierzchni zapisu: przyciete teksty, bez znakow
--      sterujacych, UTM z adresem e-mail ODRZUCONY (realny wyciek w
--      `utm_content`), identyfikator klikniecia wylacznie pod regexem
--      i WYLACZNIE przy zgodzie reklamowej, dotkniecie starsze niz 90 dni
--      odrzucone, zrodlo/medium wyprowadzone jak w GA (klikniecie Google =
--      google/cpc, wyszukiwarka = organic, inna domena = referral).
--   2) `event_funnel_track(uuid, jsonb)` - zapis kroku lejka. WYLACZNIE
--      service_role: najemce podaje endpoint z zaufanego hosta (nigdy
--      z ladunku), wydarzenie musi byc OPUBLIKOWANE w tym najemcy, a jeden
--      krok liczy sie raz na sesje (unikalny indeks + ON CONFLICT DO NOTHING).
--   3) `event_registration_attribution_attach(jsonb)` - plaszczyzna publiczna
--      (anon/authenticated): zgloszenie wskazuje `manage_token` zwrocony przez
--      `event_register` (porownanie skrotu SHA-256, `public_tenant_id()`,
--      BEZ has_role). Zapis RAZ (set-once), tylko w dobie od zapisu. Ten sam
--      krok wola most CRM fundamentu (`_event_person_crm_sync`).
--   4) Panel (`assert_event_admin_tenant()`): mapowanie kampanii (lista,
--      zapis, usuniecie), koszty (lista, zapis wsadowy, usuniecie dnia),
--      raport lejka `admin_event_ads_funnel` i eksport konwersji offline
--      `admin_event_ads_conversions_export`.
--   5) `event_ads_retention_prune()` - retencja: identyfikator klikniecia
--      znika po 120 dniach (okno importu Google Ads to 90 dni), surowe kroki
--      lejka po 400 dniach. Harmonogram pg_cron zakladany warunkowo.
--
-- RODO / ePrivacy - CO JEST GWARANTOWANE W BAZIE (a nie tylko w przegladarce)
--   * Identyfikator klikniecia trafia do bazy WYLACZNIE z flaga zgody
--     reklamowej (`ad_consent = true` w ladunku - kategoria marketing CMP,
--     ktora steruje `ad_storage`/`ad_user_data`/`ad_personalization`).
--     CHECK `..._click_consent` pilnuje tego na poziomie wiersza.
--   * Do CRM (widzianego takze przez redaktora) NIE trafia identyfikator
--     klikniecia - tylko utm_source/medium/campaign i id kampanii.
--   * Zgoda marketingowa kontaktu CRM powstaje WYLACZNIE z dowodu w
--     `event_people` (regula mostu fundamentu) - zgoda cookies nie jest zgoda
--     na komunikacje marketingowa i niczego w CRM nie przestawia.
--   * Kroki lejka sa pseudonimowe (identyfikator przegladarki z magazynu
--     analityki), bez adresu IP i bez user-agenta.
--
-- CZEGO NIE ZMIENIA
--   * `event_register` (450 linii redefiniowanych piec razy) - przypiecie
--     atrybucji jest osobnym RPC wolanym po sukcesie zapisu;
--   * `analytics_events` i jej wylaczenie z eksportu RODO;
--   * zadnej istniejacej polityki ani grantu.
--
-- IDEMPOTENCJA
--   CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY/TRIGGER IF EXISTS + CREATE,
--   CREATE OR REPLACE FUNCTION (wszystkie sygnatury sa nowe).
--
-- KOLEJNOSC WDROZENIA
--   Po 20260926090000 (most CRM `_event_person_crm_sync`). Nie zalezy od
--   pozostalych migracji funkcji organizatora.
--
-- Testy: scripts/events-harness/runtime_test.d/28_ads_funnel.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) NORMALIZACJA DOTKNIECIA KAMPANII
-- ----------------------------------------------------------------------------

-- Tekst z adresu (UTM): bez znakow sterujacych, zwiniete biale znaki,
-- przyciety do p_max. Wartosc wygladajaca na adres e-mail jest ODRZUCANA
-- w calosci - nadawcy newsletterow wkladaja adresy do utm_content.
CREATE OR REPLACE FUNCTION public._event_ads_clean(p_value text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN s.v IS NULL OR s.v = '' THEN NULL
    WHEN s.v ~* '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}' THEN NULL
    ELSE btrim(left(s.v, GREATEST(p_max, 1)))
  END
  FROM (
    SELECT btrim(regexp_replace(regexp_replace(p_value, '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g')) AS v
  ) s
$$;

REVOKE ALL ON FUNCTION public._event_ads_clean(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ads_clean(text, integer) TO service_role;

COMMENT ON FUNCTION public._event_ads_clean(text, integer) IS
  'Czysci wartosc UTM: bez znakow sterujacych, zwiniete biale znaki, przyciecie do p_max; wartosc z adresem e-mail = NULL (wyciek w utm_content).';

-- Dotkniecie kampanii z ladunku klienta -> znormalizowany obiekt albo NULL
-- (brak / nieczytelne / starsze niz 90 dni / puste = wejscie bezposrednie).
--
-- Klucze wejscia (snake_case, z `src/lib/analytics/adAttribution.ts`):
--   ts (ms epoki), landing_path, referrer_host, utm_source, utm_medium,
--   utm_campaign, utm_term, utm_content, gad_source, gad_campaign_id,
--   click_id_type, click_id.
-- `click_id_type` bez `click_id` jest dozwolony: klient bez zgody reklamowej
-- wysyla SAM rodzaj klikniecia (to kanal, nie identyfikator), zeby wizyta
-- z reklamy dalej liczyla sie jako google/cpc.
CREATE OR REPLACE FUNCTION public._event_ads_touch(
  p_touch jsonb,
  p_ad_consent boolean,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ms numeric;
  v_ts timestamptz;
  v_src text;
  v_med text;
  v_camp text;
  v_term text;
  v_content text;
  v_gad_source text;
  v_gad_campaign text;
  v_ref text;
  v_path text;
  v_click_type text;
  v_click text;
  v_google boolean;
  v_engine text;
BEGIN
  IF p_touch IS NULL OR jsonb_typeof(p_touch) <> 'object' THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(p_touch->'ts') = 'number' THEN
    v_ms := (p_touch->>'ts')::numeric;
    IF v_ms > 0 AND v_ms < 100000000000000 THEN
      v_ts := to_timestamp(v_ms / 1000.0);
    END IF;
  END IF;
  -- Okno atrybucji Google Ads to 90 dni - starsze dotkniecie niczego nie
  -- przypisze, a zegar klienta spieszacy sie o wiecej niz 5 minut przycinamy.
  IF v_ts IS NULL OR v_ts < p_now - interval '90 days' THEN
    RETURN NULL;
  END IF;
  IF v_ts > p_now + interval '5 minutes' THEN
    v_ts := p_now;
  END IF;

  v_src := lower(public._event_ads_clean(p_touch->>'utm_source', 100));
  v_med := lower(public._event_ads_clean(p_touch->>'utm_medium', 100));
  v_camp := public._event_ads_clean(p_touch->>'utm_campaign', 100);
  v_term := public._event_ads_clean(p_touch->>'utm_term', 100);
  v_content := public._event_ads_clean(p_touch->>'utm_content', 100);
  v_gad_source := CASE
    WHEN p_touch->>'gad_source' ~ '^[0-9]{1,10}$' THEN p_touch->>'gad_source'
  END;
  v_gad_campaign := CASE
    WHEN p_touch->>'gad_campaign_id' ~ '^[0-9]{1,20}$' THEN p_touch->>'gad_campaign_id'
  END;
  v_ref := CASE
    WHEN char_length(p_touch->>'referrer_host') <= 253
     AND lower(p_touch->>'referrer_host') ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      THEN regexp_replace(lower(p_touch->>'referrer_host'), '^www\.', '')
  END;
  v_path := CASE
    WHEN char_length(p_touch->>'landing_path') <= 512
     AND p_touch->>'landing_path' ~ '^/[^[:space:][:cntrl:]?#]*$' THEN p_touch->>'landing_path'
  END;
  IF COALESCE(p_ad_consent, false)
     AND p_touch->>'click_id_type' IN ('gclid', 'gbraid', 'wbraid')
     AND char_length(p_touch->>'click_id') BETWEEN 10 AND 512
     AND p_touch->>'click_id' ~ '^[A-Za-z0-9_-]+$' THEN
    v_click_type := p_touch->>'click_id_type';
    v_click := p_touch->>'click_id';
  END IF;
  v_google := COALESCE(p_touch->>'click_id_type' IN ('gclid', 'gbraid', 'wbraid'), false)
    OR v_gad_source IS NOT NULL
    OR v_gad_campaign IS NOT NULL;

  IF v_src IS NULL AND v_med IS NULL AND v_camp IS NULL AND v_term IS NULL
     AND v_content IS NULL AND NOT v_google AND v_ref IS NULL THEN
    RETURN NULL;
  END IF;

  v_engine := substring(
    v_ref FROM '(?:^|\.)(google|bing|duckduckgo|yahoo|yandex|ecosia|baidu|seznam|qwant|startpage)\.'
  );

  RETURN jsonb_build_object(
    'touch_at', v_ts,
    'landing_path', v_path,
    'referrer_host', v_ref,
    'utm_source', v_src,
    'utm_medium', v_med,
    'utm_campaign', v_camp,
    'utm_term', v_term,
    'utm_content', v_content,
    'gad_source', v_gad_source,
    'gad_campaign_id', v_gad_campaign,
    'click_id_type', v_click_type,
    'click_id', v_click,
    'source', COALESCE(v_src, CASE WHEN v_google THEN 'google' END, v_engine, v_ref, '(not set)'),
    'medium', COALESCE(
      v_med,
      CASE
        WHEN v_google THEN 'cpc'
        WHEN v_engine IS NOT NULL THEN 'organic'
        WHEN v_ref IS NOT NULL THEN 'referral'
      END,
      '(not set)'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_ads_touch(jsonb, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ads_touch(jsonb, boolean, timestamptz) TO service_role;

COMMENT ON FUNCTION public._event_ads_touch(jsonb, boolean, timestamptz) IS
  'Normalizuje dotkniecie kampanii z ladunku klienta: UTM przez _event_ads_clean, gad_* i identyfikator klikniecia pod regexem (klikniecie tylko przy zgodzie reklamowej), starsze niz 90 dni = NULL, zrodlo/medium wyprowadzone jak w GA. NULL = wejscie bezposrednie.';

-- ----------------------------------------------------------------------------
-- 2) TABELE
-- ----------------------------------------------------------------------------

-- 2a) Anonimowe kroki lejka (intake: zapis WYLACZNIE service_role).
CREATE TABLE IF NOT EXISTS public.event_funnel_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  step text NOT NULL,
  visitor_key text NOT NULL,
  session_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  touch_at timestamptz,
  source text NOT NULL DEFAULT '(direct)',
  medium text NOT NULL DEFAULT '(none)',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gad_source text,
  gad_campaign_id text,
  referrer_host text,
  landing_path text,
  click_id_type text,
  click_id text,
  ad_user_data boolean NOT NULL DEFAULT false,
  lang text,
  country text,
  CONSTRAINT event_funnel_events_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_funnel_events_step_values
    CHECK (step IN ('visit', 'registration_start', 'checkout_start')),
  CONSTRAINT event_funnel_events_click_id_type_values
    CHECK (click_id_type IN ('gclid', 'gbraid', 'wbraid')),
  CONSTRAINT event_funnel_events_click_pair CHECK ((click_id IS NULL) = (click_id_type IS NULL)),
  CONSTRAINT event_funnel_events_click_id_format
    CHECK (char_length(click_id) BETWEEN 10 AND 512 AND click_id ~ '^[A-Za-z0-9_-]+$'),
  CONSTRAINT event_funnel_events_click_consent CHECK (click_id IS NULL OR ad_user_data),
  CONSTRAINT event_funnel_events_keys_format
    CHECK (visitor_key ~ '^[A-Za-z0-9-]{8,80}$' AND session_key ~ '^[A-Za-z0-9-]{8,80}$'),
  CONSTRAINT event_funnel_events_lang_values CHECK (lang IN ('pl', 'en')),
  CONSTRAINT event_funnel_events_country_format CHECK (country ~ '^[A-Z]{2}$')
);

COMMENT ON TABLE public.event_funnel_events IS
  'Anonimowe kroki lejka sprzedazy wydarzenia (wizyta, rozpoczecie zapisu, rozpoczecie platnosci) z beaconu /api/public/event-funnel. Zapis wylacznie event_funnel_track (service_role); odczyt admin/super_admin najemcy. Jeden krok raz na sesje.';
COMMENT ON COLUMN public.event_funnel_events.visitor_key IS
  'Pseudonimowy identyfikator przegladarki z magazynu analityki (zgoda analytics). Bez IP i user-agenta.';
COMMENT ON COLUMN public.event_funnel_events.click_id IS
  'gclid/gbraid/wbraid - WYLACZNIE przy zgodzie reklamowej (CHECK event_funnel_events_click_consent), zerowany po 120 dniach (event_ads_retention_prune).';

CREATE UNIQUE INDEX IF NOT EXISTS event_funnel_events_session_step_key
  ON public.event_funnel_events (tenant_id, event_id, step, session_key);
CREATE INDEX IF NOT EXISTS event_funnel_events_event_time_idx
  ON public.event_funnel_events (tenant_id, event_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS event_funnel_events_occurred_idx
  ON public.event_funnel_events (occurred_at);

REVOKE ALL ON public.event_funnel_events FROM anon, authenticated;
GRANT SELECT ON public.event_funnel_events TO authenticated;
GRANT ALL ON public.event_funnel_events TO service_role;
ALTER TABLE public.event_funnel_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_funnel_events_staff_read" ON public.event_funnel_events;
CREATE POLICY "event_funnel_events_staff_read"
  ON public.event_funnel_events FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );
-- Zapis: BRAK polityki klienckiej - wylacznie event_funnel_track (service_role).

-- 2b) Atrybucja przypieta do zgloszenia (dane osobowe - tylko panel).
CREATE TABLE IF NOT EXISTS public.event_registration_attributions (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL,
  event_id uuid NOT NULL,
  first_touch jsonb,
  last_touch jsonb,
  source text NOT NULL DEFAULT '(direct)',
  medium text NOT NULL DEFAULT '(none)',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gad_source text,
  gad_campaign_id text,
  referrer_host text,
  click_id_type text,
  click_id text,
  click_at timestamptz,
  click_pruned_at timestamptz,
  ad_user_data boolean NOT NULL DEFAULT false,
  ad_personalization boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_registration_attributions_pkey PRIMARY KEY (tenant_id, registration_id),
  CONSTRAINT event_registration_attributions_registration_fk FOREIGN KEY (tenant_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_registration_attributions_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_registration_attributions_click_id_type_values
    CHECK (click_id_type IN ('gclid', 'gbraid', 'wbraid')),
  CONSTRAINT event_registration_attributions_click_pair
    CHECK ((click_id IS NULL) = (click_id_type IS NULL) AND (click_id IS NULL OR click_at IS NOT NULL)),
  CONSTRAINT event_registration_attributions_click_id_format
    CHECK (char_length(click_id) BETWEEN 10 AND 512 AND click_id ~ '^[A-Za-z0-9_-]+$'),
  CONSTRAINT event_registration_attributions_click_consent
    CHECK (click_id IS NULL OR ad_user_data),
  CONSTRAINT event_registration_attributions_touch_shape
    CHECK ((first_touch IS NULL OR jsonb_typeof(first_touch) = 'object')
       AND (last_touch IS NULL OR jsonb_typeof(last_touch) = 'object'))
);

COMMENT ON TABLE public.event_registration_attributions IS
  'Dotkniecie kampanii przypiete do zgloszenia (pierwsze + ostatnie nie-bezposrednie, 90 dni). Zapis raz, wylacznie event_registration_attribution_attach (manage_token); odczyt admin/super_admin najemcy. Wiersz bez dotkniec = wejscie bezposrednie przy zgodzie na pomiar.';
COMMENT ON COLUMN public.event_registration_attributions.click_id IS
  'gclid/gbraid/wbraid do importu konwersji offline - wylacznie przy zgodzie reklamowej; zerowany po 120 dniach (click_pruned_at). NIGDY nie trafia do CRM.';

CREATE INDEX IF NOT EXISTS event_registration_attributions_event_idx
  ON public.event_registration_attributions (tenant_id, event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_registration_attributions_click_idx
  ON public.event_registration_attributions (created_at)
  WHERE click_id IS NOT NULL;

REVOKE ALL ON public.event_registration_attributions FROM anon, authenticated;
GRANT SELECT ON public.event_registration_attributions TO authenticated;
GRANT ALL ON public.event_registration_attributions TO service_role;
ALTER TABLE public.event_registration_attributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_registration_attributions_staff_read" ON public.event_registration_attributions;
CREATE POLICY "event_registration_attributions_staff_read"
  ON public.event_registration_attributions FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );
-- Zapis: BRAK polityki klienckiej - wylacznie event_registration_attribution_attach.

-- 2c) Mapowanie kampanii na wydarzenie.
CREATE TABLE IF NOT EXISTS public.event_ad_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'google_ads',
  match_kind text NOT NULL,
  match_value text NOT NULL,
  label text NOT NULL,
  conversion_action_name text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_ad_campaigns_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_ad_campaigns_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_ad_campaigns_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_ad_campaigns_match_unique UNIQUE (tenant_id, event_id, platform, match_kind, match_value),
  CONSTRAINT event_ad_campaigns_platform_values CHECK (platform IN ('google_ads')),
  CONSTRAINT event_ad_campaigns_match_kind_values
    CHECK (match_kind IN ('utm_campaign', 'google_ads_campaign_id')),
  CONSTRAINT event_ad_campaigns_match_value_format CHECK (
    (match_kind = 'google_ads_campaign_id' AND match_value ~ '^[0-9]{1,20}$')
    OR (match_kind = 'utm_campaign' AND match_value = lower(match_value)
        AND char_length(match_value) BETWEEN 1 AND 100)
  ),
  CONSTRAINT event_ad_campaigns_label_len CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  CONSTRAINT event_ad_campaigns_conversion_name_format CHECK (
    conversion_action_name IS NULL
    OR (char_length(conversion_action_name) BETWEEN 1 AND 100
        AND conversion_action_name ~ '^[^,"=+@[:cntrl:]-][^,"[:cntrl:]]*$')
  )
);

COMMENT ON TABLE public.event_ad_campaigns IS
  'Kampanie reklamowe wydarzenia: dopasowanie po utm_campaign (male litery) albo po identyfikatorze kampanii Google Ads (gad_campaignid), etykieta i nazwa konwersji do importu offline. Zapis wylacznie admin_event_ad_campaign_*.';
COMMENT ON COLUMN public.event_ad_campaigns.conversion_action_name IS
  'Nazwa akcji konwersji w Google Ads dla pliku importu offline. Bez przecinkow i cudzyslowow, nie zaczyna sie od znaku formuly.';

CREATE INDEX IF NOT EXISTS event_ad_campaigns_event_idx
  ON public.event_ad_campaigns (tenant_id, event_id, lower(label));

DROP TRIGGER IF EXISTS event_ad_campaigns_touch_updated_at ON public.event_ad_campaigns;
CREATE TRIGGER event_ad_campaigns_touch_updated_at
  BEFORE UPDATE ON public.event_ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

REVOKE ALL ON public.event_ad_campaigns FROM anon, authenticated;
GRANT SELECT ON public.event_ad_campaigns TO authenticated;
GRANT ALL ON public.event_ad_campaigns TO service_role;
ALTER TABLE public.event_ad_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_ad_campaigns_staff_read" ON public.event_ad_campaigns;
CREATE POLICY "event_ad_campaigns_staff_read"
  ON public.event_ad_campaigns FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

-- 2d) Koszt dzienny kampanii.
CREATE TABLE IF NOT EXISTS public.event_ad_campaign_costs (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  day date NOT NULL,
  cost_micros bigint NOT NULL,
  currency text NOT NULL,
  clicks integer,
  impressions integer,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_ad_campaign_costs_pkey PRIMARY KEY (tenant_id, campaign_id, day),
  CONSTRAINT event_ad_campaign_costs_campaign_fk FOREIGN KEY (tenant_id, event_id, campaign_id)
    REFERENCES public.event_ad_campaigns (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_ad_campaign_costs_source_values CHECK (source IN ('manual', 'csv')),
  CONSTRAINT event_ad_campaign_costs_cost_range
    CHECK (cost_micros >= 0 AND cost_micros <= 1000000000000000),
  CONSTRAINT event_ad_campaign_costs_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT event_ad_campaign_costs_counts_range CHECK (
    (clicks IS NULL OR clicks >= 0) AND (impressions IS NULL OR impressions >= 0)
  )
);

COMMENT ON TABLE public.event_ad_campaign_costs IS
  'Koszt dzienny kampanii wydarzenia w mikro-jednostkach waluty (1 PLN = 1 000 000), jak w Google Ads. Wpis reczny albo wklejony CSV; jeden wiersz na kampanie i dzien. Zapis wylacznie admin_event_ad_costs_save / admin_event_ad_cost_delete.';

CREATE INDEX IF NOT EXISTS event_ad_campaign_costs_event_day_idx
  ON public.event_ad_campaign_costs (tenant_id, event_id, day);

DROP TRIGGER IF EXISTS event_ad_campaign_costs_touch_updated_at ON public.event_ad_campaign_costs;
CREATE TRIGGER event_ad_campaign_costs_touch_updated_at
  BEFORE UPDATE ON public.event_ad_campaign_costs
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

REVOKE ALL ON public.event_ad_campaign_costs FROM anon, authenticated;
GRANT SELECT ON public.event_ad_campaign_costs TO authenticated;
GRANT ALL ON public.event_ad_campaign_costs TO service_role;
ALTER TABLE public.event_ad_campaign_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_ad_campaign_costs_staff_read" ON public.event_ad_campaign_costs;
CREATE POLICY "event_ad_campaign_costs_staff_read"
  ON public.event_ad_campaign_costs FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

-- ----------------------------------------------------------------------------
-- 3) ZAPIS KROKU LEJKA (service_role - endpoint /api/public/event-funnel)
--
-- Najemca przychodzi z ZAUFANEGO hosta (resolveTenantIdForHost w endpoincie),
-- nie z ladunku. Wydarzenie wskazuje slug albo identyfikator - i musi byc
-- opublikowane W TYM najemcy. Wynik: true = zapisano, false = pominieto
-- (nieznane/nieopublikowane wydarzenie albo krok juz policzony w tej sesji).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_funnel_track(p_tenant uuid, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_step text;
  v_slug text;
  v_event_id uuid;
  v_visitor text;
  v_session text;
  v_ad boolean;
  v_touch jsonb;
  v_event uuid;
BEGIN
  IF p_tenant IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload: tenant and a payload object are required';
  END IF;

  v_step := p_payload->>'step';
  IF v_step IS NULL OR v_step NOT IN ('visit', 'registration_start', 'checkout_start') THEN
    RAISE EXCEPTION 'invalid_step: %', COALESCE(v_step, '<null>');
  END IF;

  v_session := p_payload->>'session';
  IF v_session IS NULL OR v_session !~ '^[A-Za-z0-9-]{8,80}$' THEN
    RAISE EXCEPTION 'invalid_session: session key is missing or malformed';
  END IF;
  -- Magazyn trwaly bywa zablokowany (tryb prywatny) - wtedy przegladarke
  -- reprezentuje sesja, a nie pusty napis zlewajacy wszystkich w jednego.
  v_visitor := COALESCE(NULLIF(p_payload->>'visitor', ''), v_session);
  IF v_visitor !~ '^[A-Za-z0-9-]{8,80}$' THEN
    RAISE EXCEPTION 'invalid_visitor: visitor key is malformed';
  END IF;

  v_slug := NULLIF(btrim(COALESCE(p_payload->>'slug', '')), '');
  v_event_id := CASE
    WHEN COALESCE(p_payload->>'event_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (p_payload->>'event_id')::uuid
  END;
  IF v_slug IS NULL AND v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_event: slug or event_id is required';
  END IF;

  SELECT e.id INTO v_event
    FROM public.events e
   WHERE e.tenant_id = p_tenant
     AND e.status = 'published'
     AND (e.id = v_event_id OR (v_event_id IS NULL AND e.slug = v_slug))
   LIMIT 1;
  IF v_event IS NULL THEN
    RETURN false;
  END IF;

  v_ad := COALESCE(p_payload->>'ad_consent', '') = 'true';
  v_touch := public._event_ads_touch(p_payload->'touch', v_ad, now());

  INSERT INTO public.event_funnel_events (
    tenant_id, event_id, step, visitor_key, session_key, touch_at, source, medium,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, gad_source, gad_campaign_id,
    referrer_host, landing_path, click_id_type, click_id, ad_user_data, lang, country
  ) VALUES (
    p_tenant, v_event, v_step, v_visitor, v_session,
    (v_touch->>'touch_at')::timestamptz,
    COALESCE(v_touch->>'source', '(direct)'),
    COALESCE(v_touch->>'medium', '(none)'),
    v_touch->>'utm_source', v_touch->>'utm_medium', v_touch->>'utm_campaign',
    v_touch->>'utm_term', v_touch->>'utm_content', v_touch->>'gad_source',
    v_touch->>'gad_campaign_id', v_touch->>'referrer_host', v_touch->>'landing_path',
    v_touch->>'click_id_type', v_touch->>'click_id', v_ad,
    CASE WHEN p_payload->>'lang' IN ('pl', 'en') THEN p_payload->>'lang' END,
    CASE WHEN p_payload->>'country' ~ '^[A-Z]{2}$' THEN p_payload->>'country' END
  )
  ON CONFLICT (tenant_id, event_id, step, session_key) DO NOTHING;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.event_funnel_track(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_funnel_track(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.event_funnel_track(uuid, jsonb) IS
  'Zapis kroku lejka (visit | registration_start | checkout_start) z beaconu /api/public/event-funnel. Wylacznie service_role: najemca z zaufanego hosta, wydarzenie opublikowane w tym najemcy, krok raz na sesje, identyfikator klikniecia tylko przy ad_consent.';

-- ----------------------------------------------------------------------------
-- 4) PRZYPIECIE ATRYBUCJI DO ZGLOSZENIA (plaszczyzna publiczna)
--
-- Klucz: `manage_token` zwrocony RAZ przez `event_register` (w bazie tylko
-- jego SHA-256). Zadnego has_role - najemca z `public_tenant_id()`.
-- Set-once: drugie wywolanie niczego nie zmienia. Tylko w dobie od zapisu -
-- atrybucja nalezy do chwili zapisu, a nie do pozniejszej wizyty z innego
-- urzadzenia z linkiem samoobslugi.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_registration_attribution_attach(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_now timestamptz := now();
  v_token text;
  v_ad boolean;
  v_reg_id uuid;
  v_reg_event uuid;
  v_reg_person uuid;
  v_reg_created timestamptz;
  v_slug text;
  v_title_pl text;
  v_title_en text;
  v_first jsonb;
  v_last jsonb;
  v_click jsonb;
  v_source text;
  v_medium text;
  v_campaign text;
  v_tags text[];
  v_summary_pl text;
  v_summary_en text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload: a payload object is required';
  END IF;

  v_token := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  IF v_tenant IS NULL OR v_token IS NULL OR char_length(v_token) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT r.id, r.event_id, r.person_id, r.created_at
    INTO v_reg_id, v_reg_event, v_reg_person, v_reg_created
    FROM public.event_registrations r
   WHERE r.tenant_id = v_tenant
     AND r.manage_token_hash = encode(digest(v_token, 'sha256'), 'hex')
   FOR UPDATE;
  IF v_reg_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_reg_created < v_now - interval '1 day' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_late');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_registration_attributions a
     WHERE a.tenant_id = v_tenant AND a.registration_id = v_reg_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'attached', false, 'reason', 'already_attached');
  END IF;

  v_ad := COALESCE(p_payload->>'ad_consent', '') = 'true';
  v_first := public._event_ads_touch(p_payload->'first', v_ad, v_now);
  v_last := public._event_ads_touch(p_payload->'last', v_ad, v_now);
  v_first := COALESCE(v_first, v_last);
  v_last := COALESCE(v_last, v_first);
  -- Import offline potrzebuje identyfikatora klikniecia - bierzemy najswiezsze
  -- dotkniecie, ktore go niesie.
  v_click := CASE
    WHEN v_last->>'click_id' IS NOT NULL THEN v_last
    WHEN v_first->>'click_id' IS NOT NULL THEN v_first
  END;
  v_source := COALESCE(v_last->>'source', '(direct)');
  v_medium := COALESCE(v_last->>'medium', '(none)');
  v_campaign := v_last->>'utm_campaign';

  INSERT INTO public.event_registration_attributions AS a (
    tenant_id, registration_id, event_id, first_touch, last_touch, source, medium,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, gad_source, gad_campaign_id,
    referrer_host, click_id_type, click_id, click_at, ad_user_data, ad_personalization, created_at
  ) VALUES (
    v_tenant, v_reg_id, v_reg_event, v_first, v_last, v_source, v_medium,
    v_last->>'utm_source', v_last->>'utm_medium', v_campaign, v_last->>'utm_term',
    v_last->>'utm_content', v_last->>'gad_source', v_last->>'gad_campaign_id',
    v_last->>'referrer_host', v_click->>'click_id_type', v_click->>'click_id',
    (v_click->>'touch_at')::timestamptz, v_ad, v_ad, v_now
  )
  ON CONFLICT (tenant_id, registration_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'attached', false, 'reason', 'already_attached');
  END IF;

  SELECT e.slug, e.title_pl, e.title_en INTO v_slug, v_title_pl, v_title_en
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = v_reg_event;

  -- CRM: kampania na osi czasu kontaktu i w aliases.custom - BEZ identyfikatora
  -- klikniecia (CRM widzi tez redaktor). Zgoda marketingowa wylacznie z dowodu
  -- w event_people (regula mostu). Awaria CRM nie wywraca przypiecia (most
  -- nigdy nie rzuca).
  v_tags := ARRAY['event:' || v_slug];
  IF v_campaign IS NOT NULL THEN
    v_tags := v_tags || left(
      'utm_campaign:' || btrim(regexp_replace(lower(v_campaign), '[^a-z0-9._-]+', '-', 'g'), '-'),
      60
    );
  END IF;
  v_summary_pl := CASE
    WHEN v_campaign IS NOT NULL
      THEN format('Zapis na wydarzenie z kampanii %s (%s / %s)', v_campaign, v_source, v_medium)
    WHEN v_last IS NOT NULL
      THEN format('Zapis na wydarzenie z %s / %s', v_source, v_medium)
    ELSE 'Zapis na wydarzenie bez kampanii'
  END;
  v_summary_en := CASE
    WHEN v_campaign IS NOT NULL
      THEN format('Event registration from campaign %s (%s / %s)', v_campaign, v_source, v_medium)
    WHEN v_last IS NOT NULL
      THEN format('Event registration from %s / %s', v_source, v_medium)
    ELSE 'Event registration without a campaign'
  END;

  PERFORM public._event_person_crm_sync(
    v_tenant,
    v_reg_person,
    'event_participant',
    'event:' || v_slug || ':registration',
    v_tags,
    jsonb_strip_nulls(jsonb_build_object(
      'utm_source', v_last->>'utm_source',
      'utm_medium', v_last->>'utm_medium',
      'utm_campaign', v_campaign,
      'gad_campaign_id', v_last->>'gad_campaign_id'
    )),
    true,
    'event.registration.attributed',
    jsonb_strip_nulls(jsonb_build_object(
      'event_id', v_reg_event,
      'event_slug', v_slug,
      'event_title_pl', v_title_pl,
      'event_title_en', v_title_en,
      'summary_pl', v_summary_pl,
      'summary_en', v_summary_en,
      'registration_id', v_reg_id,
      'source', v_source,
      'medium', v_medium,
      'utm_campaign', v_campaign,
      'gad_campaign_id', v_last->>'gad_campaign_id'
    ))
  );

  RETURN jsonb_build_object(
    'ok', true,
    'attached', true,
    'source', v_source,
    'medium', v_medium,
    'click', v_click IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_registration_attribution_attach(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_attribution_attach(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_attribution_attach(jsonb) IS
  'Przypiecie dotkniecia kampanii do wlasnego zgloszenia pod kluczem manage_token (plaszczyzna publiczna, public_tenant_id, bez has_role). Zapis raz, w dobie od zapisu; identyfikator klikniecia tylko przy ad_consent. Wola most CRM (_event_person_crm_sync: segment event_participant, tagi event:<slug> i utm_campaign:<c>, wpis osi czasu event.registration.attributed) - bez identyfikatora klikniecia.';

-- ----------------------------------------------------------------------------
-- 5) PANEL: MAPOWANIE KAMPANII
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_ad_campaigns_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  match_kind text,
  match_value text,
  label text,
  conversion_action_name text,
  costs jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.match_kind,
    c.match_value,
    c.label,
    c.conversion_action_name,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'currency', s.currency, 'cost_micros', s.micros, 'days', s.days
             ) ORDER BY s.currency)
        FROM (
          SELECT k.currency, sum(k.cost_micros)::bigint AS micros, count(*)::integer AS days
            FROM public.event_ad_campaign_costs k
           WHERE k.tenant_id = v_tenant AND k.campaign_id = c.id
           GROUP BY k.currency
        ) s
    ), '[]'::jsonb),
    c.created_at,
    c.updated_at
  FROM public.event_ad_campaigns c
  WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id
  ORDER BY lower(c.label), c.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ad_campaigns_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ad_campaigns_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ad_campaigns_list(uuid) IS
  'Kampanie reklamowe wydarzenia z podsumowaniem kosztow per waluta. Bramka: assert_event_admin_tenant().';

-- Zapis kampanii. Bez `id` = nowa (wymaga event_id, match_kind, match_value,
-- label); z `id` = zmiana (klucz pominiety zostaje, `conversion_action_name:
-- null` czysci).
CREATE OR REPLACE FUNCTION public.admin_event_ad_campaign_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_uuid_re text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_id uuid;
  v_event_id uuid;
  v_current public.event_ad_campaigns%ROWTYPE;
  v_kind text;
  v_value text;
  v_label text;
  v_conversion text;
  v_out uuid;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload: a payload object is required';
  END IF;
  IF NULLIF(p_payload->>'id', '') IS NOT NULL THEN
    IF p_payload->>'id' !~ v_uuid_re THEN
      RAISE EXCEPTION 'invalid_payload: id is not a uuid';
    END IF;
    v_id := (p_payload->>'id')::uuid;
    SELECT c.* INTO v_current
      FROM public.event_ad_campaigns c
     WHERE c.id = v_id AND c.tenant_id = v_tenant
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: campaign does not exist in this tenant';
    END IF;
    v_event_id := v_current.event_id;
  ELSE
    IF COALESCE(p_payload->>'event_id', '') !~ v_uuid_re THEN
      RAISE EXCEPTION 'invalid_payload: event_id is required';
    END IF;
    v_event_id := (p_payload->>'event_id')::uuid;
    IF NOT EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'not_found: event does not exist in this tenant';
    END IF;
  END IF;

  v_kind := CASE WHEN p_payload ? 'match_kind' THEN p_payload->>'match_kind' ELSE v_current.match_kind END;
  IF v_kind IS NULL OR v_kind NOT IN ('utm_campaign', 'google_ads_campaign_id') THEN
    RAISE EXCEPTION 'invalid_match_kind: %', COALESCE(v_kind, '<null>');
  END IF;

  v_value := CASE WHEN p_payload ? 'match_value' THEN p_payload->>'match_value' ELSE v_current.match_value END;
  IF v_kind = 'utm_campaign' THEN
    v_value := lower(public._event_ads_clean(v_value, 100));
  ELSE
    v_value := CASE WHEN btrim(COALESCE(v_value, '')) ~ '^[0-9]{1,20}$' THEN btrim(v_value) END;
  END IF;
  IF v_value IS NULL THEN
    RAISE EXCEPTION 'invalid_match_value: value does not fit the match kind';
  END IF;

  v_label := btrim(CASE WHEN p_payload ? 'label' THEN COALESCE(p_payload->>'label', '') ELSE v_current.label END);
  IF char_length(v_label) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid_label: label must have 1-120 characters';
  END IF;

  v_conversion := CASE
    WHEN p_payload ? 'conversion_action_name'
      THEN NULLIF(btrim(COALESCE(p_payload->>'conversion_action_name', '')), '')
    ELSE v_current.conversion_action_name
  END;
  IF v_conversion IS NOT NULL AND (
    char_length(v_conversion) > 100
    OR v_conversion !~ '^[^,"=+@[:cntrl:]-][^,"[:cntrl:]]*$'
  ) THEN
    RAISE EXCEPTION 'invalid_conversion_name: no commas, quotes or leading formula characters';
  END IF;

  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.event_ad_campaigns (
        tenant_id, event_id, match_kind, match_value, label, conversion_action_name, created_by
      ) VALUES (
        v_tenant, v_event_id, v_kind, v_value, v_label, v_conversion, auth.uid()
      )
      RETURNING id INTO v_out;
    ELSE
      UPDATE public.event_ad_campaigns c SET
        match_kind = v_kind,
        match_value = v_value,
        label = v_label,
        conversion_action_name = v_conversion
      WHERE c.id = v_id AND c.tenant_id = v_tenant
      RETURNING c.id INTO v_out;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'campaign_exists: this campaign is already mapped to the event';
  END;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ad_campaign_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ad_campaign_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ad_campaign_save(jsonb) IS
  'Zapis kampanii reklamowej wydarzenia (nowa bez id, zmiana z id - klucz pominiety zostaje). Dopasowanie utm_campaign (male litery) albo id kampanii Google Ads. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_ad_campaign_delete(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  DELETE FROM public.event_ad_campaigns c WHERE c.id = p_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: campaign does not exist in this tenant';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ad_campaign_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ad_campaign_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ad_campaign_delete(uuid) IS
  'Usuwa kampanie wydarzenia razem z jej kosztami (kaskada). Zgloszenia i kroki lejka zostaja - kampania przestaje je tylko grupowac. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 6) PANEL: KOSZTY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_ad_costs_list(p_campaign_id uuid)
RETURNS TABLE (
  day date,
  cost_micros bigint,
  currency text,
  clicks integer,
  impressions integer,
  source text,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_ad_campaigns c WHERE c.id = p_campaign_id AND c.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: campaign does not exist in this tenant';
  END IF;

  RETURN QUERY
  SELECT k.day, k.cost_micros, k.currency, k.clicks, k.impressions, k.source, k.updated_at
    FROM public.event_ad_campaign_costs k
   WHERE k.tenant_id = v_tenant AND k.campaign_id = p_campaign_id
   ORDER BY k.day DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ad_costs_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ad_costs_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ad_costs_list(uuid) IS
  'Koszty dzienne kampanii (od najnowszego dnia). Bramka: assert_event_admin_tenant().';

-- Zapis wsadowy kosztow: {campaign_id, source: manual|csv, rows: [{day,
-- cost_micros, currency, clicks?, impressions?}]}. Calosc albo nic - zly
-- wiersz odrzuca wsad z numerem wiersza (liczony od 1), a dzien juz zapisany
-- jest nadpisywany (ponowny import tego samego raportu nie dubluje kosztu).
CREATE OR REPLACE FUNCTION public.admin_event_ad_costs_save(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_campaign public.event_ad_campaigns%ROWTYPE;
  v_source text;
  v_rows jsonb;
  v_row jsonb;
  v_n integer := 0;
  v_day date;
  v_cost bigint;
  v_days date[] := '{}'::date[];
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR COALESCE(p_payload->>'campaign_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'invalid_payload: campaign_id is required';
  END IF;

  SELECT c.* INTO v_campaign
    FROM public.event_ad_campaigns c
   WHERE c.id = (p_payload->>'campaign_id')::uuid AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: campaign does not exist in this tenant';
  END IF;

  v_source := COALESCE(p_payload->>'source', 'manual');
  IF v_source NOT IN ('manual', 'csv') THEN
    RAISE EXCEPTION 'invalid_source: %', v_source;
  END IF;

  v_rows := p_payload->'rows';
  IF v_rows IS NULL OR jsonb_typeof(v_rows) <> 'array'
     OR jsonb_array_length(v_rows) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_rows: between 1 and 500 rows are required';
  END IF;

  FOR v_row IN SELECT r.value FROM jsonb_array_elements(v_rows) AS r(value) LOOP
    v_n := v_n + 1;
    IF jsonb_typeof(v_row) <> 'object'
       OR COALESCE(v_row->>'day', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR COALESCE(v_row->>'cost_micros', '') !~ '^[0-9]{1,16}$'
       OR COALESCE(v_row->>'currency', '') !~ '^[A-Z]{3}$'
       OR COALESCE(v_row->>'clicks', '0') !~ '^[0-9]{1,9}$'
       OR COALESCE(v_row->>'impressions', '0') !~ '^[0-9]{1,9}$' THEN
      RAISE EXCEPTION 'invalid_cost_row: row % is invalid', v_n;
    END IF;
    BEGIN
      v_day := (v_row->>'day')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_cost_row: row % is invalid', v_n;
    END;
    v_cost := (v_row->>'cost_micros')::bigint;
    IF v_day < DATE '2000-01-01' OR v_day > (now() + interval '1 day')::date
       OR v_cost > 1000000000000000 THEN
      RAISE EXCEPTION 'invalid_cost_row: row % is invalid', v_n;
    END IF;
    IF v_day = ANY (v_days) THEN
      RAISE EXCEPTION 'duplicate_cost_day: row % repeats a day', v_n;
    END IF;
    v_days := v_days || v_day;

    INSERT INTO public.event_ad_campaign_costs AS k (
      tenant_id, event_id, campaign_id, day, cost_micros, currency, clicks, impressions, source
    ) VALUES (
      v_tenant, v_campaign.event_id, v_campaign.id, v_day, v_cost, v_row->>'currency',
      (v_row->>'clicks')::integer, (v_row->>'impressions')::integer, v_source
    )
    ON CONFLICT (tenant_id, campaign_id, day) DO UPDATE SET
      cost_micros = EXCLUDED.cost_micros,
      currency = EXCLUDED.currency,
      clicks = EXCLUDED.clicks,
      impressions = EXCLUDED.impressions,
      source = EXCLUDED.source;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ad_costs_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ad_costs_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ad_costs_save(jsonb) IS
  'Zapis wsadowy kosztow dziennych kampanii (1-500 wierszy, calosc albo nic, dzien juz zapisany jest nadpisywany). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_ad_cost_delete(p_campaign_id uuid, p_day date)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  DELETE FROM public.event_ad_campaign_costs k
   WHERE k.tenant_id = v_tenant AND k.campaign_id = p_campaign_id AND k.day = p_day;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: cost row does not exist in this tenant';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ad_cost_delete(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ad_cost_delete(uuid, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ad_cost_delete(uuid, date) IS
  'Usuwa koszt jednego dnia kampanii. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 7) PANEL: RAPORT LEJKA
--
-- Okno [p_from, p_to) (NULL = bez granicy). Kroki lejka po `occurred_at`,
-- zgloszenia KOHORTA po dacie zapisu (ile z zapisanych w oknie zaplacilo do
-- dzis), koszt po dniu w strefie wydarzenia. Goscie grupy nie sa osobnymi
-- konwersjami (liczy sie zgloszenie prowadzacego), a przychod liczy sie per
-- ZAMOWIENIE (netto = kwota - zwroty), wiec zamowienie grupy nie dubluje sie.
--
-- Grupa: zmapowana kampania (etykieta) > utm_campaign > id kampanii Google Ads
-- > brak; w grupie rozbicie zrodlo/medium. Zgloszenia BEZ wiersza atrybucji
-- (brak zgody na pomiar albo zapis spoza przegladarki uczestnika: import,
-- zaproszenie, organizator) ida do osobnego `unattributed` - nigdy do
-- mianownika wizyt, ktore licza tylko przegladarki ze zgoda.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_ads_funnel(
  p_event_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_tz text;
  v_from_day date;
  v_to_day date;
  v_out jsonb;
BEGIN
  SELECT e.timezone INTO v_tz
    FROM public.events e
   WHERE e.id = p_event_id AND e.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from >= p_to THEN
    RAISE EXCEPTION 'invalid_window: from must be earlier than to';
  END IF;
  v_tz := CASE
    WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz) THEN v_tz
    ELSE 'Europe/Warsaw'
  END;
  v_from_day := (p_from AT TIME ZONE v_tz)::date;
  v_to_day := ((p_to - interval '1 microsecond') AT TIME ZONE v_tz)::date;

  WITH camps AS (
    SELECT c.id, c.label, c.match_kind, c.match_value
      FROM public.event_ad_campaigns c
     WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id
  ),
  touches AS (
    SELECT 'step'::text AS kind, f.step, f.visitor_key, NULL::uuid AS reg_id,
           NULL::text AS payment_status, NULL::uuid AS order_id,
           f.source, f.medium, f.utm_campaign, f.gad_campaign_id
      FROM public.event_funnel_events f
     WHERE f.tenant_id = v_tenant AND f.event_id = p_event_id
       AND (p_from IS NULL OR f.occurred_at >= p_from)
       AND (p_to IS NULL OR f.occurred_at < p_to)
    UNION ALL
    SELECT 'reg', NULL, NULL, r.id, r.payment_status, r.payment_order_id,
           a.source, a.medium, a.utm_campaign, a.gad_campaign_id
      FROM public.event_registrations r
      JOIN public.event_registration_attributions a
        ON a.tenant_id = r.tenant_id AND a.registration_id = r.id
     WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
       AND r.group_lead_registration_id IS NULL
       AND (p_from IS NULL OR r.created_at >= p_from)
       AND (p_to IS NULL OR r.created_at < p_to)
  ),
  keyed AS (
    SELECT t.*,
           CASE
             WHEN m.id IS NOT NULL THEN 'campaign:' || m.id::text
             WHEN t.utm_campaign IS NOT NULL THEN 'utm:' || lower(t.utm_campaign)
             WHEN t.gad_campaign_id IS NOT NULL THEN 'gad:' || t.gad_campaign_id
             ELSE 'none'
           END AS group_key
      FROM touches t
      LEFT JOIN LATERAL (
        SELECT c.id
          FROM camps c
         WHERE (c.match_kind = 'google_ads_campaign_id' AND c.match_value = t.gad_campaign_id)
            OR (c.match_kind = 'utm_campaign' AND c.match_value = lower(t.utm_campaign))
         ORDER BY (c.match_kind = 'google_ads_campaign_id') DESC, c.id
         LIMIT 1
      ) m ON true
  ),
  orders AS (
    SELECT DISTINCT ON (o.id)
           k.group_key, k.source, k.medium, o.currency,
           GREATEST(o.amount_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint AS net
      FROM keyed k
      JOIN public.payment_orders o ON o.id = k.order_id AND o.tenant_id = v_tenant
     WHERE k.kind = 'reg' AND k.payment_status IN ('paid', 'partially_refunded', 'refunded')
     ORDER BY o.id, k.reg_id
  ),
  grp AS (
    SELECT k.group_key,
           min(k.utm_campaign) AS utm_campaign,
           min(k.gad_campaign_id) AS gad_campaign_id,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'visit') AS visits,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'registration_start') AS starts,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'checkout_start') AS checkouts,
           count(*) FILTER (WHERE k.kind = 'reg') AS registrations,
           count(*) FILTER (WHERE k.kind = 'reg'
                              AND k.payment_status IN ('paid', 'partially_refunded')) AS paid
      FROM keyed k
     GROUP BY k.group_key
  ),
  chan AS (
    SELECT k.group_key, k.source, k.medium,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'visit') AS visits,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'registration_start') AS starts,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'checkout_start') AS checkouts,
           count(*) FILTER (WHERE k.kind = 'reg') AS registrations,
           count(*) FILTER (WHERE k.kind = 'reg'
                              AND k.payment_status IN ('paid', 'partially_refunded')) AS paid
      FROM keyed k
     GROUP BY k.group_key, k.source, k.medium
  ),
  cost AS (
    SELECT k.campaign_id, k.currency, sum(k.cost_micros)::bigint AS micros
      FROM public.event_ad_campaign_costs k
     WHERE k.tenant_id = v_tenant AND k.event_id = p_event_id
       AND (v_from_day IS NULL OR k.day >= v_from_day)
       AND (v_to_day IS NULL OR k.day <= v_to_day)
     GROUP BY k.campaign_id, k.currency
  ),
  group_keys AS (
    SELECT g.group_key FROM grp g
    UNION
    SELECT 'campaign:' || co.campaign_id::text FROM cost co
  ),
  unattr AS (
    SELECT r.id, r.payment_status, r.payment_order_id
      FROM public.event_registrations r
     WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
       AND r.group_lead_registration_id IS NULL
       AND (p_from IS NULL OR r.created_at >= p_from)
       AND (p_to IS NULL OR r.created_at < p_to)
       AND NOT EXISTS (
         SELECT 1 FROM public.event_registration_attributions a
          WHERE a.tenant_id = r.tenant_id AND a.registration_id = r.id
       )
  ),
  unattr_orders AS (
    SELECT DISTINCT ON (o.id) o.currency,
           GREATEST(o.amount_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint AS net
      FROM unattr u
      JOIN public.payment_orders o ON o.id = u.payment_order_id AND o.tenant_id = v_tenant
     WHERE u.payment_status IN ('paid', 'partially_refunded', 'refunded')
     ORDER BY o.id
  )
  SELECT jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', v_tz),
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'key', gk.group_key,
               'kind', CASE
                 WHEN gk.group_key LIKE 'campaign:%' THEN 'campaign'
                 WHEN gk.group_key LIKE 'utm:%' THEN 'utm_campaign'
                 WHEN gk.group_key LIKE 'gad:%' THEN 'gad_campaign'
                 ELSE 'none'
               END,
               'campaign_id', c.id,
               'label', c.label,
               'match_kind', c.match_kind,
               'match_value', c.match_value,
               'utm_campaign', g.utm_campaign,
               'gad_campaign_id', g.gad_campaign_id,
               'visits', COALESCE(g.visits, 0),
               'registration_starts', COALESCE(g.starts, 0),
               'checkout_starts', COALESCE(g.checkouts, 0),
               'registrations', COALESCE(g.registrations, 0),
               'paid', COALESCE(g.paid, 0),
               'revenue', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('currency', x.currency, 'cents', x.cents)
                                  ORDER BY x.currency)
                   FROM (
                     SELECT o.currency, sum(o.net)::bigint AS cents
                       FROM orders o WHERE o.group_key = gk.group_key
                      GROUP BY o.currency
                   ) x
               ), '[]'::jsonb),
               'cost', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('currency', co.currency, 'micros', co.micros)
                                  ORDER BY co.currency)
                   FROM cost co WHERE 'campaign:' || co.campaign_id::text = gk.group_key
               ), '[]'::jsonb),
               'channels', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'source', ch.source,
                          'medium', ch.medium,
                          'visits', ch.visits,
                          'registration_starts', ch.starts,
                          'checkout_starts', ch.checkouts,
                          'registrations', ch.registrations,
                          'paid', ch.paid,
                          'revenue', COALESCE((
                            SELECT jsonb_agg(jsonb_build_object('currency', y.currency, 'cents', y.cents)
                                             ORDER BY y.currency)
                              FROM (
                                SELECT o.currency, sum(o.net)::bigint AS cents
                                  FROM orders o
                                 WHERE o.group_key = ch.group_key
                                   AND o.source = ch.source AND o.medium = ch.medium
                                 GROUP BY o.currency
                              ) y
                          ), '[]'::jsonb)
                        ) ORDER BY ch.visits DESC, ch.registrations DESC, ch.source, ch.medium)
                   FROM chan ch WHERE ch.group_key = gk.group_key
               ), '[]'::jsonb)
             ) ORDER BY
               CASE
                 WHEN gk.group_key LIKE 'campaign:%' THEN 0
                 WHEN gk.group_key LIKE 'utm:%' THEN 1
                 WHEN gk.group_key LIKE 'gad:%' THEN 2
                 ELSE 3
               END,
               lower(COALESCE(c.label, g.utm_campaign, g.gad_campaign_id, '')),
               gk.group_key)
        FROM group_keys gk
        LEFT JOIN grp g ON g.group_key = gk.group_key
        LEFT JOIN camps c ON 'campaign:' || c.id::text = gk.group_key
    ), '[]'::jsonb),
    'unattributed', jsonb_build_object(
      'registrations', (SELECT count(*) FROM unattr),
      'paid', (SELECT count(*) FROM unattr u WHERE u.payment_status IN ('paid', 'partially_refunded')),
      'revenue', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', z.currency, 'cents', z.cents) ORDER BY z.currency)
          FROM (SELECT uo.currency, sum(uo.net)::bigint AS cents FROM unattr_orders uo GROUP BY uo.currency) z
      ), '[]'::jsonb)
    ),
    'totals', jsonb_build_object(
      'visits', (SELECT count(DISTINCT k.visitor_key) FROM keyed k WHERE k.step = 'visit'),
      'registration_starts', (SELECT count(DISTINCT k.visitor_key) FROM keyed k WHERE k.step = 'registration_start'),
      'checkout_starts', (SELECT count(DISTINCT k.visitor_key) FROM keyed k WHERE k.step = 'checkout_start'),
      'attributed_registrations', (SELECT count(*) FROM keyed k WHERE k.kind = 'reg'),
      'registrations', (SELECT count(*) FROM keyed k WHERE k.kind = 'reg') + (SELECT count(*) FROM unattr),
      'paid', (SELECT count(*) FROM keyed k
                WHERE k.kind = 'reg' AND k.payment_status IN ('paid', 'partially_refunded'))
              + (SELECT count(*) FROM unattr u WHERE u.payment_status IN ('paid', 'partially_refunded')),
      'revenue', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', w.currency, 'cents', w.cents) ORDER BY w.currency)
          FROM (
            SELECT v.currency, sum(v.net)::bigint AS cents
              FROM (SELECT o.currency, o.net FROM orders o
                    UNION ALL
                    SELECT uo.currency, uo.net FROM unattr_orders uo) v
             GROUP BY v.currency
          ) w
      ), '[]'::jsonb),
      'cost', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', q.currency, 'micros', q.micros) ORDER BY q.currency)
          FROM (SELECT co.currency, sum(co.micros)::bigint AS micros FROM cost co GROUP BY co.currency) q
      ), '[]'::jsonb)
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ads_funnel(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ads_funnel(uuid, timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ads_funnel(uuid, timestamptz, timestamptz) IS
  'Lejek sprzedazy wydarzenia per kampania (zmapowana > utm_campaign > id kampanii Google Ads > brak) z rozbiciem zrodlo/medium: wizyty, rozpoczecia zapisu i platnosci, zgloszenia (kohorta po dacie zapisu), oplacone, przychod netto per waluta (per zamowienie), koszt; osobno zgloszenia bez atrybucji i sumy. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 8) PANEL: EKSPORT KONWERSJI OFFLINE (Google Ads, import klikniec)
--
-- Tylko OPLACONE zgloszenia z identyfikatorem klikniecia zebranym przy zgodzie
-- reklamowej, klikniecie mlodsze niz 90 dni (termin importu Google Ads)
-- i platnosc PO kliknieciu. Czas konwersji w strefie wydarzenia (plik niesie
-- naglowek `Parameters:TimeZone=<strefa>`), wartosc netto zamowienia.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_ads_conversions_export(
  p_event_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_tz text;
  v_out jsonb;
BEGIN
  SELECT e.timezone INTO v_tz
    FROM public.events e
   WHERE e.id = p_event_id AND e.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from >= p_to THEN
    RAISE EXCEPTION 'invalid_window: from must be earlier than to';
  END IF;
  v_tz := CASE
    WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz) THEN v_tz
    ELSE 'Europe/Warsaw'
  END;

  WITH paid AS (
    SELECT DISTINCT ON (o.id)
           r.id AS registration_id, o.id AS order_id, o.currency,
           GREATEST(o.amount_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint AS net,
           COALESCE(o.paid_at, r.paid_at) AS converted_at,
           a.registration_id IS NOT NULL AS attributed,
           a.click_id_type, a.click_id, a.click_at, a.click_pruned_at,
           a.ad_user_data, a.ad_personalization, a.utm_campaign, a.gad_campaign_id
      FROM public.event_registrations r
      JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = v_tenant
      LEFT JOIN public.event_registration_attributions a
        ON a.tenant_id = r.tenant_id AND a.registration_id = r.id
     WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
       AND r.group_lead_registration_id IS NULL
       AND r.payment_status IN ('paid', 'partially_refunded')
       AND COALESCE(o.paid_at, r.paid_at) IS NOT NULL
       AND (p_from IS NULL OR COALESCE(o.paid_at, r.paid_at) >= p_from)
       AND (p_to IS NULL OR COALESCE(o.paid_at, r.paid_at) < p_to)
     ORDER BY o.id, r.created_at
  ),
  eligible AS (
    SELECT p.*,
           (SELECT c.conversion_action_name
              FROM public.event_ad_campaigns c
             WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id
               AND ((c.match_kind = 'google_ads_campaign_id' AND c.match_value = p.gad_campaign_id)
                 OR (c.match_kind = 'utm_campaign' AND c.match_value = lower(p.utm_campaign)))
             ORDER BY (c.match_kind = 'google_ads_campaign_id') DESC, c.id
             LIMIT 1) AS conversion_action_name
      FROM paid p
     WHERE p.click_id IS NOT NULL
       AND p.ad_user_data
       AND p.click_at > now() - interval '90 days'
       AND p.converted_at >= p.click_at
  )
  SELECT jsonb_build_object(
    'timezone', v_tz,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'order_id', e.order_id,
               'registration_id', e.registration_id,
               'click_id_type', e.click_id_type,
               'click_id', e.click_id,
               'conversion_action_name', e.conversion_action_name,
               'conversion_time', e.converted_at,
               'conversion_time_local', to_char(e.converted_at AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI:SS'),
               'value_cents', e.net,
               'currency', e.currency,
               'ad_user_data', e.ad_user_data,
               'ad_personalization', e.ad_personalization
             ) ORDER BY e.converted_at, e.order_id)
        FROM eligible e
    ), '[]'::jsonb),
    'skipped', jsonb_build_object(
      'unattributed', (SELECT count(*) FROM paid p WHERE NOT p.attributed),
      'no_click', (SELECT count(*) FROM paid p
                    WHERE p.attributed AND p.click_id IS NULL AND p.click_pruned_at IS NULL),
      'expired', (SELECT count(*) FROM paid p
                   WHERE p.click_pruned_at IS NOT NULL
                      OR (p.click_id IS NOT NULL AND p.click_at <= now() - interval '90 days')),
      'before_click', (SELECT count(*) FROM paid p
                        WHERE p.click_id IS NOT NULL AND p.click_at > now() - interval '90 days'
                          AND p.converted_at < p.click_at)
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ads_conversions_export(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ads_conversions_export(uuid, timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ads_conversions_export(uuid, timestamptz, timestamptz) IS
  'Wiersze do importu konwersji offline Google Ads (klikniecia): oplacone zgloszenia z identyfikatorem klikniecia przy zgodzie reklamowej, klikniecie mlodsze niz 90 dni, platnosc po kliknieciu; czas w strefie wydarzenia, wartosc netto zamowienia, nazwa konwersji z kampanii; plus liczniki pominietych. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 9) RETENCJA
--
-- Identyfikator klikniecia jest potrzebny tylko do importu (maks. 90 dni od
-- klikniecia) - po 120 dniach go zerujemy w obu tabelach (dotkniecia w
-- atrybucji tracza klucze klikniecia). Surowe kroki lejka (pseudonimowe)
-- kasujemy po 400 dniach (13 miesiecy raportowania + zapas).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_ads_retention_prune()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clicks_attr integer;
  v_clicks_steps integer;
  v_steps integer;
BEGIN
  UPDATE public.event_registration_attributions a SET
    click_id = NULL,
    click_id_type = NULL,
    click_at = NULL,
    click_pruned_at = now(),
    first_touch = CASE WHEN a.first_touch IS NULL THEN NULL
                       ELSE a.first_touch - 'click_id' - 'click_id_type' END,
    last_touch = CASE WHEN a.last_touch IS NULL THEN NULL
                      ELSE a.last_touch - 'click_id' - 'click_id_type' END
  WHERE a.click_id IS NOT NULL AND a.created_at < now() - interval '120 days';
  GET DIAGNOSTICS v_clicks_attr = ROW_COUNT;

  UPDATE public.event_funnel_events f SET
    click_id = NULL,
    click_id_type = NULL
  WHERE f.click_id IS NOT NULL AND f.occurred_at < now() - interval '120 days';
  GET DIAGNOSTICS v_clicks_steps = ROW_COUNT;

  DELETE FROM public.event_funnel_events f WHERE f.occurred_at < now() - interval '400 days';
  GET DIAGNOSTICS v_steps = ROW_COUNT;

  RETURN jsonb_build_object(
    'attribution_clicks_cleared', v_clicks_attr,
    'funnel_clicks_cleared', v_clicks_steps,
    'funnel_steps_deleted', v_steps
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_ads_retention_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_ads_retention_prune() TO service_role;

COMMENT ON FUNCTION public.event_ads_retention_prune() IS
  'Retencja lejka reklam: identyfikatory klikniec zerowane po 120 dniach (atrybucje i kroki lejka), kroki lejka kasowane po 400 dniach. Codziennie z pg_cron (event-ads-retention-prune, 03:47 UTC), gdy rozszerzenie jest dostepne; inaczej na zadanie (service_role).';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('event-ads-retention-prune', '47 3 * * *',
      'SELECT public.event_ads_retention_prune()');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - event ads retention runs only on demand';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;
