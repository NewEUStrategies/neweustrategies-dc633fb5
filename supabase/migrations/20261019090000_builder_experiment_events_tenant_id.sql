-- ============================================================================
-- ZDARZENIA TESTÓW A/B: NAJEMCA W DANYCH, NIE TYLKO W POLITYCE.
--
-- DEFEKT. `builder_experiment_events` nie ma kolumny `tenant_id` - jako jedyna
-- tabela rodziny `builder_*` (popups, global_widgets i experiments niosą ją
-- z FK do `tenants`). Izolację najemców trzymają WYŁĄCZNIE polityki RLS przez
-- EXISTS na eksperymencie nadrzędnym (`e.id = experiment_id AND e.tenant_id =
-- current_tenant_id()`). Rola serwisowa (beacon /api/public/experiment-event)
-- omija RLS i nie ma drugiej linii obrony: zapytanie, które zgubi warunek na
-- eksperymencie, liczy zdarzenia WSZYSTKICH najemców. Panel
-- (`useExperimentStats`) nie ma też czym zawęzić liczników po najemcy sesji
-- - zostaje mu wyłącznie polityka.
--
-- STAN POLITYK PRZED TĄ MIGRACJĄ (przegląd każdej migracji dotykającej tabeli):
--   * 20260702114108 - pakiet, z którego tabela powstała na produkcji (kolumny
--     na enumach builder_ab_variant / builder_experiment_event, jak w types.ts):
--       "experiment events tenant admin read"    SELECT  is_staff()
--       "experiment events tenant admin delete"  DELETE  admin | super_admin
--     obie przez EXISTS na eksperymencie w current_tenant_id();
--   * 20260702085900 - na produkcji oznaczona jako zastosowana bez wykonania
--     (nota w tym pliku), w odtworzeniu od zera wykonywana PRZED pakietem:
--       bxe_read_tenant / bxe_delete_tenant - KAŻDY zalogowany członek
--     najemcy, ten sam EXISTS;
--   * polityki INSERT zdjęte (20260708120000, 20260730135929, 20260730140000);
--     INSERT/UPDATE odebrane anon i authenticated - jedynym piszącym jest
--     beacon jako service_role.
--
-- DECYZJA.
--   1. Kolumna `tenant_id uuid` z FK do `tenants(id) ON DELETE CASCADE` (jak
--      `builder_experiments` i `builder_popups`), backfill z eksperymentu
--      przez `experiment_id`, potem NOT NULL. BEZ DEFAULT: jedynym źródłem
--      najemcy jest eksperyment - nie sesja piszącego i nie ładunek.
--   2. Trigger BEFORE INSERT OR UPDATE OF experiment_id, tenant_id wyprowadza
--      najemcę z eksperymentu i NADPISUJE wartość z ładunku: podany
--      `tenant_id` obcego najemcy nie ma żadnego znaczenia. Funkcja SECURITY
--      INVOKER - piszą wyłącznie service_role i właściciel, a obaj widzą
--      eksperyment bez RLS; definer niczego by tu nie dodał poza powierzchnią.
--      Nieistniejący eksperyment kończy się 23503, a nie mylącym NOT NULL.
--   3. Przeniesienie eksperymentu do innego najemcy przepina jego zdarzenia
--      (AFTER UPDATE OF tenant_id na `builder_experiments`). Osiągalne tylko
--      dla roli serwisowej - polityki UPDATE eksperymentów wymagają
--      tenant_id = current_tenant_id() po obu stronach - ale bez tego
--      polityki oparte na `tenant_id` zdarzenia zostawiłyby je staremu
--      najemcy.
--   4. Polityki SELECT/DELETE przepięte na bezpośredni warunek
--      `tenant_id = current_tenant_id()` z ZACHOWANIEM dzisiejszych warunków
--      ról. Przepinamy WYŁĄCZNIE polityki, które w danej bazie istnieją
--      (pg_policies): produkcja nie dostaje bxe_* z 20260702085900, a baza
--      odtworzona od zera ich nie traci. Dostęp ani się nie poszerza, ani nie
--      zawęża - dochodzi jedynie bezpośredni warunek najemcy.
--   5. Indeks prowadzony `tenant_id` (tenant_id, experiment_id, variant, event)
--      pod liczniki panelu i polityki. Indeksy (experiment_id, variant, event)
--      zostają - obsługują kaskadę FK z `builder_experiments`.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261018150000 (pas drizzle: 0312). Migracja PRZED
-- kodem tego wydania - kod zawęża liczniki `.eq("tenant_id", ...)` i wstawia
-- `tenant_id` z wiersza eksperymentu, a bez kolumny oba zapytania kończą się
-- błędem PostgREST. Stary kod działa na nowej bazie: INSERT bez `tenant_id`
-- dostaje najemcę z triggera (NOT NULL sprawdzany jest PO triggerze BEFORE).
-- Trigger powstaje PRZED backfillem, więc także wykonanie poza transakcją nie
-- zostawia okna, w którym nowy wiersz wchodzi bez najemcy.
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, backfill wyłącznie rozbieżnych
-- wierszy, CREATE OR REPLACE FUNCTION, DROP ... IF EXISTS + CREATE, CREATE
-- INDEX IF NOT EXISTS; SET NOT NULL na kolumnie już NOT NULL jest no-opem.
-- DOWÓD: supabase/tests/builder_experiment_events_tenant_id_test.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Kolumna (NOT NULL dopiero po backfillu)
-- ---------------------------------------------------------------------------
ALTER TABLE public.builder_experiment_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Najemca wyprowadzany z eksperymentu, wartość z ładunku nadpisana
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builder_experiment_events_bind_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT e.tenant_id INTO v_tenant
    FROM public.builder_experiments e
   WHERE e.id = NEW.experiment_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'builder_experiment_events: eksperyment % nie istnieje', NEW.experiment_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.builder_experiment_events_bind_tenant() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.builder_experiment_events_bind_tenant() IS
  'Trigger: tenant_id zdarzenia A/B zawsze z builder_experiments.tenant_id (experiment_id); wartosc z ladunku jest nadpisywana.';

