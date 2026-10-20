-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9c-X2, 1/5): RETENCJA DANYCH - USTAWIENIA
-- NAJEMCY, DZIENNIK PRZEBIEGÓW, ANONIMOWE AGREGATY DZIENNE I PIECZĘTOWANIE
-- STATYSTYK. Polecenie właściciela 2026-10-20 (Z-I9b-10): „tak, zaproponuj
-- zgodnie z polskim i europejskim prawem oraz rynkowymi standardami".
--
-- DEFEKT
--   1. Z-I9b-10: dane żywych kont i kontaktów nie mają okresu przechowywania
--      w repozytorium - `paywall_hits`, `metering_event_log`, zdarzenia maili
--      (`journey_message_events`, `newsletter_campaign_events`),
--      `email_send_log`, kontakty CRM bez źródła poza kontem, `audit_log`,
--      zapisy na ścieżki po wyjściu i ankiety rezygnacji rosną bez końca.
--      Zasada ograniczenia przechowywania (RODO art. 5 ust. 1 lit. e) nie ma
--      mechanizmu, a rejestr czynności mówi „nieustalona".
--   2. Usunięcie surowych wierszy bez agregatów zgubiłoby historię
--      wskaźników: lejek liczy konta z `paywall_hits` w zapytaniu
--      (`_funnel_counts`), pulpit monetyzacji - zdarzenia licznika
--      z `metering_event_log`, zaangażowanie kampanii - zdarzenia
--      `newsletter_campaign_events`, a statystyki ścieżek mają rollup
--      (`journey_node_daily_stats`), którego nikt jeszcze nie woła
--      (`journey_rollup_daily` czeka na podpięcie w I9).
--
-- ZMIANA (ta migracja: dane i pieczęcie; wykonanie - 161100, odczyty - 161200,
-- piksel otwarć - 161300, panel - 161400)
--   A. `data_retention_settings` - okres (miesiące), włączenie, termin
--      włączenia usuwania (`enforce_after`), kto i kiedy zmienił; wiersz na
--      (najemca, kategoria). CHECK zakresów per kategoria = lustro
--      `DATA_RETENTION_PERIODS` (src/lib/privacy/dataRetention.ts).
--      Kategorie ustawowe (`crm_customers`, `consent_log`) mają wiersz tylko
--      dla terminu włączenia - bez okresu i zawsze włączone.
--   B. `data_retention_runs` - dziennik przebiegów: kategoria, tryb
--      (podgląd/wykonanie), źródło (harmonogram/ręcznie), próg, liczba
--      wierszy, zaległość, kod błędu. BEZ danych osobowych i bez aktora
--      (ręczne uruchomienie trafia do `audit_log`).
--   C. `data_retention_state` - pieczęcie: do jakiego dnia agregaty lejka
--      i statystyki ścieżek są policzone (`sealed_through`) i poniżej jakiego
--      dnia surowe wiersze mogły już zniknąć (`purged_before`).
--   D. `data_retention_crm_extensions` - przedłużenie kontaktu CRM z listy
--      „do anonimizacji" (+12 mies., powód 3-500 znaków, autor).
--   E. Agregaty anonimowe: `funnel_paywall_daily` (wynik `_funnel_counts`
--      dla okna jednodniowego - konta aktywne, konta i goście z uderzeniem,
--      uderzenia, konwersje per segment, powody), `metering_events_daily`
--      (zdarzenia licznika per wynik), `newsletter_campaign_engagement_archive`
--      (otwarcia, kliknięcia i zasięg unikalny zdarzeń zarchiwizowanych).
--   F. Kolumny: `crm_leads.anonymized_at`, `retention_feedback.user_id`
--      NULL-owalne (anonimizacja ankiety), `journey_settings.
--      open_tracking_enabled` (piksel otwarć, domyślnie WŁĄCZONY - bez zmiany
--      dzisiejszego działania).
--   G. `_data_retention_catalog()` (lustro TS), `_data_retention_effective`
--      (ustawienia z domyślnymi), `_data_retention_funnel_cut` (granica
--      odczytu lejka z agregatu), pieczęcie `_data_retention_seal_funnel`
--      i `_data_retention_seal_journeys`, rollup ścieżek dla dowolnego zakresu
--      dni `_journey_rollup_days` i `journey_rollup_daily()` na nim
--      (CIALO-Z niżej).
--   H. Wiersze ustawień istniejących najemców: `enforce_after = now() + 14
--      dni` - BEZPIECZNY START (zadanie przez 14 dni tylko liczy).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020160900 (I9c-X1). Kolejne pliki X2
-- (161100-161400) wymagają tego. Kod panelu woła RPC z 161400; bez nich
-- karta pokazuje „źródło jeszcze niewdrożone".
-- IDEMPOTENTNA: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- DROP NOT NULL (powtórka - no-op), CREATE OR REPLACE FUNCTION, bezstanowe
-- REVOKE/GRANT, seed `ON CONFLICT DO NOTHING`.
-- DOWÓD: supabase/tests/hub_i9c_data_retention_test.sql,
-- supabase/tests/hub_i9c_data_retention_aggregates_test.sql,
-- src/lib/privacy/__tests__/dataRetentionParity.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A-D) Ustawienia, dziennik, pieczęcie, przedłużenia.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.data_retention_settings (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category text NOT NULL,
  period_months smallint,
  enabled boolean NOT NULL DEFAULT true,
  enforce_after timestamptz NOT NULL,
  -- Klucz obcy z SET NULL: usunięcie konta personelu nie zostawia uid
  -- (przegląd kolumn autora, I9c-X1, asercja 29 testu przeglądu).
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, category),
  CONSTRAINT data_retention_settings_category_check CHECK (category IN (
    'paywall_metering', 'email_engagement', 'email_send_log', 'crm_inactive_contacts',
    'audit_log', 'journey_enrollments', 'cancellation_surveys', 'crm_customers', 'consent_log')),
  -- Zakres per kategoria = DATA_RETENTION_PERIODS (TS). Kategoria ustawowa
  -- nie ma okresu i nie da się jej wyłączyć (minimum ustawowe).
  CONSTRAINT data_retention_settings_period_check CHECK (CASE category
    WHEN 'paywall_metering' THEN period_months IS NOT NULL AND period_months BETWEEN 3 AND 25
    WHEN 'email_engagement' THEN period_months IS NOT NULL AND period_months BETWEEN 3 AND 25
    WHEN 'email_send_log' THEN period_months IS NOT NULL AND period_months BETWEEN 6 AND 25
    WHEN 'crm_inactive_contacts' THEN period_months IS NOT NULL AND period_months BETWEEN 12 AND 36
    WHEN 'audit_log' THEN period_months IS NOT NULL AND period_months BETWEEN 12 AND 60
    WHEN 'journey_enrollments' THEN period_months IS NOT NULL AND period_months BETWEEN 6 AND 25
    WHEN 'cancellation_surveys' THEN period_months IS NOT NULL AND period_months BETWEEN 12 AND 36
    WHEN 'crm_customers' THEN period_months IS NULL AND enabled
    WHEN 'consent_log' THEN period_months IS NULL AND enabled
    ELSE false END)
);

