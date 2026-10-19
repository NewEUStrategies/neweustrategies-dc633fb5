-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I0, 4/6): ŚCIEŻKI KOMUNIKACJI - RDZEŃ (DEFINICJE,
-- WERSJE, TRASY ZDARZEŃ, SKRZYNKA, ZAPISY, KROKI, USTAWIENIA, BŁĘDY SILNIKA).
--
-- DEFEKT
--   Przepisy (`workflow_definitions`) wykonują pojedynczą akcję na zdarzenie:
--   nie umieją czekać („3 dni po rejestracji"), rozgałęziać się po warunku,
--   zakończyć przy osiągnięciu celu ani pamiętać, na którym kroku jest dany
--   kontakt. Sekwencje powitalne, porzucony koszyk czy win-back nie mają
--   gdzie żyć, a każda próba złożenia ich z przepisów dubluje maile przy
--   powtórce zdarzenia.
--
-- ZMIANA (addytywny DDL; silnik w S5, interfejs w S8)
--   A. `journey_definitions` - ścieżka najemcy: klucz, nazwa, status,
--      kategoria (`marketing` | `service` - ta druga tylko z podstawą
--      prawną), szkic grafu. `UNIQUE (tenant_id, id)` jest celem złożonych
--      kluczy obcych - żaden wiersz potomny nie wskaże ścieżki innego najemcy.
--   B. `journey_versions` - niezmienna wersja opublikowana (wyzwalacz,
--      warunek, filtr wejścia, ponowne wejście, cel, wyjścia, graf + suma).
--   C. `journey_event_routes` - indeks nasłuchu przebudowywany przy
--      publikacji: trigger szyny robi jedno zapytanie po PK.
--   D. `journey_event_inbox` - skrzynka zdarzeń (zredagowany payload,
--      bez FK do `domain_events` - retencja szyny 90 dni).
--   E. `journey_enrollments` - zapis kontaktu do wersji ścieżki; najwyżej
--      jeden aktywny na (ścieżka, lead); klucz idempotencji wejścia.
--   F. `journey_step_runs` - przebieg węzła (graf jest DAG-iem: węzeł
--      odwiedzany raz na zapis).
--   G. `journey_settings` - wyłącznik najemcy (DOMYŚLNIE WYŁĄCZONY), limit
--      marketingowy na 7 dni, cisza nocna, próg otwarć maszynowych.
--   H. `journey_engine_errors` - ślad awarii faz silnika (najemca może być
--      jeszcze nieznany - faza `route`).
--   Odczyt A, B, E, F, G: admin|editor najemcy. C, D, H: wyłącznie
--   service_role (staff czyta przez RPC). Zapis: wyłącznie RPC i runner.
--   Za długie wartości (nazwa > 160, opis > 2000, podstawa prawna > 500) są
--   ODRZUCANE, nie przycinane - licznik w edytorze pokazuje to, co zapisze baza.
--
-- KOLEJNOŚĆ WDROŻENIA: dowolna - nowe tabele, nikt ich jeszcze nie czyta.
-- Wymaga `crm_leads_tenant_id_key UNIQUE (tenant_id, id)` (20260823160000).
-- Klucz obcy `journey_enrollments` -> `crm_leads` (gorąca tabela) stoi za
-- `lock_timeout` - zajęta tabela = 55P03 i ponowienie pliku, nie kolejka.
-- IDEMPOTENTNA: CREATE TABLE / INDEX IF NOT EXISTS (indeksy nazwane),
-- DROP TRIGGER / POLICY IF EXISTS + CREATE, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_schema_rls_test.sql (RLS, granty, izolacja,
-- `journey_settings.enabled = false`, CHECK nazwy); parytet limitów:
-- src/lib/journeys/__tests__/journeyLimitsParity.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Definicje.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z0-9_-]{3,64}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  description text CHECK (char_length(description) <= 2000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  category text NOT NULL DEFAULT 'marketing' CHECK (category IN ('marketing','service')),
  legal_basis text CHECK (char_length(legal_basis) <= 500),
  template_key text,
  draft jsonb NOT NULL DEFAULT '{"graph":{"nodes":[],"edges":[]},"settings":{}}'::jsonb,
  -- Bez FK: wersja wskazuje definicję, a cykl kluczy blokowałby wstawianie.
  published_version_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Komunikacja „usługowa" omija zgodę marketingową tylko z podstawą prawną.
  CONSTRAINT journey_definitions_service_basis_check CHECK (category = 'marketing' OR legal_basis IS NOT NULL),
  CONSTRAINT journey_definitions_tenant_key_key UNIQUE (tenant_id, key),
  CONSTRAINT journey_definitions_tenant_id_key UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS journey_definitions_tenant_status_idx
  ON public.journey_definitions (tenant_id, status);

DROP TRIGGER IF EXISTS journey_definitions_set_updated_at ON public.journey_definitions;
CREATE TRIGGER journey_definitions_set_updated_at
  BEFORE UPDATE ON public.journey_definitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- B) Wersje opublikowane.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journey_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  trigger_event_type text NOT NULL CHECK (trigger_event_type ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$'),
  -- payload @> condition
  trigger_condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  entry_filter jsonb NOT NULL DEFAULT '[]'::jsonb,
  reentry text NOT NULL DEFAULT 'never' CHECK (reentry IN ('never','after_exit','cooldown')),
  reentry_cooldown_days integer CHECK (reentry_cooldown_days BETWEEN 1 AND 730),
  goal jsonb,
  exit_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  graph jsonb NOT NULL,
  graph_checksum text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  CONSTRAINT journey_versions_journey_fkey
    FOREIGN KEY (tenant_id, journey_id) REFERENCES public.journey_definitions(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT journey_versions_journey_version_key UNIQUE (journey_id, version),
  CONSTRAINT journey_versions_tenant_id_key UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS journey_versions_tenant_journey_idx
  ON public.journey_versions (tenant_id, journey_id);

-- ----------------------------------------------------------------------------
-- C) Trasy zdarzeń (tylko service_role).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_event_routes (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  journey_id uuid NOT NULL,
  version_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('enroll','goal','exit','wake')),
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, event_type, journey_id, role),
  CONSTRAINT journey_event_routes_journey_fkey
    FOREIGN KEY (tenant_id, journey_id) REFERENCES public.journey_definitions(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT journey_event_routes_version_fkey
    FOREIGN KEY (tenant_id, version_id) REFERENCES public.journey_versions(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS journey_event_routes_journey_idx
  ON public.journey_event_routes (tenant_id, journey_id);
CREATE INDEX IF NOT EXISTS journey_event_routes_version_idx
  ON public.journey_event_routes (tenant_id, version_id);

-- ----------------------------------------------------------------------------
-- D) Skrzynka zdarzeń (tylko service_role).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_event_inbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- domain_events.id - bez FK: retencja szyny jest krótsza niż skrzynki.
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  aggregate_type text,
  aggregate_id text,
  actor_id uuid,
  correlation_id uuid,
  -- Już zredagowany przez emit_domain_event (bez PII).
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts smallint NOT NULL DEFAULT 0,
  error text,
  CONSTRAINT journey_event_inbox_event_id_key UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS journey_event_inbox_pending_idx
  ON public.journey_event_inbox (received_at) WHERE processed_at IS NULL;

-- ----------------------------------------------------------------------------
-- E) Zapisy kontaktów.
-- ----------------------------------------------------------------------------
-- FK do `crm_leads` bierze na niej SHARE ROW EXCLUSIVE (konflikt z każdym
-- zapisem). Bez limitu CREATE czekałby za długą transakcją importu CRM,
-- a za nim w kolejce blokad stanęłyby wszystkie zapisy leadów (newsletter).
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.journey_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journey_id uuid NOT NULL,
  version_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  user_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','waiting','completed','goal_reached','exited','failed')),
  current_node_id text,
  next_run_at timestamptz,
  locked_until timestamptz,
  lock_token uuid,
  wait_event_type text,
  wait_condition jsonb,
  wait_deadline timestamptz,
  entered_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  exit_reason text CHECK (exit_reason IN ('completed','goal','exit_event','consent','unsubscribed','suppressed','manual','journey_archived','error','entry_filter')),
  trigger_event_id uuid,
  trigger_event_type text,
  trigger_snapshot jsonb NOT NULL,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  enrollment_key text NOT NULL,
  is_test boolean NOT NULL DEFAULT false,
  -- Usunięcie leada (RODO) kasuje jego zapisy, kroki i wiadomości.
  CONSTRAINT journey_enrollments_lead_fkey
    FOREIGN KEY (tenant_id, lead_id) REFERENCES public.crm_leads(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT journey_enrollments_journey_fkey
    FOREIGN KEY (tenant_id, journey_id) REFERENCES public.journey_definitions(tenant_id, id) ON DELETE CASCADE,
  -- Bez kaskady: wersji z zapisami nie wolno skasować osobno (zapisy są do
  -- niej przypięte); znika wyłącznie razem ze ścieżką.
  CONSTRAINT journey_enrollments_version_fkey
    FOREIGN KEY (tenant_id, version_id) REFERENCES public.journey_versions(tenant_id, id),
  CONSTRAINT journey_enrollments_key UNIQUE (journey_id, enrollment_key)
);