DROP TRIGGER IF EXISTS trg_builder_experiment_events_bind_tenant ON public.builder_experiment_events;
CREATE TRIGGER trg_builder_experiment_events_bind_tenant
  BEFORE INSERT OR UPDATE OF experiment_id, tenant_id ON public.builder_experiment_events
  FOR EACH ROW EXECUTE FUNCTION public.builder_experiment_events_bind_tenant();

-- ---------------------------------------------------------------------------
-- 3. Przeniesienie eksperymentu przepina jego zdarzenia
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builder_experiments_cascade_tenant_to_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.builder_experiment_events ev
     SET tenant_id = NEW.tenant_id
   WHERE ev.experiment_id = NEW.id
     AND ev.tenant_id IS DISTINCT FROM NEW.tenant_id;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.builder_experiments_cascade_tenant_to_events() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.builder_experiments_cascade_tenant_to_events() IS
  'Trigger: zmiana builder_experiments.tenant_id przepina tenant_id wszystkich zdarzen eksperymentu.';

DROP TRIGGER IF EXISTS trg_builder_experiments_cascade_tenant_to_events ON public.builder_experiments;
CREATE TRIGGER trg_builder_experiments_cascade_tenant_to_events
  AFTER UPDATE OF tenant_id ON public.builder_experiments
  FOR EACH ROW
  WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
  EXECUTE FUNCTION public.builder_experiments_cascade_tenant_to_events();

-- ---------------------------------------------------------------------------
-- 4. Backfill i NOT NULL
-- ---------------------------------------------------------------------------
-- `experiment_id` jest NOT NULL z FK ON DELETE CASCADE, więc każde zdarzenie
-- ma eksperyment; wiersz bez najemcy po backfillu oznaczałby naruszenie tego
-- kontraktu i SET NOT NULL słusznie by go zatrzymał.
UPDATE public.builder_experiment_events ev
   SET tenant_id = e.tenant_id
  FROM public.builder_experiments e
 WHERE e.id = ev.experiment_id
   AND ev.tenant_id IS DISTINCT FROM e.tenant_id;

ALTER TABLE public.builder_experiment_events
  ALTER COLUMN tenant_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Indeks prowadzony najemcą
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS builder_experiment_events_tenant_lookup_idx
  ON public.builder_experiment_events (tenant_id, experiment_id, variant, event);

COMMENT ON INDEX public.builder_experiment_events_tenant_lookup_idx IS
  'Liczniki panelu A/B (tenant_id, experiment_id, variant, event) i polityki SELECT/DELETE po tenant_id.';

-- ---------------------------------------------------------------------------
-- 6. Polityki: bezpośredni warunek najemcy, warunki ról bez zmian
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'builder_experiment_events'
                AND policyname = 'experiment events tenant admin read') THEN
    DROP POLICY IF EXISTS "experiment events tenant admin read" ON public.builder_experiment_events;
    CREATE POLICY "experiment events tenant admin read"
      ON public.builder_experiment_events FOR SELECT TO authenticated
      USING (tenant_id = public.current_tenant_id() AND public.is_staff());
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'builder_experiment_events'
                AND policyname = 'experiment events tenant admin delete') THEN
    DROP POLICY IF EXISTS "experiment events tenant admin delete" ON public.builder_experiment_events;
    CREATE POLICY "experiment events tenant admin delete"
      ON public.builder_experiment_events FOR DELETE TO authenticated
      USING (tenant_id = public.current_tenant_id()
             AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')));
  END IF;

  -- Wyłącznie baza odtworzona od zera (20260702085900): każdy członek
  -- najemcy, bez warunku roli - tak jak dziś.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'builder_experiment_events'
                AND policyname = 'bxe_read_tenant') THEN
    DROP POLICY IF EXISTS "bxe_read_tenant" ON public.builder_experiment_events;
    CREATE POLICY "bxe_read_tenant"
      ON public.builder_experiment_events FOR SELECT TO authenticated
      USING (tenant_id = public.current_tenant_id());
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'builder_experiment_events'
                AND policyname = 'bxe_delete_tenant') THEN
    DROP POLICY IF EXISTS "bxe_delete_tenant" ON public.builder_experiment_events;
    CREATE POLICY "bxe_delete_tenant"
      ON public.builder_experiment_events FOR DELETE TO authenticated
      USING (tenant_id = public.current_tenant_id());
  END IF;
END $$;
