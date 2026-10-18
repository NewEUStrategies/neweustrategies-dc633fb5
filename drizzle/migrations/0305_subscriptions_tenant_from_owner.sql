-- ============================================================================
-- SUBSKRYPCJE: NAJEMCA Z PROFILU WLASCICIELA, NIE Z NAGLOWKA HOSTA.
--
-- DEFEKT (szew rola serwisowa <-> najemca). `subscriptions.tenant_id` ma
-- DEFAULT public_tenant_id() (20260729072626:3), czyli najemce z naglowka hosta
-- zadania. Jedyny pisarz tej tabeli to webhook operatora platnosci
-- (`src/lib/billing/webhookDispatch.server.ts`, `handleCreated`), ktory upsertuje
-- wiersz klientem roli serwisowej BEZ `tenant_id` - a pod rola serwisowa nie ma
-- naglowka hosta, wiec public_tenant_id() wraca do najemcy DOMYSLNEGO. Kazda
-- subskrypcja konta z najemcy innego niz domyslny trafiala wiec do domyslnego:
-- panele, uzgadnianie, zwroty i dunning filtrujace po najemcy jej nie widzialy,
-- a najemca domyslny widzial cudze. Ta sama klasa co verify_content_password
-- (20261007120400) i push_subscriptions (20260914090000).
--
-- ZMIANA (wzorzec push_subscriptions_pin_tenant, 20260914090000:118-142):
--   1. trigger BEFORE INSERT (i UPDATE OF user_id) przypina tenant_id do
--      profiles.tenant_id WLASCICIELA wiersza (NEW.user_id); brak profilu
--      zostawia wartosc, ktora wiersz juz ma (zapis platnosci nigdy sie nie
--      wywraca). SECURITY DEFINER wylacznie dla odczytu `profiles` (jako
--      INVOKER podlegalby RLS profilu i cicho zwracalby NULL);
--   2. jednorazowe uzgodnienie istniejacych wierszy do najemcy profilu
--      wlasciciela (no-op w instalacji z jednym najemca).
--
-- KOLEJNOSC WDROZENIA: dowolna (kod sie nie zmienia).
-- IDEMPOTENTNA: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, UPDATE warunkowy.
-- DOWOD: supabase/tests/subscriptions_tenant_pin_test.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.subscriptions_pin_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT p.tenant_id INTO v_tenant
    FROM public.profiles p
   WHERE p.id = NEW.user_id;
  IF v_tenant IS NOT NULL THEN
    NEW.tenant_id := v_tenant;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.subscriptions_pin_tenant() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.subscriptions_pin_tenant() IS
  'Przypina subscriptions.tenant_id do profiles.tenant_id WLASCICIELA (NEW.user_id) przy INSERT i zmianie user_id. Pisarzem jest webhook platnosci pod rola serwisowa, gdzie DEFAULT public_tenant_id() zwraca najemce domyslnego. Brak profilu zostawia wartosc dotychczasowa.';

DROP TRIGGER IF EXISTS subscriptions_pin_tenant ON public.subscriptions;
CREATE TRIGGER subscriptions_pin_tenant
  BEFORE INSERT OR UPDATE OF user_id ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_pin_tenant();

-- Uzgodnienie istniejacych wierszy: tylko te, ktorych najemca rozni sie od
-- najemcy profilu wlasciciela.
UPDATE public.subscriptions s
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE p.id = s.user_id
   AND p.tenant_id IS NOT NULL
   AND s.tenant_id IS DISTINCT FROM p.tenant_id;