RESET lock_timeout;

-- Najwyżej jeden aktywny zapis na (ścieżka, lead): powtórzone zdarzenie
-- wyzwalacza nie zapisuje kontaktu drugi raz.
CREATE UNIQUE INDEX IF NOT EXISTS journey_enrollments_active_uidx
  ON public.journey_enrollments (journey_id, lead_id) WHERE status IN ('active','waiting');
CREATE INDEX IF NOT EXISTS journey_enrollments_due_idx
  ON public.journey_enrollments (next_run_at) WHERE status IN ('active','waiting');
CREATE INDEX IF NOT EXISTS journey_enrollments_lead_idx
  ON public.journey_enrollments (tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS journey_enrollments_version_idx
  ON public.journey_enrollments (tenant_id, version_id);

-- ----------------------------------------------------------------------------
-- F) Przebiegi kroków.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_step_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.journey_enrollments(id) ON DELETE CASCADE,
  journey_id uuid NOT NULL,
  version_id uuid NOT NULL,
  node_id text NOT NULL,
  node_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','skipped','failed','dead')),
  attempts smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text CHECK (outcome IN ('next','yes','no','A','B','C','D','E','event','timeout','capped','quiet','no_consent','precedence','skipped','delivery_not_ready')),
  -- Bez PII: identyfikatory i kody, nigdy treść maila ani adres.
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  -- Graf jest DAG-iem: węzeł odwiedzany raz na zapis (idempotencja kroku).
  CONSTRAINT journey_step_runs_node_key UNIQUE (enrollment_id, node_id)
);

