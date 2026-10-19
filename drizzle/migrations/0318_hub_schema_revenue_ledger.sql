-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I0, 1/6): KSIĘGA PRZYCHODU - MIGAWKA CENY, HISTORIA
-- STANÓW SUBSKRYPCJI, RUCHY MRR, CYKLE WINDYKACJI, MIGAWKI DZIENNE, ZNACZNIKI.
--
-- DEFEKT
--   1. MRR liczony dziś „na żywo" z bieżącego `subscriptions.price_id`
--      i katalogu. Zmiana planu, pauza, rabat albo przecena v6.2 nadpisują
--      wiersz - poprzedni stan znika, więc nie da się odpowiedzieć, ILE MRR
--      przyszło z nowych klientów, a ile odpłynęło z rezygnacji (most MRR),
--      ani policzyć NRR/GRR i kohort. Panel pokazuje jedną liczbę bez historii.
--   2. Subskrypcja nie pamięta kwoty, którą operator FAKTYCZNIE pobiera
--      (cena jednostkowa, waluta, rabat okresowy). Po przecenie katalogu MRR
--      z katalogu rozjeżdża się z rzeczywistością subskrypcji przeniesionych.
--   3. `billing_documents` nie ma środowiska - dokument z trybu testowego
--      operatora liczy się do przychodu zrealizowanego na równi z produkcją.
--   4. Skanery czasowe (koniec triala, wygaśnięcie, utrata w windykacji)
--      nie mają gdzie zapisać „to zdarzenie już wyemitowałem" - powtórka
--      ticku zdublowałaby zdarzenie na szynie.
--
-- ZMIANA (wyłącznie addytywny DDL; pisarze przychodzą w S2)
--   A. `subscriptions` += `unit_amount_minor`, `currency`,
--      `discount_minor_per_period`, `discount_ends_at` - migawka ceny od
--      operatora (zapisuje ją webhook w S2; do tego czasu NULL = „nieznana",
--      MRR liczy się wtedy z katalogu z `mrr_basis = 'catalog'`).
--   B. `billing_documents` += `environment` (NULL = nieznane; backfill w S2).
--   C. `subscription_state_history` - jeden wiersz na zmianę stanu, z MRR
--      przed/po i kluczem deduplikacji (ten sam event operatora nie dubluje).
--   D. `mrr_movements` - ruch MRR wyprowadzony z historii (new / expansion /
--      contraction / churn / reactivation) z powodem; `delta_minor` liczona
--      przez bazę (kolumna GENERATED), więc suma ruchów nie zależy od pisarza.
--   E. `dunning_cycles` - cykl windykacji od pierwszej nieudanej płatności do
--      odzyskania albo utraty; co najwyżej jeden otwarty na subskrypcję.
--   F. `mrr_daily_snapshots` - migawka dzienna (drugi niezależny pomiar do
--      rekoncyliacji z sumą ruchów).
--   G. `revenue_event_marks` - znaczniki idempotencji skanerów (INSERT ... ON
--      CONFLICT DO NOTHING RETURNING = emisja tylko przy nowym wierszu).
--   Odczyt C-F: wyłącznie admin najemcy (dane finansowe; editor dostaje
--   w RPC `NULL` w kwotach). G: tylko service_role, bez polityk.
--   Zapis do wszystkich tabel: wyłącznie triggery i RPC SECURITY DEFINER
--   (brak polityk INSERT/UPDATE/DELETE i grantów zapisu dla klienta).
--
-- KOLEJNOŚĆ WDROŻENIA: dowolna względem kodu. Kod sprzed huba nie czyta
-- nowych kolumn ani tabel; nowe kolumny są NULL-owalne albo mają stałą
-- wartość domyślną (PG 11+: bez przepisywania tabeli). `ALTER TABLE` na
-- gorącej `subscriptions` z `lock_timeout` - przy zajętej tabeli migracja
-- pada szybko zamiast ustawiać webhooki w kolejce za blokadą.
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, CREATE TABLE / INDEX IF NOT EXISTS
-- (indeksy nazwane), DROP POLICY IF EXISTS + CREATE, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_schema_rls_test.sql (RLS, granty, izolacja
-- najemców, CHECK-i); parytet limitów z TS:
-- src/lib/revenue/__tests__/revenueLimitsParity.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Migawka ceny na subskrypcji, środowisko dokumentów.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS unit_amount_minor integer CHECK (unit_amount_minor >= 0),
  ADD COLUMN IF NOT EXISTS currency text CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN IF NOT EXISTS discount_minor_per_period integer NOT NULL DEFAULT 0 CHECK (discount_minor_per_period >= 0),
  ADD COLUMN IF NOT EXISTS discount_ends_at timestamptz;

