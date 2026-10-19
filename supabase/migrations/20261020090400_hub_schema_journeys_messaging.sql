-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I0, 5/6): ŚCIEŻKI KOMUNIKACJI - WIADOMOŚCI,
-- ZDARZENIA ŚLEDZENIA, TREŚCI MAILI, DZIENNE STATYSTYKI WĘZŁÓW,
-- IDENTYFIKATOR OPERATORA W DZIENNIKU WYSYŁEK.
--
-- DEFEKT
--   1. Statystyki kampanii liczą otwarcia i kliknięcia per kampania, nie per
--      krok sekwencji - wynik ścieżki („który mail sprzedaje") byłby nie do
--      policzenia bez osobnego dziennika wiadomości ścieżki.
--   2. `email_send_log` nie przechowuje identyfikatora wiadomości nadanego
--      przez operatora, więc webhook odbicia albo skargi nie trafia do
--      wiersza, z którego liczą się statystyki (odbicia ścieżek = 0 na zawsze).
--
-- ZMIANA (addytywny DDL; pisarze w S5)
--   A. `journey_messages` - wiadomość ścieżki (deterministyczny
--      `message_id` = klucz idempotencji kolejki maili), z wariantem A/B
--      i językiem.
--   B. `journey_message_events` - otwarcie / kliknięcie / wypis; jeden
--      wiersz na (wiadomość, rodzaj, link, doba) - deduplikacja doby.
--   C. `journey_email_contents` - temat i preheader PL/EN + dokument maila
--      per (ścieżka, wersja, węzeł, wariant); `version_id IS NULL` = szkic
--      (NULLS NOT DISTINCT: jeden szkic na węzeł i wariant).
--   D. `journey_node_daily_stats` - dzienny rollup statystyk węzła (odczyt
--      długich okien bez skanu surowych zdarzeń).
--   E. `email_send_log` += `provider_message_id` + indeks częściowy.
--   Odczyt A, C, D: admin|editor najemcy; B: tylko service_role (wolumen,
--   staff czyta przez RPC statystyk). Zapis: wyłącznie runner i RPC.
--   Temat > 200 znaków jest ODRZUCANY, nie przycinany.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020090300 (klucze obce do definicji, wersji
-- i zapisów). `email_send_log` jest gorący (dren kolejki co minutę) - ALTER
-- i indeks z `lock_timeout`; kolumna NULL-owalna bez domyślnej wartości nie
-- przepisuje tabeli. Dzisiejszy dren nie podaje nowej kolumny.
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, CREATE TABLE / INDEX IF NOT EXISTS
-- (indeksy nazwane), DROP TRIGGER / POLICY IF EXISTS + CREATE, bezstanowe
-- REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_schema_rls_test.sql (RLS, granty, CHECK tematu,
-- kolumna `provider_message_id`); parytet limitów:
-- src/lib/journeys/__tests__/journeyLimitsParity.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Wiadomości ścieżek.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_messages (
  -- deterministicMessageId('journey:{enrollment}:{node}') - ten sam klucz
  -- trafia do kolejki maili, więc powtórka kroku nie wysyła drugi raz.
  message_id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.journey_enrollments(id) ON DELETE CASCADE,
  journey_id uuid NOT NULL,
  version_id uuid NOT NULL,
  node_id text NOT NULL,
  lead_id uuid NOT NULL,
  variant text CHECK (variant ~ '^[A-E]$'),
  locale text CHECK (locale IN ('pl','en')),
  queued_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journey_messages_node_idx
  ON public.journey_messages (journey_id, node_id);
CREATE INDEX IF NOT EXISTS journey_messages_enrollment_idx
  ON public.journey_messages (enrollment_id);

-- ----------------------------------------------------------------------------
-- B) Zdarzenia śledzenia (tylko service_role).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_message_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  message_id text NOT NULL REFERENCES public.journey_messages(message_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('open','click','unsubscribe')),
  -- -1 = zdarzenie bez linku (otwarcie, wypis).
  link_index smallint NOT NULL DEFAULT -1,
  url text,
  -- Otwarcie maszynowe (proxy pocztowe, < journey_settings.machine_open_seconds).
  machine boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  CONSTRAINT journey_message_events_dedupe_key UNIQUE (message_id, kind, link_index, day)
);