CREATE INDEX IF NOT EXISTS journey_step_runs_stats_idx
  ON public.journey_step_runs (journey_id, version_id, node_id, status);

-- ----------------------------------------------------------------------------
-- G) Ustawienia silnika najemcy.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- DOMYŚLNIE WYŁĄCZONY: żaden najemca nie dostaje maila ścieżki bez
  -- świadomego włączenia przez admina.
  enabled boolean NOT NULL DEFAULT false,
  marketing_cap_per_7d smallint NOT NULL DEFAULT 3 CHECK (marketing_cap_per_7d BETWEEN 1 AND 20),
  quiet_start time NOT NULL DEFAULT '21:00',
  quiet_end time NOT NULL DEFAULT '08:00',
  timezone text NOT NULL DEFAULT 'Europe/Warsaw',
  default_task_assignee_id uuid,
  -- Otwarcie szybsze niż próg od wysyłki = skaner/proxy, nie człowiek.
  machine_open_seconds smallint NOT NULL DEFAULT 2 CHECK (machine_open_seconds BETWEEN 0 AND 30),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS journey_settings_set_updated_at ON public.journey_settings;
CREATE TRIGGER journey_settings_set_updated_at
  BEFORE UPDATE ON public.journey_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- H) Błędy silnika (tylko service_role).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_engine_errors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- NULL-owalny: awaria trasy może wystąpić, zanim najemca jest znany.
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('route','ingest','advance','email','tracking')),
  event_id uuid,
  journey_id uuid,
  enrollment_id uuid,
  node_id text,
  error text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journey_engine_errors_tenant_created_idx
  ON public.journey_engine_errors (tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- RLS i granty.
-- ----------------------------------------------------------------------------
ALTER TABLE public.journey_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_event_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_event_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_step_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_engine_errors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.journey_definitions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.journey_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.journey_event_routes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.journey_event_inbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.journey_enrollments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.journey_step_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.journey_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.journey_engine_errors FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.journey_definitions TO service_role;
GRANT ALL ON TABLE public.journey_versions TO service_role;
GRANT ALL ON TABLE public.journey_event_routes TO service_role;
GRANT ALL ON TABLE public.journey_event_inbox TO service_role;
GRANT ALL ON TABLE public.journey_enrollments TO service_role;
GRANT ALL ON TABLE public.journey_step_runs TO service_role;
GRANT ALL ON TABLE public.journey_settings TO service_role;
GRANT ALL ON TABLE public.journey_engine_errors TO service_role;

GRANT SELECT ON TABLE public.journey_definitions TO authenticated;
GRANT SELECT ON TABLE public.journey_versions TO authenticated;
GRANT SELECT ON TABLE public.journey_enrollments TO authenticated;
GRANT SELECT ON TABLE public.journey_step_runs TO authenticated;
GRANT SELECT ON TABLE public.journey_settings TO authenticated;

DROP POLICY IF EXISTS journey_definitions_staff_read ON public.journey_definitions;
CREATE POLICY journey_definitions_staff_read ON public.journey_definitions
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.is_admin_or_editor());

