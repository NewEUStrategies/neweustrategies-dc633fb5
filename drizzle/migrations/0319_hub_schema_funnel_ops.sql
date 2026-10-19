-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I0, 2/6): LEJEK I OPERACJE - UDERZENIA W PAYWALL,
-- PRZEPŁYW ANULOWANIA, OKNO PORZUCENIA KASY, DANE WEJŚCIOWE, WYCISZENIA.
--
-- DEFEKT
--   1. Lejek nie ma faktu „czytelnik uderzył w paywall" - widać rejestracje
--      i zakupy, ale nie to, ilu ludzi zatrzymała bramka i na jakiej treści.
--   2. `retention_feedback` zapisuje wyłącznie ZAKOŃCZONE ankiety odejścia
--      (`reason_label NOT NULL`). Rozpoczęty i porzucony przepływ anulowania
--      nie zostawia śladu, więc „save rate" nie ma mianownika.
--   3. Sesja kasy wygasa po stałych 24 h; operator nie może skrócić okna
--      porzucenia, od którego zależy przypomnienie o porzuconym koszyku.
--   4. Plan MRR, koszty i marże (do ekonomiki jednostkowej) nie mają tabeli -
--      liczby trzymane w arkuszu poza systemem.
--   5. Diagnoza przyjęta świadomie (np. „ten plan celowo bez ceny") wraca
--      przy każdym przebiegu - brak wyciszenia z terminem i powodem.
--
-- ZMIANA (addytywny DDL; pisarze w S2, S3, S7)
--   A. `paywall_hits` - jeden wiersz na (doba, czytelnik|gość, treść,
--      wariant) z licznikiem; gość tylko przez skrót odwiedzającego
--      (bez IP i bez identyfikatora przeglądarki w jawnej postaci).
--   B. `retention_feedback` += `flow_started_at`, `outcome`;
--      `reason_label` NULL-owalne dla wiersza `started` (powód jeszcze
--      nieznany) i `abandoned` (przepływ porzucony przed wyborem powodu -
--      skaner S2 domyka `started` po 24 h jednym UPDATE-em; wymóg powodu
--      wywracałby całą instrukcję błędem 23514). Stary nienazwany CHECK
--      `btrim(reason_label) <> ''` zastąpiony nazwanym
--      `retention_feedback_reason_label_required`:
--        COALESCE(outcome IN ('started','abandoned'), false)
--        OR (reason_label IS NOT NULL AND btrim(reason_label) <> '')
--      `COALESCE(…, false)`, a nie samo `IN`: wiersze dzisiejszego kodu nie
--      niosą `outcome` (NULL), a `NULL OR false` daje NULL, który CHECK
--      PRZEPUSZCZA - forma ze specyfikacji zgubiłaby dzisiejszą gwarancję
--      niepustego powodu. `saved` i `canceled` (koniec ankiety) - zawsze
--      z powodem. Dodany NOT VALID + VALIDATE.
--   C. `checkout_settings` += `abandon_after_minutes` (30-1440, domyślnie
--      1440 = dzisiejsze 24 h - zachowanie bez zmian do S3).
--   D. `revenue_manual_inputs` - plan i koszty per miesiąc × rodzaj ×
--      segment × waluta; kwota albo stosunek (nigdy oba).
--   E. `revenue_diagnostic_snoozes` - wyciszenie diagnozy: `days` (do 180
--      dni) albo `intentional` (z odciskiem zakresu i powodem).
--   Odczyt: A, E - admin|editor najemcy; D - wyłącznie admin (koszty
--   i marże to dane finansowe). Zapis wyłącznie RPC SECURITY DEFINER.
--
-- KOLEJNOŚĆ WDROŻENIA: dowolna. Dzisiejszy kod zawsze wstawia niepusty
-- `reason_label` (src/lib/retention/functions.ts) i nie czyta nowych kolumn;
-- przed VALIDATE zapytanie wdrożeniowe liczy wiersze z pustym powodem
-- (oczekiwane 0 - stary CHECK ich nie wpuszczał). `ALTER TABLE` na
-- `retention_feedback` i `checkout_settings` z `lock_timeout`.
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, CREATE TABLE / INDEX IF NOT EXISTS
-- (indeksy nazwane), stary CHECK zdejmowany po nazwie domyślnej (strażnik
-- w bloku DO przerywa, gdy ten sam warunek ma inną nazwę), nowy dodawany
-- tylko, gdy go brak; DROP POLICY IF EXISTS + CREATE; bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_schema_rls_test.sql (CHECK-i odrzucają wartości
-- za długie, `outcome` NULL z pustym powodem i `saved` bez powodu; `started`
-- -> `abandoned` bez powodu przechodzi; RLS i granty); parytet:
-- src/lib/revenue/__tests__/revenueLimitsParity.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Uderzenia w paywall.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.paywall_hits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  day date NOT NULL,
  user_id uuid,
  visitor_hash text CHECK (char_length(visitor_hash) BETWEEN 16 AND 128),
  entity_type text NOT NULL CHECK (entity_type IN ('post','page','media','club','event')),
  entity_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('members','paid','tier_rank','password','quota','registration')),
  required_tier_key text,
  variant text NOT NULL DEFAULT 'default' CHECK (variant ~ '^[a-z0-9_-]{1,32}$'),
  hits integer NOT NULL DEFAULT 1 CHECK (hits >= 1),
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  -- Dokładnie jeden podmiot: zalogowany czytelnik ALBO gość.
  CONSTRAINT paywall_hits_subject_check CHECK ((user_id IS NULL) <> (visitor_hash IS NULL))
);

