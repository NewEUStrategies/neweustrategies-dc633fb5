-- migrations-mirror: supabase/migrations/20261117014500_crm_companies_aggregates_definer.sql
-- WYGENEROWANE przez `bun run migrations:mirror` z pliku wyzej - NIE EDYTUJ RECZNIE.
-- Zrodlo prawdy schematu: supabase/migrations. Ten plik to kopia dostawcza dla
-- migratora Drizzle platformy Lovable (drizzle.config.ts); bramka
-- check:migration-lanes pilnuje, ze jego SQL wykonywalny == zrodlo.

-- Firmy CRM: liczniki listy (`crm_companies_aggregates`) jako SECURITY DEFINER
-- z bramka staffu i najemca z sesji. Druga, osobna czesc pliku (na koncu):
-- wycofanie nieuzywanej `crm_funnel_stats()` - zero EXECUTE poza wlascicielem.
--
-- PRZYCZYNA. `listCrmCompanies` (src/lib/crm-companies.functions.ts) wola
-- `crm_companies_aggregates(_company_ids)` klientem staffu CRM. Funkcja byla
-- SQL SECURITY INVOKER, a jej CTE `contacts` czyta `profiles.current_company_id`.
-- Ta kolumna nie ma grantu SELECT dla `authenticated` (dodana w 20260721200229
-- przed odebraniem grantow kolumnowych poprawka PII 20260724090100), wiec
-- planer odrzucal CALE zapytanie kodem 42501, `aggError` byl rzucany, a lista
-- firm CRM padala za kazdym razem, gdy miala choc jedna firme.
--
-- DLACZEGO NIE ODCZYT SPOD SERVICE-ROLE. Cialo funkcji nie wola ani
-- `auth.uid()`, ani `current_tenant_id()` - granice najemcy dawal wylacznie RLS
-- wolajacego na `crm_leads` i `profiles`. Pod service-role (RLS wylaczone)
-- liczylaby leady i profile WSZYSTKICH najemcow wskazujace na firme, a obce
-- odwolania sa mozliwe: klucze `crm_leads.company_id` i
-- `profiles.current_company_id` wskazuja samo `crm_companies(id)`, bez pary
-- z `tenant_id`, a straznik `profiles_guard_privileged_columns` pozwala
-- staffowi najemcy B przypiac profil B do firmy najemcy A. Lista A pokazalaby
-- wtedy liczbe i date aktywnosci cudzych wierszy - i inna liczbe kontaktow niz
-- karta firmy, ktora od 0f81e346 filtruje profile po najemcy wolajacego.
--
-- DLACZEGO NIE GRANT. Otwarcie `profiles.current_company_id` dla
-- `authenticated` odslanialoby przynaleznosc firmowa kazdego profilu widocznego
-- pod RLS (wlasny profil, staff - caly najemca) zwyklym zapytaniem PostgREST.
-- Funkcja oddaje wylacznie liczby i date ostatniej aktywnosci leadow.
--
-- ZAKRES (odtwarza intencje RLS jawnie, bo SECURITY DEFINER ja omija):
--   * bramka roli jak polityka `crm_companies_staff_read` i `requireCrmStaff`:
--     admin, editor albo super_admin w najemcy domowym (`has_role` liczy role
--     w `current_tenant_id()`); inny wolajacy dostaje 42501, anon nie ma EXECUTE;
--   * najemca WYLACZNIE z sesji (`current_tenant_id()` = profil wolajacego),
--     nigdy z parametru; firmy spoza tego najemcy wypadaja z wyniku (klient
--     mapuje po `company_id` z zerem jako wartoscia domyslna);
--   * leady i profile liczone tylko z TEGO SAMEGO najemcy co firma - takze dla
--     super_admina, ktorego polityka leadow (`OR is_super_admin()`) przepuszcza
--     ponad najemcami: obcy wiersz nie zmienia licznikow listy.
--
-- Sygnatura i ksztalt wyniku bez zmian (`CREATE OR REPLACE`), wiec
-- wygenerowane typy i wywolanie w kodzie zostaja. Bezpieczna do ponownego
-- wykonania: CREATE OR REPLACE, granty i REVOKE bez zalozen o stanie. Nie
-- dotyka tabel ani danych.