CREATE TABLE IF NOT EXISTS public.data_retention_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'paywall_metering', 'email_engagement', 'email_send_log', 'crm_inactive_contacts',
    'audit_log', 'journey_enrollments', 'cancellation_surveys', 'crm_customers', 'consent_log')),
  mode text NOT NULL CHECK (mode IN ('preview', 'execute')),
  run_trigger text NOT NULL CHECK (run_trigger IN ('schedule', 'manual')),
  cutoff timestamptz,
  affected integer NOT NULL DEFAULT 0 CHECK (affected >= 0),
  backlog boolean NOT NULL DEFAULT false,
  -- Wyłącznie SQLSTATE albo kod - nigdy tekst błędu (mógłby cytować dane).
  error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 64),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS data_retention_runs_tenant_idx
  ON public.data_retention_runs (tenant_id, category, started_at DESC);

CREATE TABLE IF NOT EXISTS public.data_retention_state (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('funnel', 'journey_stats')),
  sealed_through date,
  purged_before date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope)
);

-- FK do `crm_leads` bierze SHARE ROW EXCLUSIVE na tabeli leadów (konflikt
-- z każdym zapisem formularza) - bez limitu CREATE czekałby za długim
-- importem, a za nim cała kolejka zapisów.
SET lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS public.data_retention_crm_extensions (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  extended_until timestamptz NOT NULL,
  -- Limit = DATA_RETENTION_RULES.crmExtensionReason* (TS); dłuższy powód
  -- RPC odrzuca, nie skraca.
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, lead_id),
  CONSTRAINT data_retention_crm_extensions_lead_fkey
    FOREIGN KEY (tenant_id, lead_id) REFERENCES public.crm_leads(tenant_id, id) ON DELETE CASCADE
);

