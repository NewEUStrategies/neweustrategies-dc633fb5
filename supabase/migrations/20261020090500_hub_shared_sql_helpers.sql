-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I0, 6/6): WSPÓLNE HELPERY SQL - ŚLAD AWARII
-- EMITERÓW, RANGA WARSTWY, DOMYŚLNE LICZNIKA, SEGMENT WARSTWY.
--
-- DEFEKT
--   1. Emitery zdarzeń domenowych łapią każdy błąd (`EXCEPTION WHEN OTHERS`)
--      i połykają go bez śladu - zapis biznesowy przechodzi, a zdarzenie
--      znika. Panel pokazuje nieaktualne dane i nikt nie wie dlaczego.
--   2. Rangę warstwy (`membership_tiers.rank`) każda funkcja czyta własnym
--      zapytaniem; część po hoście, część po sesji.
--   3. Domyślne ustawienia licznika artykułów żyją w trzech miejscach
--      (domyślne kolumn, `DEFAULT_METERING_SETTINGS` w TS, UI) i mogą się
--      rozjechać - UI pokazywał „włączony, 5" przy braku wiersza.
--   4. Segment przychodu (B2C indywidualny / ulgowy / instytucje) wynika
--      z klucza warstwy, ale nie ma jednej definicji wspólnej dla SQL i TS.
--
-- ZMIANA
--   A. `domain_event_emit_errors` + `_log_emit_error(p_tenant, p_source,
--      p_event_type, p_sqlstate DEFAULT NULL, p_error DEFAULT NULL)`.
--      KONTRAKT DLA EMITERÓW S1-S5: w bloku
--        EXCEPTION WHEN OTHERS THEN
--          PERFORM public._log_emit_error(<tenant>, '<funkcja>', '<typ>', SQLSTATE, SQLERRM);
--          RETURN NEW;
--      Parametry z wartością domyślną, bo PL/pgSQL widzi `SQLSTATE`/`SQLERRM`
--      wyłącznie w handlerze TEJ SAMEJ funkcji - wywołana funkcja nie ma do
--      nich dostępu (wywołanie trójargumentowe ze specyfikacji jest nadal
--      poprawne i zapisuje `error = 'unknown'`). Emiter musi być SECURITY
--      DEFINER: `_log_emit_error` nie ma EXECUTE dla ról API.
--      Komunikat dłuższy niż 2000 znaków NIE jest przycinany - zapisuje się
--      znacznik `message_too_long` (z zachowanym `sqlstate`), a źródło
--      dłuższe niż 120 znaków - `source_too_long`: przycięty komunikat
--      udawałby pełną diagnozę, a odrzucony wiersz zgubiłby awarię.
--      Sam helper jest w `EXCEPTION WHEN OTHERS THEN NULL` - log nigdy nie
--      psuje zapisu, który go wywołał. Odczyt tabeli: admin najemcy (własne
--      wiersze); bez gałęzi `is_nes_staff()` ze specyfikacji - uzasadnienie
--      przy polityce niżej.
--   B. `_tier_rank_of(p_tenant, p_tier_key)` - ranga warstwy najemcy
--      (wewnętrzny: bez EXECUTE dla ról API, może przyjąć najemcę);
--      `tier_rank_of(p_tier_key)` - to samo dla najemcy z SESJI (nigdy
--      z parametru ani z nagłówka hosta).
--   C. `metering_defaults()` - jedno źródło domyślnych licznika, porównywane
--      testem parytetu z `METERING_DEFAULTS` (TS), `DEFAULT_METERING_SETTINGS`
--      i domyślnymi kolumn `metering_settings`.
--   D. `revenue_segment_of_tier(p_tier_key)` - lustro
--      `REVENUE_SEGMENT_BY_TIER` (src/lib/revenue/segments.ts, test parytetu).
--      Klucze spoza mapy (ngo, vip, partnerzy, reader, supporter,
--      decision_lab, nieznane, NULL) -> 'other'.
--   Granty w tej migracji: REVOKE ALL dla PUBLIC, anon, authenticated (helpery
--   wewnętrzne także service_role); EXECUTE: `tier_rank_of` -> authenticated,
--   service_role; `metering_defaults` -> service_role (test parytetu).
--
-- KOLEJNOŚĆ WDROŻENIA: dowolna - nowe obiekty, nikt ich jeszcze nie woła.
-- Emitery S1-S5 wymagają tej migracji (wersja < ich bloków).
-- IDEMPOTENTNA: CREATE TABLE / INDEX IF NOT EXISTS (indeksy nazwane),
-- CREATE OR REPLACE FUNCTION (sygnatury nowe - bez CIALO-Z), DROP POLICY IF
-- EXISTS + CREATE, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_shared_helpers_test.sql; parytety:
-- src/lib/revenue/__tests__/segmentsParity.test.ts,
-- src/lib/access/__tests__/meteringDefaultsParity.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Ślad awarii emiterów.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.domain_event_emit_errors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- NULL-owalny: awaria mogła wystąpić, zanim najemca był znany.
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Nazwa funkcji emitera.
  source text NOT NULL CHECK (char_length(source) <= 120),
  event_type text NOT NULL,
  sqlstate text,
  error text NOT NULL CHECK (char_length(error) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS domain_event_emit_errors_created_idx
  ON public.domain_event_emit_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS domain_event_emit_errors_tenant_created_idx
  ON public.domain_event_emit_errors (tenant_id, created_at DESC);

ALTER TABLE public.domain_event_emit_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.domain_event_emit_errors FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.domain_event_emit_errors TO service_role;
GRANT SELECT ON TABLE public.domain_event_emit_errors TO authenticated;

-- Odczyt: wyłącznie admin najemcy z sesji, tylko własne wiersze. CELOWO bez
-- gałęzi `is_nes_staff()` ze specyfikacji: ta funkcja NIE wiąże najemcy
-- (prawda dla admina, editora i autora DOWOLNEGO najemcy w jego tenancie
-- domowym albo dla adresu w domenie NES), więc `is_nes_staff() OR ...`
-- dawałoby każdemu redaktorowi każdego najemcy odczyt awarii wszystkich
-- najemców. Wiersze bez najemcy (awaria przed jego ustaleniem) czyta
-- wyłącznie service_role (server fn z bramką sztabu).
DROP POLICY IF EXISTS domain_event_emit_errors_admin_read ON public.domain_event_emit_errors;
CREATE POLICY domain_event_emit_errors_admin_read ON public.domain_event_emit_errors
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND public.has_role((SELECT auth.uid()), 'admin'::app_role));