ALTER TABLE public.billing_documents
  ADD COLUMN IF NOT EXISTS environment text CHECK (environment IN ('sandbox','live'));

RESET lock_timeout;

COMMENT ON COLUMN public.subscriptions.unit_amount_minor IS
  'Migawka ceny jednostkowej od operatora (jednostki podrzędne waluty). NULL = nieznana - MRR liczony z katalogu (mrr_basis = catalog).';
COMMENT ON COLUMN public.subscriptions.discount_minor_per_period IS
  'Rabat na okres rozliczeniowy (jednostki podrzędne) do discount_ends_at; 0 = brak rabatu.';
COMMENT ON COLUMN public.billing_documents.environment IS
  'Środowisko operatora (sandbox | live). NULL = nieznane (dokumenty sprzed huba do backfillu); przychód zrealizowany liczy wyłącznie live.';

-- ----------------------------------------------------------------------------
-- C) Historia stanów subskrypcji.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_state_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Historia idzie za lustrem subskrypcji (kasowanym kaskadowo z kontem).
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source_event_id text,
  status_before text,
  status_after text NOT NULL,
  price_id_before text,
  price_id_after text NOT NULL,
  quantity_before integer,
  quantity_after integer NOT NULL,
  paused_after boolean NOT NULL,
  cancel_at_period_end_after boolean NOT NULL,
  payment_failure_count_after integer NOT NULL,
  mrr_before_minor integer,
  mrr_after_minor integer,
  currency text,
  mrr_basis text CHECK (mrr_basis IN ('provider','catalog')),
  -- Ten sam event operatora (ponowiony webhook) nie dubluje wiersza.
  dedupe_key text NOT NULL,
  CONSTRAINT subscription_state_history_dedupe_key_key UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS subscription_state_history_subscription_idx
  ON public.subscription_state_history (subscription_id, occurred_at);
CREATE INDEX IF NOT EXISTS subscription_state_history_tenant_time_idx
  ON public.subscription_state_history (tenant_id, environment, occurred_at);

-- ----------------------------------------------------------------------------
-- D) Ruchy MRR.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mrr_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- NULL tylko dla ruchów z backfillu (brak wiersza historii sprzed huba).
  history_id bigint REFERENCES public.subscription_state_history(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL,
  user_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  occurred_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('new','expansion','contraction','churn','reactivation')),
  reason text NOT NULL CHECK (reason IN ('signup','trial_converted','plan_change','quantity','price','discount','canceled','unpaid','paused','resumed','currency_switch','backfill')),
  mrr_before_minor integer NOT NULL,
  mrr_after_minor integer NOT NULL,
  -- Liczona przez bazę: suma ruchów nie zależy od arytmetyki pisarza.
  delta_minor integer GENERATED ALWAYS AS (mrr_after_minor - mrr_before_minor) STORED,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  tier_key_before text,
  tier_key_after text,
  interval_before text,
  interval_after text,
  segment text NOT NULL CHECK (segment IN ('b2c_individual','b2c_reduced','b2b_institution','other')),
  backfilled boolean NOT NULL DEFAULT false,
  -- Jeden ruch na wiersz historii: powtórka triggera nie dubluje mostu MRR.
  CONSTRAINT mrr_movements_history_id_key UNIQUE (history_id)
);

CREATE INDEX IF NOT EXISTS mrr_movements_tenant_env_time_idx
  ON public.mrr_movements (tenant_id, environment, occurred_at);
CREATE INDEX IF NOT EXISTS mrr_movements_subscription_idx
  ON public.mrr_movements (subscription_id, occurred_at);

-- ----------------------------------------------------------------------------
-- E) Cykle windykacji.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dunning_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  started_at timestamptz NOT NULL,
  recovered_at timestamptz,
  lost_at timestamptz,
  outcome text NOT NULL DEFAULT 'open' CHECK (outcome IN ('open','recovered','lost')),
  failures integer NOT NULL DEFAULT 1 CHECK (failures >= 1),
  mrr_at_risk_minor integer NOT NULL,
  currency text NOT NULL
);

-- Co najwyżej jeden otwarty cykl na subskrypcję: druga nieudana płatność
-- w trakcie windykacji zwiększa `failures`, nie otwiera nowego cyklu.
CREATE UNIQUE INDEX IF NOT EXISTS dunning_cycles_open_uidx
  ON public.dunning_cycles (subscription_id) WHERE outcome = 'open';