-- ----------------------------------------------------------------------------
-- E) Agregaty anonimowe (bez identyfikatorów osób).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funnel_paywall_daily (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  day date NOT NULL,
  active_accounts integer NOT NULL DEFAULT 0 CHECK (active_accounts >= 0),
  paywall_hit_accounts integer NOT NULL DEFAULT 0 CHECK (paywall_hit_accounts >= 0),
  paywall_hit_visitors integer NOT NULL DEFAULT 0 CHECK (paywall_hit_visitors >= 0),
  paywall_hits bigint NOT NULL DEFAULT 0 CHECK (paywall_hits >= 0),
  -- {segment: konta z konwersją tego dnia} - segment zawęża tylko zakupy.
  converted jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{reason, accounts, visitors, hits}] - kształt `paywall_reasons`.
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day)
);

CREATE TABLE IF NOT EXISTS public.metering_events_daily (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  day date NOT NULL,
  outcome text NOT NULL,
  events integer NOT NULL CHECK (events >= 0),
  PRIMARY KEY (tenant_id, day, outcome)
);

CREATE TABLE IF NOT EXISTS public.newsletter_campaign_engagement_archive (
  campaign_id uuid PRIMARY KEY REFERENCES public.newsletter_campaigns(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  opens bigint NOT NULL DEFAULT 0 CHECK (opens >= 0),
  clicks bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  unique_openers bigint NOT NULL DEFAULT 0 CHECK (unique_openers >= 0),
  unique_clickers bigint NOT NULL DEFAULT 0 CHECK (unique_clickers >= 0),
  archived_before timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS newsletter_campaign_engagement_archive_tenant_idx
  ON public.newsletter_campaign_engagement_archive (tenant_id);

-- ----------------------------------------------------------------------------
-- F) Kolumny tabel modułów (gorące tabele - limit blokady wyżej).
-- ----------------------------------------------------------------------------
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;
ALTER TABLE public.retention_feedback ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.journey_settings
  ADD COLUMN IF NOT EXISTS open_tracking_enabled boolean NOT NULL DEFAULT true;
RESET lock_timeout;

COMMENT ON COLUMN public.crm_leads.anonymized_at IS
  'Retencja danych (I9c-X2): chwila anonimizacji kontaktu - dane osobowe usunięte, etap, źródło i daty zostają.';
COMMENT ON COLUMN public.journey_settings.open_tracking_enabled IS
  'Pomiar otwarć maili ścieżek pikselem (I9c-X2). Domyślnie włączony (zachowanie sprzed X2); wyłączony = nowe maile bez piksela, otwarcia nie są zapisywane.';

-- RLS i ACL: tabele czytają i piszą wyłącznie funkcje SECURITY DEFINER
-- (panel przez RPC, zadanie przez service_role). Domyślne uprawnienia
-- Supabase dają nowej tabeli komplet dla anon i authenticated - REVOKE jest
-- konieczny.
ALTER TABLE public.data_retention_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_retention_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_retention_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_retention_crm_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_paywall_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metering_events_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_campaign_engagement_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_retention_settings, public.data_retention_runs, public.data_retention_state,
  public.data_retention_crm_extensions, public.funnel_paywall_daily, public.metering_events_daily,
  public.newsletter_campaign_engagement_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_retention_settings, public.data_retention_runs,
  public.data_retention_state, public.data_retention_crm_extensions, public.funnel_paywall_daily,
  public.metering_events_daily, public.newsletter_campaign_engagement_archive TO service_role;

-- ----------------------------------------------------------------------------
-- G) Katalog i ustawienia efektywne.
-- ----------------------------------------------------------------------------
-- Lustro `DATA_RETENTION_PERIODS` / `DATA_RETENTION_RULES` (TS). Kolejność
-- = kolejność wierszy karty w panelu.
CREATE OR REPLACE FUNCTION public._data_retention_catalog()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'categories', jsonb_build_array(
      jsonb_build_object('key', 'paywall_metering', 'default', 13, 'min', 3, 'max', 25, 'editable', true),
      jsonb_build_object('key', 'email_engagement', 'default', 13, 'min', 3, 'max', 25, 'editable', true),
      jsonb_build_object('key', 'email_send_log', 'default', 13, 'min', 6, 'max', 25, 'editable', true),
      jsonb_build_object('key', 'crm_inactive_contacts', 'default', 24, 'min', 12, 'max', 36, 'editable', true),
      jsonb_build_object('key', 'audit_log', 'default', 24, 'min', 12, 'max', 60, 'editable', true),
      jsonb_build_object('key', 'journey_enrollments', 'default', 13, 'min', 6, 'max', 25, 'editable', true),
      jsonb_build_object('key', 'cancellation_surveys', 'default', 24, 'min', 12, 'max', 36, 'editable', true),
      jsonb_build_object('key', 'crm_customers', 'default', NULL, 'min', NULL, 'max', NULL, 'editable', false),
      jsonb_build_object('key', 'consent_log', 'default', NULL, 'min', NULL, 'max', NULL, 'editable', false)),
    'rules', jsonb_build_object(
      'audit_network_months', 12, 'consent_proof_years', 6, 'claims_limitation_years', 6,
      'grace_days', 14, 'postpone_max_days', 90, 'crm_extension_months', 12, 'crm_notice_days', 30,
      'crm_extension_reason_min', 3, 'crm_extension_reason_max', 500,
      'batch_default', 5000, 'batch_max', 50000))