COMMENT ON TABLE public.domain_event_emit_errors IS
  'Ślad awarii emiterów zdarzeń domenowych (zapis wyłącznie przez _log_emit_error). Odczyt: admin najemcy (własne wiersze); wiersze bez najemcy - tylko service_role.';

CREATE OR REPLACE FUNCTION public._log_emit_error(
  p_tenant uuid,
  p_source text,
  p_event_type text,
  p_sqlstate text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source text := CASE
    WHEN p_source IS NULL THEN 'unknown'
    WHEN char_length(p_source) > 120 THEN 'source_too_long'
    ELSE p_source
  END;
  v_error text := CASE
    WHEN p_error IS NULL THEN 'unknown'
    WHEN char_length(p_error) > 2000 THEN 'message_too_long'
    ELSE p_error
  END;
BEGIN
  BEGIN
    INSERT INTO public.domain_event_emit_errors (tenant_id, source, event_type, sqlstate, error)
    VALUES (p_tenant, v_source, COALESCE(p_event_type, 'unknown'), p_sqlstate, v_error);
  EXCEPTION WHEN foreign_key_violation THEN
    -- Najemca zniknął w tej samej transakcji: ślad bez powiązania jest
    -- lepszy niż brak śladu.
    INSERT INTO public.domain_event_emit_errors (tenant_id, source, event_type, sqlstate, error)
    VALUES (NULL, v_source, COALESCE(p_event_type, 'unknown'), p_sqlstate, v_error);
  END;
EXCEPTION WHEN OTHERS THEN
  -- Log nigdy nie psuje zapisu, który go wywołał.
  NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._log_emit_error(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._log_emit_error(uuid, text, text, text, text) IS
  'Hub: zapis awarii emitera do domain_event_emit_errors; emitery przekazują SQLSTATE, SQLERRM. Nigdy nie rzuca; za długi komunikat -> message_too_long (bez przycinania). Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- B) Ranga warstwy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tier_rank_of(p_tenant uuid, p_tier_key text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Ranga jest cechą warstwy, nie jej sprzedaży: warstwa nieaktywna nadal
  -- wyznacza próg treści, które ją wymagają.
  SELECT mt.rank
    FROM public.membership_tiers mt
   WHERE mt.tenant_id = p_tenant
     AND mt.key = p_tier_key
$$;

REVOKE ALL ON FUNCTION public._tier_rank_of(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._tier_rank_of(uuid, text) IS
  'Hub: ranga warstwy p_tier_key najemcy p_tenant (NULL = brak warstwy). Wewnętrzny: bez EXECUTE dla ról API.';

CREATE OR REPLACE FUNCTION public.tier_rank_of(p_tier_key text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Najemca z sesji (tenant domowy), nigdy z parametru ani z nagłówka hosta.
  SELECT public._tier_rank_of((SELECT public.current_tenant_id()), p_tier_key)
$$;

REVOKE ALL ON FUNCTION public.tier_rank_of(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tier_rank_of(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.tier_rank_of(text) IS
  'Hub: ranga warstwy p_tier_key w najemcy wywołującego (current_tenant_id()). NULL = brak warstwy albo brak sesji.';

-- ----------------------------------------------------------------------------
-- C) Domyślne licznika artykułów.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.metering_defaults()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('enabled', true, 'member_monthly_limit', 5, 'anon_monthly_limit', 0, 'meter_paid', true, 'meter_members', true, 'show_counter', true)
$$;

REVOKE ALL ON FUNCTION public.metering_defaults() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metering_defaults() TO service_role;

COMMENT ON FUNCTION public.metering_defaults() IS
  'Hub: domyślne ustawienia licznika (= METERING_DEFAULTS w TS i domyślne kolumn metering_settings; test parytetu). EXECUTE tylko service_role.';

-- ----------------------------------------------------------------------------
-- D) Segment przychodu warstwy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revenue_segment_of_tier(p_tier_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_tier_key IN ('student','educator') THEN 'b2c_reduced'
              WHEN p_tier_key IN ('member','pro') THEN 'b2c_individual'
              WHEN p_tier_key IN ('team','business','corporate') THEN 'b2b_institution'
              ELSE 'other' END
$$;

REVOKE ALL ON FUNCTION public.revenue_segment_of_tier(text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.revenue_segment_of_tier(text) IS
  'Hub: segment przychodu warstwy (lustro REVENUE_SEGMENT_BY_TIER; reszta -> other). Wewnętrzny: bez EXECUTE dla ról API.';
