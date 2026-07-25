-- ============================================================================
-- UTAJONY DEFEKT ENUM: has_role(auth.uid(), 'tenant_admin') w ciele funkcji
-- SECURITY DEFINER.
--
-- `public.has_role(uuid, public.app_role)` ma jeden przeciazony podpis, a enum
-- `app_role` to ('admin','editor','author','user','super_admin') - wartosci
-- 'tenant_admin' NIGDY w nim nie bylo (zadna migracja jej nie dodaje).
-- Literal 'tenant_admin' jest wiec rzutowany na app_role dopiero w RUNTIME
-- (cialo plpgsql nie jest parsowane przy CREATE FUNCTION), co daje
-- `22P02 invalid input value for enum app_role: "tenant_admin"`.
--
-- Dlaczego "utajony": galaz jest osiagalna WYLACZNIE dla wolajacego, ktory nie
-- jest ani 'admin', ani 'editor' - a wiec nigdy w testach dymnych na koncie
-- administratora. Dla zwyklego czlonka /admin/metering zwracalo 500 z bledem
-- parsowania enuma zamiast czystego `insufficient_privilege` (42501), co
-- dodatkowo maskowalo powod odmowy w telemetrii.
--
-- Bramka roli zostaje wyrownana do kanonicznej trojki stosowanej w funkcji
-- siostrzanej `get_user_monthly_metering_count` w tej samej migracji
-- 20260724100000: admin | editor | super_admin. Rzutowanie jest teraz JAWNE
-- (::app_role), zeby kazdy przyszly literal byl weryfikowany razem z reszta
-- podpisu, a nie w cichym rzutowaniu z `unknown`.
--
-- Regresje pilnuje `scripts/check-sql-app-role-literals.ts` (krok CI "SQL
-- app_role literal invariant"), ktory porownuje kazdy literal przekazany do
-- has_role() z wartosciami enuma odtworzonymi z migracji.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.metering_impact_preview(_proposed_member_limit integer)
RETURNS TABLE (
  total_members bigint,
  members_blocked bigint,
  members_warning bigint,
  members_safe bigint,
  total_anon bigint,
  anon_blocked bigint,
  avg_used numeric,
  max_used integer,
  total_views bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_month date := date_trunc('month', now())::date;
  v_limit integer := GREATEST(0, LEAST(1000, COALESCE(_proposed_member_limit, 0)));
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'editor'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH members AS (
    SELECT user_id, COUNT(*)::int AS used
      FROM public.metered_views
     WHERE tenant_id = v_tenant
       AND period_month = v_month
       AND user_id IS NOT NULL
     GROUP BY user_id
  ),
  anon AS (
    SELECT visitor_id, COUNT(*)::int AS used
      FROM public.metered_views
     WHERE tenant_id = v_tenant
       AND period_month = v_month
       AND user_id IS NULL
       AND visitor_id IS NOT NULL
     GROUP BY visitor_id
  )
  SELECT
    (SELECT COUNT(*) FROM members),
    (SELECT COUNT(*) FROM members WHERE v_limit > 0 AND used >= v_limit),
    (SELECT COUNT(*) FROM members WHERE v_limit > 0 AND used > 0 AND used < v_limit),
    (SELECT COUNT(*) FROM members WHERE v_limit = 0 OR used = 0),
    (SELECT COUNT(*) FROM anon),
    (SELECT COUNT(*) FROM anon WHERE v_limit > 0 AND used >= v_limit),
    COALESCE((SELECT ROUND(AVG(used)::numeric, 2) FROM members), 0)::numeric,
    COALESCE((SELECT MAX(used) FROM members), 0)::int,
    (SELECT COUNT(*) FROM public.metered_views
      WHERE tenant_id = v_tenant AND period_month = v_month);
END $$;

COMMENT ON FUNCTION public.metering_impact_preview(integer) IS
  'Podglad wplywu limitu meteringu na czlonkow/anonimow biezacego tenanta. Bramka: admin | editor | super_admin (jawne ::app_role - literal poza enumem podnosilby 22P02 w runtime).';
