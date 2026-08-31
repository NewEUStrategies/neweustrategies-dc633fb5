-- Plaszczyzna wlasciciela w module platnosci i czlonkostw: odczyt MUSI wiazac
-- tenanta, nie tylko wlasciciela.
--
-- PRZYCZYNA ZRODLOWA. Migracja 20260829091010 domknela ten sam wzorzec na
-- media_mentions / saved_searches / user_follows. Przeglad polityk obu modulow
-- monetyzacji (kupony/darowizny/prezenty/reklamy oraz checkout/subskrypcje/
-- billing) pokazal SZESC pozostalych wystapien - wszystkie na kolumnie SELECT,
-- wszystkie na tabelach, ktore maja tenant_id i ktorych RODZENSTWO polityk
-- (odczyt administracyjny) tenanta juz pilnuje:
--
--   subscriptions::"Users can view own subscription"  using ((select auth.uid()) = user_id)
--   membership_grants::"grants own read"              using (user_id = (select auth.uid()))
--   organization_seats::"seats own read"              using (user_id = (select auth.uid()))
--   user_purchases::"purchases owner read"            galaz wlasciciela bez tenanta
--   user_subscriptions::"subs owner read"             galaz wlasciciela bez tenanta
--   post_gift_links::"gift links owner read"           galaz created_by bez tenanta
--
-- DLACZEGO BRAMKI TEGO NIE ZLAPALY. `check:sql-owner-tenant-scope` jest
-- samokalibrujaca: zapala sie, gdy na TEJ SAMEJ tabeli jedna klauzula
-- WLASCICIELSKA wiaze tenanta, a inna go gubi. Tutaj kazda z tych tabel ma
-- DOKLADNIE JEDNA polityke wlascicielska, a tenanta pilnuje polityka
-- ADMINISTRACYJNA - czyli nie ma rodzenstwa, ktore deklaruje intencje. Luka
-- jest wiec poza zasiegiem tamtej bramki z konstrukcji, nie przez przeoczenie.
--
-- SKUTEK PRZED NAPRAWA (dryf profilu): wiersz zalozony w tenancie A pozostawal
-- czytelny dla swojego wlasciciela po przepieciu profilu do tenanta B - czyli
-- historia zakupow, subskrypcji i przydzialow czlonkostwa przeciekala przez
-- granice obszaru roboczego. Zapis byl juz wczesniej zamkniety (service_role /
-- polityki administracyjne), wiec naprawa dotyczy kolumny odczytu.
--
-- KSZTALT PREDYKATU jest ten sam, co w 20260829091010:
--   user_id = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id())
-- Podzapytanie w `SELECT` jest celowe - Postgres liczy je RAZ na zapytanie
-- (InitPlan), a nie per wiersz.

-- subscriptions ---------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

-- membership_grants -----------------------------------------------------------
DROP POLICY IF EXISTS "grants own read" ON public.membership_grants;
CREATE POLICY "grants own read" ON public.membership_grants
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

-- organization_seats ----------------------------------------------------------
DROP POLICY IF EXISTS "seats own read" ON public.organization_seats;
CREATE POLICY "seats own read" ON public.organization_seats
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

-- user_purchases --------------------------------------------------------------
-- Galaz administracyjna zostaje bez zmian - ona tenanta juz wiazala.
DROP POLICY IF EXISTS "purchases owner read" ON public.user_purchases;
CREATE POLICY "purchases owner read"
  ON public.user_purchases FOR SELECT TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id()))
    OR (
      tenant_id = (SELECT public.current_tenant_id())
      AND has_role((SELECT auth.uid()), 'admin'::app_role)
    )
  );

-- user_subscriptions ----------------------------------------------------------
DROP POLICY IF EXISTS "subs owner read" ON public.user_subscriptions;
CREATE POLICY "subs owner read"
  ON public.user_subscriptions FOR SELECT TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id()))
    OR (
      tenant_id = (SELECT public.current_tenant_id())
      AND has_role((SELECT auth.uid()), 'admin'::app_role)
    )
  );

-- post_gift_links --------------------------------------------------------------
-- Plaszczyzna prezentow (modul 14): wlascicielem linku jest created_by, nie
-- user_id, wiec ta luka jest niewidoczna dla heurystyki nazwy kolumny - a klasa
-- jest ta sama. Galaz redakcyjna (admin/editor) tenanta juz wiazala.
DROP POLICY IF EXISTS "gift links owner read" ON public.post_gift_links;
CREATE POLICY "gift links owner read"
  ON public.post_gift_links FOR SELECT
  TO authenticated
  USING (
    (created_by = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id()))
    OR (
      tenant_id = (SELECT public.current_tenant_id())
      AND (has_role((SELECT auth.uid()), 'admin'::app_role) OR has_role((SELECT auth.uid()), 'editor'::app_role))
    )
  );

-- payment_webhook_events: ROZSTRZYGNIECIE kwestii tenant_id ---------------------
-- Kolumna JEST i jest NOT NULL od migracji 20260824080046 (default
-- public.email_default_tenant_id() + trigger payment_webhook_events_bind_tenant
-- wiazacy tenanta z profilu platnika). Komentarz z migracji 20260730085737
-- ("platform-level only (no tenant_id column)") jest od tamtej pory NIEPRAWDZIWY
-- i wprowadzal w blad kazdy kolejny przeglad polityk.
--
-- Polityka odczytu zostaje przy public.is_super_admin() BEZ predykatu tenanta i
-- jest to decyzja, nie przeoczenie: super admin jest rola PLATFORMOWA (ponad
-- obszarami roboczymi), a jej zadaniem na tej tabeli jest diagnostyka dostawcy
-- platnosci - w tym zdarzen, ktorych tenanta nie da sie jeszcze rozstrzygnac
-- (webhook przed powiazaniem platnika). Zawezenie do current_tenant_id()
-- schowaloby przed diagnostyka dokladnie te wiersze, dla ktorych jej potrzeba.
-- Zaden inny podmiot nie ma tu polityki odczytu, wiec granica obszaru roboczego
-- nie zalezy od tej tabeli.
COMMENT ON COLUMN public.payment_webhook_events.tenant_id IS
  'Tenant platnika (NOT NULL, default email_default_tenant_id(), wiazany triggerem payment_webhook_events_bind_tenant). Sluzy indeksowaniu i raportom per obszar roboczy. Polityka odczytu celowo NIE zaweza po tenancie: jedyny podmiot czytajacy to super admin (rola platformowa), ktory diagnozuje takze zdarzenia sprzed powiazania platnika.';