CREATE OR REPLACE FUNCTION public.crm_companies_aggregates(_company_ids uuid[])
RETURNS TABLE (
  company_id uuid,
  leads_count bigint,
  last_lead_activity_at timestamptz,
  contacts_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'crm_companies_aggregates: unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role(v_uid, 'admin'::public.app_role)
    OR public.has_role(v_uid, 'editor'::public.app_role)
    OR public.has_role(v_uid, 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'crm_companies_aggregates: forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'crm_companies_aggregates: tenant unresolved' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH ids AS (
      SELECT c.id
        FROM public.crm_companies c
       WHERE c.id = ANY (_company_ids)
         AND c.tenant_id = v_tenant
    ),
    leads AS (
      SELECT l.company_id AS cid, count(*) AS c, max(l.last_activity_at) AS last_act
        FROM public.crm_leads l
        JOIN ids ON ids.id = l.company_id
       WHERE l.tenant_id = v_tenant
       GROUP BY l.company_id
    ),
    contacts AS (
      SELECT p.current_company_id AS cid, count(*) AS c
        FROM public.profiles p
        JOIN ids ON ids.id = p.current_company_id
       WHERE p.tenant_id = v_tenant
       GROUP BY p.current_company_id
    )
    SELECT ids.id,
           coalesce(leads.c, 0)::bigint,
           leads.last_act,
           coalesce(contacts.c, 0)::bigint
      FROM ids
      LEFT JOIN leads ON leads.cid = ids.id
      LEFT JOIN contacts ON contacts.cid = ids.id;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_companies_aggregates(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_companies_aggregates(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.crm_companies_aggregates(uuid[]) IS
  'Liczniki listy firm CRM: leady (liczba, ostatnia aktywnosc) i kontakty (profile z current_company_id) dla firm NAJEMCY WOLAJACEGO. SECURITY DEFINER, bo profiles.current_company_id nie ma grantu dla authenticated; bramka admin/editor/super_admin (has_role w current_tenant_id()), najemca wylacznie z sesji, leady i profile tylko z tego samego najemcy. Firmy spoza najemcy wypadaja z wyniku.';

-- ===========================================================================
-- `crm_funnel_stats()` - WYCOFANA: bez EXECUTE dla PUBLIC, anon, authenticated
-- i service_role.
--
-- PRZYCZYNA. Funkcja (20260802130000, blizniak 20260802153008) to SQL
-- SECURITY INVOKER bez filtra najemcy i bez parametru najemcy: liczy
-- `COUNT(*) FILTER` nad CALYM `crm_funnel_view`. Granice najemcy dawal jej
-- wylacznie RLS wolajacego - a pod service-role (RLS wylaczone) zliczylaby
-- subskrybentow WSZYSTKICH najemcow. Jej komentarz reklamowal ja przy tym
-- jako agregat KPI lejka, wiec kazdy, kto szukal „gotowego RPC do licznikow",
-- trafial wlasnie na nia. Klientem staffu (authenticated) i tak padala 42501
-- (widok laczy `profiles.email` bez grantu - poprawka PII 20260724090100).
--
-- Od 17.11.2026 aplikacja jej NIE WOLA: liczniki lejka liczy `funnelStats`
-- (src/lib/crm-funnel.functions.ts) szescioma zapytaniami `head: true` nad
-- `crm_funnel_view` spod service-role, kazde z `.eq("tenant_id", <najemca
-- z sesji>)`. Pozostawiony EXECUTE byl wiec wylacznie powierzchnia ataku
-- i pulapka dla nastepnego autora.
--
-- DLACZEGO REVOKE, A NIE DROP. Funkcja jest w wygenerowanych typach
-- (`src/integrations/supabase/types.ts`, generowane z produkcji), a DROP to
-- zmiana niekompatybilna wstecz w kanale wdrozen Lovable. REVOKE ALL zamyka
-- ja dla kazdej roli aplikacji (zostaje wlasciciel), nie zmienia schematu ani
-- typow i jest bezpieczne do ponownego wykonania. Funkcja istnieje na
-- produkcji od sierpnia (jest w typach); brak funkcji dalby 42883 i wycofal
-- cala partie - kontrola przed wdrozeniem w opisie PR (zapytanie wlasciciela).
REVOKE ALL ON FUNCTION public.crm_funnel_stats() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.crm_funnel_stats() IS
  'WYCOFANA 2026-11-17 - nie wolac. SECURITY INVOKER bez filtra najemcy: pod service-role liczylaby subskrybentow wszystkich najemcow, a klientem staffu pada 42501 (profiles.email w crm_funnel_view). Bez EXECUTE dla PUBLIC, anon, authenticated i service_role. Liczniki lejka: funnelStats (src/lib/crm-funnel.functions.ts) - zapytania head:true nad crm_funnel_view spod service-role z tenant_id z sesji.';