-- ----------------------------------------------------------------------------
-- C) Treści maili ścieżek.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_email_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journey_id uuid NOT NULL,
  -- NULL = szkic; publikacja kopiuje szkic do wersji.
  version_id uuid,
  node_id text NOT NULL,
  variant text NOT NULL DEFAULT 'A' CHECK (variant ~ '^[A-E]$'),
  subject_pl text NOT NULL CHECK (char_length(subject_pl) BETWEEN 1 AND 200),
  -- NULL = wersja EN niegotowa -> wysyłka po polsku.
  subject_en text CHECK (char_length(subject_en) <= 200),
  preheader_pl text CHECK (char_length(preheader_pl) <= 200),
  preheader_en text CHECK (char_length(preheader_en) <= 200),
  -- EmailDoc v1 (walidowany przy zapisie i publikacji).
  doc jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journey_email_contents_journey_fkey
    FOREIGN KEY (tenant_id, journey_id) REFERENCES public.journey_definitions(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT journey_email_contents_version_fkey
    FOREIGN KEY (tenant_id, version_id) REFERENCES public.journey_versions(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT journey_email_contents_node_key UNIQUE NULLS NOT DISTINCT (journey_id, version_id, node_id, variant)
);

CREATE INDEX IF NOT EXISTS journey_email_contents_tenant_journey_idx
  ON public.journey_email_contents (tenant_id, journey_id);
CREATE INDEX IF NOT EXISTS journey_email_contents_version_idx
  ON public.journey_email_contents (tenant_id, version_id) WHERE version_id IS NOT NULL;

DROP TRIGGER IF EXISTS journey_email_contents_set_updated_at ON public.journey_email_contents;
CREATE TRIGGER journey_email_contents_set_updated_at
  BEFORE UPDATE ON public.journey_email_contents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- D) Dzienne statystyki węzłów.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_node_daily_stats (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journey_id uuid NOT NULL,
  version_id uuid NOT NULL,
  node_id text NOT NULL,
  -- '-' = węzeł bez wariantów.
  variant text NOT NULL DEFAULT '-',
  day date NOT NULL,
  entered integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  dead integer NOT NULL DEFAULT 0,
  emails_sent integer NOT NULL DEFAULT 0,
  emails_bounced integer NOT NULL DEFAULT 0,
  emails_complained integer NOT NULL DEFAULT 0,
  unique_opens integer NOT NULL DEFAULT 0,
  unique_human_opens integer NOT NULL DEFAULT 0,
  unique_clicks integer NOT NULL DEFAULT 0,
  unsubscribes integer NOT NULL DEFAULT 0,
  goal_reached integer NOT NULL DEFAULT 0,
  PRIMARY KEY (journey_id, version_id, node_id, variant, day),
  CONSTRAINT journey_node_daily_stats_journey_fkey
    FOREIGN KEY (tenant_id, journey_id) REFERENCES public.journey_definitions(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS journey_node_daily_stats_tenant_journey_idx
  ON public.journey_node_daily_stats (tenant_id, journey_id);

-- ----------------------------------------------------------------------------
-- E) Identyfikator wiadomości operatora w dzienniku wysyłek.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';

ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS provider_message_id text;

-- Częściowy: wiersze bez identyfikatora (kolejka, błędy, historia) nie
-- powiększają indeksu. Nieunikalny - dziennik ma wiele wierszy na wiadomość.
CREATE INDEX IF NOT EXISTS email_send_log_provider_message_id_idx
  ON public.email_send_log (provider_message_id) WHERE provider_message_id IS NOT NULL;

RESET lock_timeout;

COMMENT ON COLUMN public.email_send_log.provider_message_id IS
  'Identyfikator wiadomości nadany przez operatora poczty - po nim webhook odbicia/skargi trafia do wiersza statystyk (S5).';

-- ----------------------------------------------------------------------------
-- RLS i granty.
-- ----------------------------------------------------------------------------
ALTER TABLE public.journey_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_message_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_email_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_node_daily_stats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.journey_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.journey_message_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.journey_email_contents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.journey_node_daily_stats FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.journey_messages TO service_role;
GRANT ALL ON TABLE public.journey_message_events TO service_role;
GRANT ALL ON TABLE public.journey_email_contents TO service_role;
GRANT ALL ON TABLE public.journey_node_daily_stats TO service_role;

GRANT SELECT ON TABLE public.journey_messages TO authenticated;
GRANT SELECT ON TABLE public.journey_email_contents TO authenticated;
GRANT SELECT ON TABLE public.journey_node_daily_stats TO authenticated;

DROP POLICY IF EXISTS journey_messages_staff_read ON public.journey_messages;
CREATE POLICY journey_messages_staff_read ON public.journey_messages
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.is_admin_or_editor());

DROP POLICY IF EXISTS journey_email_contents_staff_read ON public.journey_email_contents;
CREATE POLICY journey_email_contents_staff_read ON public.journey_email_contents
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.is_admin_or_editor());

DROP POLICY IF EXISTS journey_node_daily_stats_staff_read ON public.journey_node_daily_stats;
CREATE POLICY journey_node_daily_stats_staff_read ON public.journey_node_daily_stats
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.is_admin_or_editor());

COMMENT ON TABLE public.journey_messages IS
  'Ścieżki komunikacji: wiadomość kroku (message_id = klucz idempotencji kolejki). Odczyt: admin|editor najemcy.';
COMMENT ON TABLE public.journey_message_events IS
  'Ścieżki komunikacji: otwarcia/kliknięcia/wypisy z deduplikacją doby. Tylko service_role (statystyki przez RPC).';
COMMENT ON TABLE public.journey_email_contents IS
  'Ścieżki komunikacji: treść maila per węzeł i wariant (version_id NULL = szkic). Odczyt: admin|editor najemcy.';
COMMENT ON TABLE public.journey_node_daily_stats IS
  'Ścieżki komunikacji: dzienny rollup statystyk węzła (dzień zamknięty liczony raz). Odczyt: admin|editor najemcy.';