CREATE INDEX IF NOT EXISTS dunning_cycles_tenant_started_idx
  ON public.dunning_cycles (tenant_id, environment, started_at);

-- ----------------------------------------------------------------------------
-- F) Migawka dzienna MRR.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mrr_daily_snapshots (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  day date NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  currency text NOT NULL,
  segment text NOT NULL,
  mrr_minor bigint NOT NULL,
  active_subscriptions integer NOT NULL,
  active_customers integer NOT NULL,
  trialing integer NOT NULL,
  -- Udział kwot z katalogu zamiast migawki operatora (jakość danych).
  basis_catalog_share numeric(5,4) NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day, environment, currency, segment)
);

-- ----------------------------------------------------------------------------
-- G) Znaczniki idempotencji skanerów czasowych (tylko service_role).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_event_marks (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('trial_ending','expired','quota','retention_abandoned','dunning_lost','mrr_snapshot')),
  -- Np. '<subscription_id>:<trial_ends_at::date>', '<user_id>:2026-10'.
  -- Za długi odnośnik jest odrzucany, nie przycinany: przycięty klucz
  -- mógłby skleić dwa różne zdarzenia w jeden znacznik.
  ref text NOT NULL CHECK (char_length(ref) <= 200),
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind, ref)
);

-- ----------------------------------------------------------------------------
-- RLS i granty. Produkcyjne `pg_default_acl` daje anon/authenticated pełne
-- prawa do każdej nowej tabeli - stąd jawne REVOKE ALL przed GRANT.
-- ----------------------------------------------------------------------------
ALTER TABLE public.subscription_state_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mrr_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dunning_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mrr_daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_event_marks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.subscription_state_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mrr_movements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.dunning_cycles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mrr_daily_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.revenue_event_marks FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.subscription_state_history TO service_role;
GRANT ALL ON TABLE public.mrr_movements TO service_role;
GRANT ALL ON TABLE public.dunning_cycles TO service_role;
GRANT ALL ON TABLE public.mrr_daily_snapshots TO service_role;
GRANT ALL ON TABLE public.revenue_event_marks TO service_role;

-- Odczyt finansowy: tylko admin najemcy z sesji (tenant domowy, nie
-- nagłówek hosta). Editor czyta wskaźniki niefinansowe przez RPC.
GRANT SELECT ON TABLE public.subscription_state_history TO authenticated;
GRANT SELECT ON TABLE public.mrr_movements TO authenticated;
GRANT SELECT ON TABLE public.dunning_cycles TO authenticated;
GRANT SELECT ON TABLE public.mrr_daily_snapshots TO authenticated;

DROP POLICY IF EXISTS subscription_state_history_admin_read ON public.subscription_state_history;
CREATE POLICY subscription_state_history_admin_read ON public.subscription_state_history
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS mrr_movements_admin_read ON public.mrr_movements;
CREATE POLICY mrr_movements_admin_read ON public.mrr_movements
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS dunning_cycles_admin_read ON public.dunning_cycles;
CREATE POLICY dunning_cycles_admin_read ON public.dunning_cycles
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS mrr_daily_snapshots_admin_read ON public.mrr_daily_snapshots;
CREATE POLICY mrr_daily_snapshots_admin_read ON public.mrr_daily_snapshots
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()), 'admin'::app_role));

COMMENT ON TABLE public.subscription_state_history IS
  'Hub przychodu: historia stanów subskrypcji (MRR przed/po, dedupe_key = event operatora). Zapis: trigger S2. Odczyt: admin najemcy.';
COMMENT ON TABLE public.mrr_movements IS
  'Hub przychodu: ruchy MRR (new/expansion/contraction/churn/reactivation) z powodem; delta_minor liczona przez bazę. Odczyt: admin najemcy.';
COMMENT ON TABLE public.dunning_cycles IS
  'Hub przychodu: cykle windykacji (open -> recovered | lost); jeden otwarty na subskrypcję. Odczyt: admin najemcy.';
COMMENT ON TABLE public.mrr_daily_snapshots IS
  'Hub przychodu: migawka dzienna MRR (rekoncyliacja z sumą ruchów). Odczyt: admin najemcy.';
COMMENT ON TABLE public.revenue_event_marks IS
  'Hub przychodu: znaczniki idempotencji skanerów czasowych (emisja tylko przy nowym wierszu). Tylko service_role.';
