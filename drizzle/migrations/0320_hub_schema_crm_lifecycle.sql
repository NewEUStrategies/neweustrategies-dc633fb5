-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I0, 3/6): CRM - KONTO LEADA, CYKL ŻYCIA, HISTORIA
-- ETAPÓW, ŹRÓDŁO ZADAŃ.
--
-- DEFEKT
--   1. `crm_leads` łączy się z kontem wyłącznie po e-mailu. Zmiana adresu
--      albo dwa konta z tym samym adresem w dwóch najemcach rozrywają
--      powiązanie - lejek „zapis -> rejestracja -> zakup" gubi ludzi.
--   2. Lead ma tylko etap sprzedażowy (`stage`). Brak cyklu życia
--      (subskrybent -> lead -> zarejestrowany -> klient -> były klient), więc
--      lejka nie da się policzyć z jednego źródła, a ścieżki komunikacji nie
--      mają warunku „tylko klienci".
--   3. Zmiana etapu nadpisuje wartość bez śladu - nie wiadomo, kiedy lead
--      wszedł do etapu, kto go przesunął i czy zrobił to billing, ścieżka czy
--      człowiek (konwersja między etapami i czas w etapie niepoliczalne).
--   4. Zadanie CRM nie wie, kto je utworzył (człowiek, przepis, ścieżka,
--      billing), a powtórka kroku automatyzacji tworzy duplikat zadania.
--
-- ZMIANA (addytywny DDL; pisarze w S4)
--   A. `crm_leads` += `user_id` (unikalny w najemcy, gdy ustawiony),
--      `lifecycle_stage` (9 etapów, domyślnie `subscriber`),
--      `lifecycle_changed_at`.
--   B. `crm_lead_stage_history` - wiersz na każdą zmianę `stage` albo
--      `lifecycle_stage` ze źródłem (`backfill` dla historii odtworzonej
--      z `audit_log`) i aktorem; kasowana kaskadą z leadem.
--   C. `crm_tasks` += `source` (domyślnie `manual` - dzisiejsze zadania),
--      `origin_ref` (≤ 200; unikalny w najemcy - arbiter idempotencji kroku
--      automatyzacji). Za długi odnośnik jest ODRZUCANY, nie przycinany:
--      przycięcie skleiłoby dwa różne kroki w jedno zadanie.
--   Odczyt B: admin|editor najemcy. Zapis: wyłącznie trigger i RPC S4.
--
-- KOLEJNOŚĆ WDROŻENIA: dowolna. Dzisiejsze INSERT-y do `crm_leads`
-- i `crm_tasks` nie podają nowych kolumn - dostają wartości domyślne
-- zgodne z CHECK. `ADD COLUMN ... NOT NULL DEFAULT` ze stałą nie przepisuje
-- tabeli, ale CHECK skanuje ją pod ACCESS EXCLUSIVE - stąd `lock_timeout`
-- i wdrożenie poza szczytem (zapytanie liczności przed M0).
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, CREATE TABLE / INDEX IF NOT EXISTS
-- (indeksy nazwane), DROP POLICY IF EXISTS + CREATE, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_schema_rls_test.sql (domyślne, CHECK
-- `origin_ref`, indeksy unikalne, RLS historii); parytet etapów i źródeł:
-- src/lib/crm/__tests__/lifecycleParity.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Konto i cykl życia leada.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'subscriber' CHECK (lifecycle_stage IN ('subscriber','lead','registered','mql','sql','opportunity','customer','former_customer','other')),
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at timestamptz;

-- Jedno konto = jeden lead w najemcy (resolver tożsamości ścieżek i lejek
-- łączą po user_id, nie po e-mailu).
CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_tenant_user_uidx
  ON public.crm_leads (tenant_id, user_id) WHERE user_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- C) Źródło i idempotencja zadań.
-- ----------------------------------------------------------------------------
ALTER TABLE public.crm_tasks
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','workflow','journey','billing','system')),
  ADD COLUMN IF NOT EXISTS origin_ref text CHECK (char_length(origin_ref) <= 200);

CREATE UNIQUE INDEX IF NOT EXISTS crm_tasks_origin_uidx
  ON public.crm_tasks (tenant_id, origin_ref) WHERE origin_ref IS NOT NULL;

RESET lock_timeout;

COMMENT ON COLUMN public.crm_leads.user_id IS
  'Konto powiązane z leadem (unikalne w najemcy). NULL = kontakt bez konta (np. sam newsletter).';
COMMENT ON COLUMN public.crm_leads.lifecycle_stage IS
  'Cykl życia: subscriber | lead | registered | mql | sql | opportunity | customer | former_customer | other. Pierwszeństwo pisarzy: billing > manual > journey = workflow > system (S4).';
COMMENT ON COLUMN public.crm_tasks.origin_ref IS
  'Odnośnik źródła automatycznego (np. journey:<zapis>:<węzeł>), unikalny w najemcy - powtórka kroku nie dubluje zadania. Za długi = odrzucony.';

-- ----------------------------------------------------------------------------
-- B) Historia etapów.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_lead_stage_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('crm_stage','lifecycle')),
  from_value text,
  to_value text NOT NULL,
  source text NOT NULL CHECK (source IN ('manual','bulk','billing','journey','workflow','import','system','backfill')),
  actor_id uuid,
  journey_id uuid,
  enrollment_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  -- Złożony klucz: wiersz historii nie może wskazać leada innego najemcy
  -- (cel: crm_leads_tenant_id_key UNIQUE (tenant_id, id), 20260823160000).
  CONSTRAINT crm_lead_stage_history_lead_fkey
    FOREIGN KEY (tenant_id, lead_id) REFERENCES public.crm_leads(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS crm_lead_stage_history_lead_idx
  ON public.crm_lead_stage_history (tenant_id, lead_id, changed_at);

ALTER TABLE public.crm_lead_stage_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_lead_stage_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.crm_lead_stage_history TO service_role;
GRANT SELECT ON TABLE public.crm_lead_stage_history TO authenticated;

DROP POLICY IF EXISTS crm_lead_stage_history_staff_read ON public.crm_lead_stage_history;
CREATE POLICY crm_lead_stage_history_staff_read ON public.crm_lead_stage_history
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.is_admin_or_editor());

COMMENT ON TABLE public.crm_lead_stage_history IS
  'Hub lejka: historia zmian etapu CRM i cyklu życia leada ze źródłem i aktorem. Zapis: trigger i RPC S4. Odczyt: admin|editor najemcy.';
