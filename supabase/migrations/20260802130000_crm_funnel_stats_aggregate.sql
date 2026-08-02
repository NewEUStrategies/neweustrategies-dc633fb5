-- ============================================================================
-- CRM Pipeline/Funnel: agregacja statystyk lejka w SQL zamiast pętli w JS.
--
-- Dotychczas funnelStats (crm-funnel.functions.ts) ściągał z crm_funnel_view
-- WSZYSTKIE wiersze (status,is_registered,is_contact) i liczył sumy pętlą po
-- stronie serwera aplikacji - O(n) transferu i pamięci na każde odświeżenie
-- panelu. Ten RPC liczy te same wartości jednym skanem z COUNT(*) FILTER.
--
-- SECURITY INVOKER + widok z security_invoker=on => obowiązuje RLS tabeli
-- newsletter_subscribers (staff-only w ramach tenanta). Użytkownik bez roli
-- staff dostaje komplet zer, nie błąd - identycznie jak pusta lista w widoku.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_funnel_stats()
RETURNS TABLE (
  total        bigint,
  subscribed   bigint,
  pending      bigint,
  unsubscribed bigint,
  registered   bigint,
  contacts     bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    count(*)                                        AS total,
    count(*) FILTER (WHERE v.status = 'subscribed')   AS subscribed,
    count(*) FILTER (WHERE v.status = 'pending')      AS pending,
    count(*) FILTER (WHERE v.status = 'unsubscribed') AS unsubscribed,
    count(*) FILTER (WHERE v.is_registered)           AS registered,
    count(*) FILTER (WHERE v.is_contact)              AS contacts
  FROM public.crm_funnel_view v;
$$;

COMMENT ON FUNCTION public.crm_funnel_stats() IS
  'Aggregated marketing-funnel KPIs (COUNT(*) FILTER over crm_funnel_view). SECURITY INVOKER: underlying RLS on newsletter_subscribers scopes rows to the caller''s tenant/staff role.';

REVOKE ALL ON FUNCTION public.crm_funnel_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_funnel_stats() TO authenticated, service_role;