$$;
REVOKE ALL ON FUNCTION public._data_retention_catalog() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._data_retention_catalog() IS
  'Retencja danych (I9c-X2): kategorie (okres domyślny, zakres, edytowalność) i reguły stałe - lustro src/lib/privacy/dataRetention.ts (parytet dataRetentionParity.test.ts). Wewnętrzna.';

-- Ustawienia najemcy z domyślnymi: brak wiersza = okres domyślny, włączona,
-- termin włączenia usuwania = założenie najemcy + 14 dni (nowy najemca też
-- ma bezpieczny start). `cutoff` - granica wieku dla kategorii z okresem.
CREATE OR REPLACE FUNCTION public._data_retention_effective(p_tenant uuid)
RETURNS TABLE (
  category text,
  editable boolean,
  period_months integer,
  enabled boolean,
  enforce_after timestamptz,
  enforced boolean,
  cutoff timestamptz,
  updated_at timestamptz,
  updated_by uuid,
  stored boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.key,
         c.editable,
         COALESCE(s.period_months::integer, c.dflt),
         COALESCE(s.enabled, true),
         COALESCE(s.enforce_after, t.created_at + make_interval(days => 14)),
         now() >= COALESCE(s.enforce_after, t.created_at + make_interval(days => 14)),
         CASE WHEN c.editable THEN now() - make_interval(months => COALESCE(s.period_months::integer, c.dflt)) END,
         s.updated_at,
         s.updated_by,
         s.tenant_id IS NOT NULL
    FROM (
      SELECT x.item ->> 'key' AS key,
             (x.item ->> 'default')::integer AS dflt,
             (x.item ->> 'editable')::boolean AS editable,
             x.ord
        FROM jsonb_array_elements(public._data_retention_catalog() -> 'categories') WITH ORDINALITY AS x(item, ord)
    ) c
    JOIN public.tenants t ON t.id = p_tenant
    LEFT JOIN public.data_retention_settings s ON s.tenant_id = p_tenant AND s.category = c.key
   ORDER BY c.ord
$$;
REVOKE ALL ON FUNCTION public._data_retention_effective(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Granica odczytu lejka i pulpitu monetyzacji z agregatu: dni < granica
-- czytane z `funnel_paywall_daily` / `metering_events_daily`, dni >= granica -
-- z wierszy surowych. Granica = późniejsza z (próg okresu, dzień, poniżej
-- którego wiersze już usunięto), ale nigdy dalej niż dzień po ostatnim
-- zapieczętowanym - dzień bez agregatu czyta się zawsze z surowych.
-- NULL = brak pieczęci (wszystko surowe). Najemca jest ARGUMENTEM, bo woła ją
-- funkcja, która już rozstrzygnęła najemcę z sesji (`_funnel_counts`,
-- `monetization_dashboard`); bez EXECUTE dla ról API.
CREATE OR REPLACE FUNCTION public._data_retention_funnel_cut(p_tenant uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN st.sealed_through IS NULL THEN NULL
              ELSE LEAST(st.sealed_through + 1,
                         GREATEST(COALESCE(st.purged_before, '-infinity'::date),
                                  (e.cutoff AT TIME ZONE 'UTC')::date)) END
    FROM public.data_retention_state st
    JOIN public._data_retention_effective(p_tenant) e ON e.category = 'paywall_metering'
   WHERE st.tenant_id = p_tenant AND st.scope = 'funnel'
$$;
REVOKE ALL ON FUNCTION public._data_retention_funnel_cut(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Ostatni zapieczętowany dzień statystyk ścieżek (NULL = brak pieczęci).
CREATE OR REPLACE FUNCTION public._data_retention_journey_sealed(p_tenant uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT st.sealed_through FROM public.data_retention_state st
   WHERE st.tenant_id = p_tenant AND st.scope = 'journey_stats'
$$;
REVOKE ALL ON FUNCTION public._data_retention_journey_sealed(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- G2) Pieczęć lejka: agregat dzienny ZANIM znikną surowe wiersze.
-- ----------------------------------------------------------------------------
-- Dzień d = wynik `_funnel_counts` dla okna [d, d+1) - ta sama definicja co
-- okno w panelu, tylko jednodniowa (konta aktywne, konta i goście z
-- uderzeniem, uderzenia, powody; konwersje per segment, bo segment zawęża
-- wyłącznie zakupy). Dni starsze niż okres sumują się z tych wierszy, więc
-- okno sprzed progu daje ten sam wynik przed czyszczeniem i po nim. Konto
-- obecne w kilku dniach liczy się raz na dzień - bez identyfikatora nie da
-- się go odróżnić między dniami (opis w dzienniku wdrożenia §21.21).
-- `p_max_days` ogranicza pracę jednego przebiegu (reszta - następnej nocy).
CREATE OR REPLACE FUNCTION public._data_retention_seal_funnel(
  p_tenant uuid,
  p_until date,
  p_max_days integer DEFAULT 31
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_segments constant text[] := ARRAY['b2c_individual', 'b2c_reduced', 'b2b_institution'];
  v_sealed date;
  v_first date;
  v_day date;
  v_stop date;
  v_counts jsonb;
  v_converted jsonb;
  v_seg text;
  v_days integer := 0;
BEGIN
  IF p_tenant IS NULL OR p_until IS NULL THEN
    RETURN jsonb_build_object('sealed_through', NULL, 'days', 0, 'complete', false);
  END IF;
  -- Jeden pieczętujący na najemcę naraz (przebieg nocny i „uruchom teraz").
  PERFORM pg_advisory_xact_lock(hashtextextended('data_retention_seal_funnel:' || p_tenant::text, 0));
  SELECT st.sealed_through INTO v_sealed FROM public.data_retention_state st
   WHERE st.tenant_id = p_tenant AND st.scope = 'funnel';
  IF v_sealed IS NOT NULL AND v_sealed >= p_until - 1 THEN
    RETURN jsonb_build_object('sealed_through', v_sealed, 'days', 0, 'complete', true);
  END IF;
  IF v_sealed IS NULL THEN
    SELECT LEAST(
             (SELECT min(ph.day) FROM public.paywall_hits ph WHERE ph.tenant_id = p_tenant),
             (SELECT min((ml.occurred_at AT TIME ZONE 'UTC')::date) FROM public.metering_event_log ml
               WHERE ml.tenant_id = p_tenant))
      INTO v_first;
    v_day := COALESCE(LEAST(v_first, p_until), p_until);
  ELSE
    v_day := v_sealed + 1;
  END IF;
  v_stop := LEAST(p_until, v_day + GREATEST(COALESCE(p_max_days, 31), 1));

  WHILE v_day < v_stop LOOP
    v_counts := public._funnel_counts(p_tenant, v_day::timestamp AT TIME ZONE 'UTC',
                                      (v_day + 1)::timestamp AT TIME ZONE 'UTC', 'all');
    v_converted := jsonb_build_object('all', COALESCE((v_counts ->> 'paywall_converted_accounts')::integer, 0));
    FOREACH v_seg IN ARRAY c_segments LOOP
      v_converted := v_converted || jsonb_build_object(v_seg, COALESCE((public._funnel_counts(
        p_tenant, v_day::timestamp AT TIME ZONE 'UTC', (v_day + 1)::timestamp AT TIME ZONE 'UTC', v_seg)
        ->> 'paywall_converted_accounts')::integer, 0));
    END LOOP;
    INSERT INTO public.funnel_paywall_daily AS f (
      tenant_id, day, active_accounts, paywall_hit_accounts, paywall_hit_visitors, paywall_hits,
      converted, reasons, computed_at
    ) VALUES (
      p_tenant, v_day,
      COALESCE((v_counts ->> 'active_accounts')::integer, 0),
      COALESCE((v_counts ->> 'paywall_hit_accounts')::integer, 0),
      COALESCE((v_counts ->> 'paywall_hit_visitors')::integer, 0),
      COALESCE((v_counts ->> 'paywall_hits')::bigint, 0),
      v_converted,
      COALESCE(v_counts -> 'paywall_reasons', '[]'::jsonb),
      now()
    )
    ON CONFLICT (tenant_id, day) DO UPDATE
       SET active_accounts = EXCLUDED.active_accounts, paywall_hit_accounts = EXCLUDED.paywall_hit_accounts,
           paywall_hit_visitors = EXCLUDED.paywall_hit_visitors, paywall_hits = EXCLUDED.paywall_hits,
           converted = EXCLUDED.converted, reasons = EXCLUDED.reasons, computed_at = EXCLUDED.computed_at;

    INSERT INTO public.metering_events_daily AS m (tenant_id, day, outcome, events)
    SELECT p_tenant, v_day, ml.outcome, count(*)::integer
      FROM public.metering_event_log ml
     WHERE ml.tenant_id = p_tenant
       AND ml.occurred_at >= v_day::timestamp AT TIME ZONE 'UTC'
       AND ml.occurred_at < (v_day + 1)::timestamp AT TIME ZONE 'UTC'
     GROUP BY ml.outcome
    ON CONFLICT (tenant_id, day, outcome) DO UPDATE SET events = EXCLUDED.events;

    v_days := v_days + 1;
    v_day := v_day + 1;
  END LOOP;

  v_sealed := v_stop - 1;
  INSERT INTO public.data_retention_state AS st (tenant_id, scope, sealed_through, updated_at)
  VALUES (p_tenant, 'funnel', v_sealed, now())
  ON CONFLICT (tenant_id, scope) DO UPDATE
     SET sealed_through = GREATEST(COALESCE(st.sealed_through, EXCLUDED.sealed_through), EXCLUDED.sealed_through),
         updated_at = now();
  RETURN jsonb_build_object('sealed_through', v_sealed, 'days', v_days, 'complete', v_stop >= p_until);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_seal_funnel(uuid, date, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- G3) Rollup ścieżek dla zakresu dni + pieczęć.
-- ----------------------------------------------------------------------------
-- Ciało `journey_rollup_daily` z 20261020140500, uogólnione na zakres dni
-- i najemcę (NULL = wszyscy). Dzień zapieczętowany (<= `sealed_through`
-- najemcy) NIE jest liczony ponownie: po pieczęci surowe wiersze mogą
-- zniknąć, a ponowny upsert nadpisałby pełny wynik mniejszym.
CREATE OR REPLACE FUNCTION public._journey_rollup_days(p_tenant uuid, p_from date, p_until date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_from IS NULL OR p_until IS NULL OR p_until <= p_from THEN
    RETURN 0;
  END IF;
  WITH runs AS (
    SELECT sr.tenant_id, sr.journey_id, sr.version_id, sr.node_id, sr.enrollment_id, sr.status,
           (sr.started_at AT TIME ZONE 'UTC')::date AS day
      FROM public.journey_step_runs sr
      JOIN public.journey_enrollments e ON e.id = sr.enrollment_id AND NOT e.is_test
     WHERE (p_tenant IS NULL OR sr.tenant_id = p_tenant)
       AND sr.started_at >= p_from::timestamp AT TIME ZONE 'UTC'
       AND sr.started_at < p_until::timestamp AT TIME ZONE 'UTC'
       AND NOT EXISTS (
         SELECT 1 FROM public.data_retention_state st
          WHERE st.tenant_id = sr.tenant_id AND st.scope = 'journey_stats'
            AND st.sealed_through >= (sr.started_at AT TIME ZONE 'UTC')::date)
  ),
  agg AS (
    SELECT r.tenant_id, r.journey_id, r.version_id, r.node_id, r.day,
           count(*) AS entered,
           count(*) FILTER (WHERE r.status = 'succeeded') AS succeeded,
           count(*) FILTER (WHERE r.status = 'skipped') AS skipped,
           count(*) FILTER (WHERE r.status = 'failed') AS failed,
           count(*) FILTER (WHERE r.status = 'dead') AS dead,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.email_send_log l ON l.message_id = m.message_id AND l.status = 'sent'
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id)) AS sent,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.email_send_log l ON l.message_id = m.message_id
             JOIN public.email_delivery_events de ON de.provider_message_id = l.provider_message_id
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id AND de.kind = 'bounced')) AS bounced,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.email_send_log l ON l.message_id = m.message_id
             JOIN public.email_delivery_events de ON de.provider_message_id = l.provider_message_id
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id AND de.kind = 'complained')) AS complained,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'open'
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id)) AS opens,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'open' AND NOT me.machine
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id)) AS human_opens,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'click'
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id)) AS clicks,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'unsubscribe'
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id)) AS unsubs,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_enrollments e2
             WHERE e2.id = r.enrollment_id AND e2.status = 'goal_reached')) AS goals
      FROM runs r
     GROUP BY r.tenant_id, r.journey_id, r.version_id, r.node_id, r.day
  )
  INSERT INTO public.journey_node_daily_stats AS s (
    tenant_id, journey_id, version_id, node_id, variant, day, entered, succeeded, skipped, failed, dead,
    emails_sent, emails_bounced, emails_complained, unique_opens, unique_human_opens, unique_clicks,
    unsubscribes, goal_reached
  )
  SELECT a.tenant_id, a.journey_id, a.version_id, a.node_id, '-', a.day, a.entered, a.succeeded, a.skipped,
         a.failed, a.dead, a.sent, a.bounced, a.complained, a.opens, a.human_opens, a.clicks, a.unsubs, a.goals
    FROM agg a
  ON CONFLICT (journey_id, version_id, node_id, variant, day) DO UPDATE
     SET entered = EXCLUDED.entered, succeeded = EXCLUDED.succeeded, skipped = EXCLUDED.skipped,
         failed = EXCLUDED.failed, dead = EXCLUDED.dead, emails_sent = EXCLUDED.emails_sent,
         emails_bounced = EXCLUDED.emails_bounced, emails_complained = EXCLUDED.emails_complained,
         unique_opens = EXCLUDED.unique_opens, unique_human_opens = EXCLUDED.unique_human_opens,
         unique_clicks = EXCLUDED.unique_clicks, unsubscribes = EXCLUDED.unsubscribes,
         goal_reached = EXCLUDED.goal_reached;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public._journey_rollup_days(uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;

-- Ta sama funkcja harmonogramu co dotąd: dni zamknięte (UTC), 7 dni wstecz,
-- wszyscy najemcy; ciało liczy wspólny `_journey_rollup_days` (bez dni
-- zapieczętowanych przez retencję).
-- CIALO-Z: 20261020140500
CREATE OR REPLACE FUNCTION public.journey_rollup_daily()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._journey_rollup_days(NULL, (now() AT TIME ZONE 'UTC')::date - 7, (now() AT TIME ZONE 'UTC')::date);
END;
$$;
REVOKE ALL ON FUNCTION public.journey_rollup_daily() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_rollup_daily() TO service_role;

-- Pieczęć statystyk ścieżek: dni (pieczęć, p_until) liczone RAZ, potem
-- nietykalne. Woła ją każda kategoria, która usuwa albo redaguje dane, z
-- których liczy się rollup (zdarzenia maili, zapisy, dziennik wysyłek).
CREATE OR REPLACE FUNCTION public._data_retention_seal_journeys(
  p_tenant uuid,
  p_until date,
  p_max_days integer DEFAULT 62
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sealed date;
  v_from date;
  v_stop date;
  v_rows integer;
BEGIN
  IF p_tenant IS NULL OR p_until IS NULL THEN
    RETURN jsonb_build_object('sealed_through', NULL, 'rows', 0, 'complete', false);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('data_retention_seal_journeys:' || p_tenant::text, 0));
  v_sealed := public._data_retention_journey_sealed(p_tenant);
  IF v_sealed IS NOT NULL AND v_sealed >= p_until - 1 THEN
    RETURN jsonb_build_object('sealed_through', v_sealed, 'rows', 0, 'complete', true);
  END IF;
  IF v_sealed IS NULL THEN
    SELECT min((sr.started_at AT TIME ZONE 'UTC')::date) INTO v_from
      FROM public.journey_step_runs sr WHERE sr.tenant_id = p_tenant;
    v_from := COALESCE(LEAST(v_from, p_until), p_until);
  ELSE
    v_from := v_sealed + 1;
  END IF;
  v_stop := LEAST(p_until, v_from + GREATEST(COALESCE(p_max_days, 62), 1));
  v_rows := public._journey_rollup_days(p_tenant, v_from, v_stop);
  INSERT INTO public.data_retention_state AS st (tenant_id, scope, sealed_through, updated_at)
  VALUES (p_tenant, 'journey_stats', v_stop - 1, now())
  ON CONFLICT (tenant_id, scope) DO UPDATE
     SET sealed_through = GREATEST(COALESCE(st.sealed_through, EXCLUDED.sealed_through), EXCLUDED.sealed_through),
         updated_at = now();
  RETURN jsonb_build_object('sealed_through', v_stop - 1, 'rows', v_rows, 'complete', v_stop >= p_until);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_seal_journeys(uuid, date, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- H) Bezpieczny start: wiersze istniejących najemców, 14 dni podglądu.
-- ----------------------------------------------------------------------------
INSERT INTO public.data_retention_settings (tenant_id, category, period_months, enabled, enforce_after)
SELECT t.id, c.item ->> 'key', (c.item ->> 'default')::smallint, true, now() + interval '14 days'
  FROM public.tenants t
 CROSS JOIN jsonb_array_elements(public._data_retention_catalog() -> 'categories') AS c(item)
ON CONFLICT (tenant_id, category) DO NOTHING;
