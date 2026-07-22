
-- Podnieś domyślny limit do 5 i włącz metering domyślnie (Essential = 5/mies.)
ALTER TABLE public.metering_settings
  ALTER COLUMN member_monthly_limit SET DEFAULT 5;
ALTER TABLE public.metering_settings
  ALTER COLUMN enabled SET DEFAULT true;

-- Ujednolić istniejące rekordy z poprzednim defaultem (3 + wyłączone)
UPDATE public.metering_settings
   SET member_monthly_limit = 5,
       enabled = true
 WHERE member_monthly_limit = 3
   AND enabled = false;

-- Zapewnij wpis dla każdego tenanta (idempotentne)
INSERT INTO public.metering_settings (tenant_id, enabled, member_monthly_limit)
SELECT t.id, true, 5
  FROM public.tenants t
  LEFT JOIN public.metering_settings ms ON ms.tenant_id = t.id
 WHERE ms.tenant_id IS NULL;

-- Funkcja pomocnicza: ile bezpłatnych artykułów użytkownik zużył w bieżącym
-- miesiącu kalendarzowym (używana w CRM/adminie).
CREATE OR REPLACE FUNCTION public.get_user_monthly_metering_count(_user_id uuid)
RETURNS TABLE (
  used integer,
  monthly_limit integer,
  remaining integer,
  period_month date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public_tenant_id();
  v_limit integer;
  v_used integer;
  v_period date := date_trunc('month', now())::date;
BEGIN
  -- Tylko staff może odczytywać cudze liczniki.
  IF _user_id <> auth.uid()
     AND NOT (has_role(auth.uid(), 'admin'::app_role)
              OR has_role(auth.uid(), 'editor'::app_role)
              OR has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT ms.member_monthly_limit
    INTO v_limit
    FROM public.metering_settings ms
   WHERE ms.tenant_id = v_tenant;
  v_limit := COALESCE(v_limit, 5);

  SELECT count(*)::int
    INTO v_used
    FROM public.metered_views mv
   WHERE mv.tenant_id = v_tenant
     AND mv.user_id = _user_id
     AND mv.period_month = v_period;
  v_used := COALESCE(v_used, 0);

  used := v_used;
  monthly_limit := v_limit;
  remaining := GREATEST(v_limit - v_used, 0);
  period_month := v_period;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_monthly_metering_count(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_user_monthly_metering_count(uuid) TO authenticated;