DROP POLICY IF EXISTS journey_versions_staff_read ON public.journey_versions;
CREATE POLICY journey_versions_staff_read ON public.journey_versions
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.is_admin_or_editor());

DROP POLICY IF EXISTS journey_enrollments_staff_read ON public.journey_enrollments;
CREATE POLICY journey_enrollments_staff_read ON public.journey_enrollments
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.is_admin_or_editor());

DROP POLICY IF EXISTS journey_step_runs_staff_read ON public.journey_step_runs;
CREATE POLICY journey_step_runs_staff_read ON public.journey_step_runs
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.is_admin_or_editor());

DROP POLICY IF EXISTS journey_settings_staff_read ON public.journey_settings;
CREATE POLICY journey_settings_staff_read ON public.journey_settings
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.is_admin_or_editor());

COMMENT ON TABLE public.journey_definitions IS
  'Ścieżki komunikacji: definicja najemcy (szkic grafu, status, kategoria). Zapis: RPC admin_journey_* (S5). Odczyt: admin|editor najemcy.';
COMMENT ON TABLE public.journey_versions IS
  'Ścieżki komunikacji: niezmienna wersja opublikowana (wyzwalacz, graf, suma kontrolna). Odczyt: admin|editor najemcy.';
COMMENT ON TABLE public.journey_event_routes IS
  'Ścieżki komunikacji: indeks nasłuchu (event_type -> ścieżka, rola) przebudowywany przy publikacji. Tylko service_role.';
COMMENT ON TABLE public.journey_event_inbox IS
  'Ścieżki komunikacji: skrzynka zdarzeń szyny (zredagowany payload), przetwarzana przez runner. Tylko service_role.';
COMMENT ON TABLE public.journey_enrollments IS
  'Ścieżki komunikacji: zapis kontaktu do wersji (najwyżej jeden aktywny na ścieżkę i lead). Odczyt: admin|editor najemcy.';
COMMENT ON TABLE public.journey_step_runs IS
  'Ścieżki komunikacji: przebieg węzła zapisu (raz na węzeł). Odczyt: admin|editor najemcy.';
COMMENT ON TABLE public.journey_settings IS
  'Ścieżki komunikacji: ustawienia silnika najemcy - domyślnie wyłączony. Zapis: admin przez RPC (S5). Odczyt: admin|editor najemcy.';
COMMENT ON TABLE public.journey_engine_errors IS
  'Ścieżki komunikacji: błędy faz silnika (route/ingest/advance/email/tracking). Tylko service_role.';
