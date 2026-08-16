-- ============================================================================
-- Izolacja najemców w publicznym odczycie katalogu obszarów tematycznych
-- klubów (`club_topics`).
--
-- Finding: polityka `club_topics_public_read` (20260808100202) stała na
-- USING (true) - bez wiązania z najemcą. Każdy anon/authenticated czytał
-- etykiety obszarów WSZYSTKICH organizacji (wraz z `tenant_id` i flagami
-- katalogu), wbrew wzorcowi izolacji z bliźniaczego katalogu
-- `club_specializations` (20260811110015), którego polityka public read
-- wiąże wiersz z `tenant_id = COALESCE(_caller_tenant(), public_tenant_id())`.
--
-- Ta sama klasa wycieku siedziała w SECURITY DEFINER RPC
-- `club_topics_active()`: warunek
--     ct.tenant_id = COALESCE(public._caller_tenant(), ct.tenant_id)
-- dla anon (`_caller_tenant()` = NULL) degeneruje się do tautologii
-- `ct.tenant_id = ct.tenant_id`, więc RPC zwracał aktywne obszary wszystkich
-- najemców naraz. SECURITY DEFINER omija RLS, więc bez poprawki ciała funkcji
-- zmiana samej polityki byłaby martwą literą.
--
-- Wzorzec docelowy (identyczny jak na `club_specializations`):
--   * zalogowany czyta katalog SWOJEGO tenanta (`_caller_tenant()`),
--   * anon czyta katalog tenanta PUBLICZNEGO rozstrzyganego z nagłówka
--     x-tenant-host (`public_tenant_id()`, host-aware od 20260703120000).
--
-- Panel administracyjny nie korzysta z tej ścieżki - RPC `admin_club_topic*`
-- są SECURITY DEFINER z bramką `assert_admin_tenant()`.
-- ============================================================================

-- `_caller_tenant()` jest wyliczane wewnątrz polityk przez role klienckie,
-- ale 20260718215759 odebrało funkcji EXECUTE od PUBLIC i żadna migracja nie
-- nadała go z powrotem. Postgres sprawdza EXECUTE zanim wejdzie w SECURITY
-- DEFINER, więc bezpośredni odczyt/zapis pod polityką odwołującą się do
-- funkcji (club_specializations_public_read, club_topics_admin_*) kończył
-- się "permission denied for function _caller_tenant". Funkcja zwraca
-- wyłącznie tenant_id WŁASNEGO profilu wołającego (auth.uid(); dla anon
-- NULL) - grant niczego nie odsłania.
REVOKE ALL ON FUNCTION public._caller_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._caller_tenant() TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "club_topics_public_read" ON public.club_topics;
CREATE POLICY "club_topics_public_read"
  ON public.club_topics FOR SELECT
  TO anon, authenticated
  USING (tenant_id = COALESCE(public._caller_tenant(), public.public_tenant_id()));

-- To samo wiązanie w publicznym RPC katalogu (granty EXECUTE bez zmian -
-- CREATE OR REPLACE je zachowuje).
CREATE OR REPLACE FUNCTION public.club_topics_active()
RETURNS TABLE (
  key text,
  label_pl text,
  label_en text,
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ct.key, ct.label_pl, ct.label_en, ct.sort_order
  FROM public.club_topics ct
  WHERE ct.is_active
    AND ct.tenant_id = COALESCE(public._caller_tenant(), public.public_tenant_id())
  ORDER BY ct.sort_order, ct.key;
$$;