-- Deduplikacja doby (arbitry `ON CONFLICT` RPC z S3).
CREATE UNIQUE INDEX IF NOT EXISTS paywall_hits_user_uidx
  ON public.paywall_hits (tenant_id, day, user_id, entity_type, entity_id, variant)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS paywall_hits_visitor_uidx
  ON public.paywall_hits (tenant_id, day, visitor_hash, entity_type, entity_id, variant)
  WHERE visitor_hash IS NOT NULL;

-- ----------------------------------------------------------------------------
-- B) Przepływ anulowania: start, wynik, powód dopiero na końcu.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';

ALTER TABLE public.retention_feedback
  ADD COLUMN IF NOT EXISTS flow_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN ('started','saved','canceled','abandoned'));

ALTER TABLE public.retention_feedback ALTER COLUMN reason_label DROP NOT NULL;

-- Stary CHECK powstał bez nazwy (20260722230000, duplikat 20260722223653),
-- więc Postgres nadał mu nazwę domyślną `<tabela>_<kolumna>_check` - zdjęcie
-- po tej nazwie jest deterministyczne. Gdyby na produkcji ten sam warunek żył
-- pod inną nazwą (ręczna naprawa), strażnik niżej PRZERYWA migrację z nazwą
-- ograniczenia zamiast zdejmować je dynamicznym `EXECUTE`: dynamiczne DDL
-- ograniczeń jest zamrożone zapadką `check:on-conflict-arbiters`, a stary
-- CHECK pozostawiony po cichu odrzucałby wiersze `started` dopiero w S2.
ALTER TABLE public.retention_feedback DROP CONSTRAINT IF EXISTS retention_feedback_reason_label_check;

DO $$
DECLARE
  v_left text;
BEGIN
  SELECT string_agg(c.conname, ', ' ORDER BY c.conname) INTO v_left
    FROM pg_constraint c
   WHERE c.conrelid = 'public.retention_feedback'::regclass
     AND c.contype = 'c'
     AND c.conname <> 'retention_feedback_reason_label_required'
     AND pg_get_constraintdef(c.oid) LIKE '%btrim(reason_label)%';
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'retention_feedback: stary CHECK reason_label pod nazwą spoza konwencji (%) - zdejmij go przed wdrożeniem', v_left;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.retention_feedback'::regclass
       AND conname = 'retention_feedback_reason_label_required'
  ) THEN
    ALTER TABLE public.retention_feedback
      ADD CONSTRAINT retention_feedback_reason_label_required
      CHECK (COALESCE(outcome IN ('started','abandoned'), false) OR (reason_label IS NOT NULL AND btrim(reason_label) <> ''))
      NOT VALID;
  END IF;
END $$;

-- Na już zwalidowanym ograniczeniu to no-op.
ALTER TABLE public.retention_feedback VALIDATE CONSTRAINT retention_feedback_reason_label_required;

-- ----------------------------------------------------------------------------
-- C) Okno porzucenia sesji kasy.
-- ----------------------------------------------------------------------------
ALTER TABLE public.checkout_settings
  ADD COLUMN IF NOT EXISTS abandon_after_minutes integer NOT NULL DEFAULT 1440 CHECK (abandon_after_minutes BETWEEN 30 AND 1440);

RESET lock_timeout;

COMMENT ON COLUMN public.retention_feedback.outcome IS
  'Wynik przepływu anulowania: started (powód jeszcze nieznany, reason_label NULL) | saved | canceled (z powodem) | abandoned (porzucony; powód może być NULL). NULL = wiersz sprzed huba (zakończona ankieta).';
COMMENT ON COLUMN public.checkout_settings.abandon_after_minutes IS
  'Po ilu minutach sesja kasy wygasa i liczy się jako porzucona (30-1440; domyślnie 24 h).';

-- ----------------------------------------------------------------------------
-- D) Dane wejściowe planu i kosztów.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_manual_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Pierwszy dzień miesiąca. `extract(day ...)`, a nie `date_trunc`: na typie
  -- `date` date_trunc przechodzi przez timestamptz i zależy od strefy sesji.
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),
  kind text NOT NULL CHECK (kind IN ('mrr_plan','new_customers_plan','sales_marketing_cost','cogs','gross_margin_pct','ebitda_margin_pct')),
  segment text NOT NULL DEFAULT 'all' CHECK (segment IN ('all','b2c_individual','b2c_reduced','b2b_institution')),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint,
  ratio numeric(7,4) CHECK (ratio BETWEEN -1 AND 1),
  -- Za długa notatka jest odrzucana, nie przycinana (licznik w UI = zapis).
  note text CHECK (char_length(note) <= 500),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_manual_inputs_value_check CHECK ((amount_minor IS NULL) <> (ratio IS NULL)),
  CONSTRAINT revenue_manual_inputs_amount_currency_check CHECK (amount_minor IS NULL OR currency IS NOT NULL),
  -- NULLS NOT DISTINCT: stosunek (currency NULL) też ma jeden wiersz na klucz.
  CONSTRAINT revenue_manual_inputs_key UNIQUE NULLS NOT DISTINCT (tenant_id, period_month, kind, segment, currency)
);

DROP TRIGGER IF EXISTS revenue_manual_inputs_set_updated_at ON public.revenue_manual_inputs;
CREATE TRIGGER revenue_manual_inputs_set_updated_at
  BEFORE UPDATE ON public.revenue_manual_inputs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- E) Wyciszenia diagnoz.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_diagnostic_snoozes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  check_id text NOT NULL CHECK (check_id ~ '^[a-z_]+\.[a-z_]+$'),
  scope_key text NOT NULL DEFAULT '*' CHECK (char_length(scope_key) <= 200),
  kind text NOT NULL CHECK (kind IN ('days','intentional')),
  scope_hash text CHECK (char_length(scope_hash) <= 64),
  until timestamptz,
  reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 500),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- `days`: termin najwyżej 180 dni od utworzenia; `intentional`: bez
  -- terminu, ale z odciskiem zakresu (zmiana obiektu zdejmuje wyciszenie)
  -- i z powodem.
  CONSTRAINT revenue_diagnostic_snoozes_term_check CHECK (
    (kind = 'days' AND until IS NOT NULL AND until <= created_at + interval '180 days')
    OR (kind = 'intentional' AND scope_hash IS NOT NULL AND reason IS NOT NULL)
  ),
  CONSTRAINT revenue_diagnostic_snoozes_scope_key UNIQUE (tenant_id, check_id, scope_key)
);

-- ----------------------------------------------------------------------------
-- RLS i granty.
-- ----------------------------------------------------------------------------
ALTER TABLE public.paywall_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_manual_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_diagnostic_snoozes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.paywall_hits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.revenue_manual_inputs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.revenue_diagnostic_snoozes FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.paywall_hits TO service_role;
GRANT ALL ON TABLE public.revenue_manual_inputs TO service_role;
GRANT ALL ON TABLE public.revenue_diagnostic_snoozes TO service_role;

GRANT SELECT ON TABLE public.paywall_hits TO authenticated;
GRANT SELECT ON TABLE public.revenue_manual_inputs TO authenticated;
GRANT SELECT ON TABLE public.revenue_diagnostic_snoozes TO authenticated;

DROP POLICY IF EXISTS paywall_hits_staff_read ON public.paywall_hits;
CREATE POLICY paywall_hits_staff_read ON public.paywall_hits
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.is_admin_or_editor());

DROP POLICY IF EXISTS revenue_manual_inputs_admin_read ON public.revenue_manual_inputs;
CREATE POLICY revenue_manual_inputs_admin_read ON public.revenue_manual_inputs
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS revenue_diagnostic_snoozes_staff_read ON public.revenue_diagnostic_snoozes;
CREATE POLICY revenue_diagnostic_snoozes_staff_read ON public.revenue_diagnostic_snoozes
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.is_admin_or_editor());

COMMENT ON TABLE public.paywall_hits IS
  'Hub lejka: uderzenia w paywall - wiersz na (doba UTC, czytelnik|gość, treść, wariant) z licznikiem. Zapis: RPC S3. Odczyt: admin|editor najemcy.';
COMMENT ON TABLE public.revenue_manual_inputs IS
  'Hub przychodu: plan i koszty per miesiąc × rodzaj × segment × waluta (kwota albo stosunek). Zapis: RPC S2. Odczyt: admin najemcy.';
COMMENT ON TABLE public.revenue_diagnostic_snoozes IS
  'Hub diagnostyki: wyciszenia (days <= 180 dni | intentional z odciskiem i powodem). Zapis: RPC S7. Odczyt: admin|editor najemcy.';
