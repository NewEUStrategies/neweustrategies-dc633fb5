-- 1) Idempotentny zasiew jednego tenanta.
CREATE OR REPLACE FUNCTION public.seed_related_posts_config(_tenant_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.related_posts_config (tenant_id)
  VALUES (_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.seed_related_posts_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_related_posts_config(uuid) TO service_role;

-- 2) Backfill istniejących tenantów.
DO $$
DECLARE v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_related_posts_config(v_t);
  END LOOP;
END $$;

-- 3) Provisioning nowych tenantów.
CREATE OR REPLACE FUNCTION public.tg_tenants_seed_related_posts_config()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_related_posts_config(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_seed_related_posts_config ON public.tenants;
CREATE TRIGGER tenants_seed_related_posts_config
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tg_tenants_seed_related_posts_config();

-- 4) Default tenant_id.
ALTER TABLE public.related_posts_config
  ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();

COMMENT ON TABLE public.related_posts_config IS
  'Singleton konfiguracji silnika rekomendacji per tenant. Zapis WYŁĄCZNIE przez '
  'upsert z jawnym tenant_id (onConflict: tenant_id) - UPDATE bez dopasowania '
  'jest dla PostgREST sukcesem i maskuje brak wiersza. Wiersz jest zasiewany '
  'triggerem tenants_seed_related_posts_config przy tworzeniu tenanta.';

-- 5) Deterministyczny odczyt publiczny (izolacja tenantów).
CREATE OR REPLACE FUNCTION public.get_related_posts_config()
RETURNS SETOF public.related_posts_config
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.related_posts_config
  WHERE tenant_id = public.public_tenant_id()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_related_posts_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_related_posts_config() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_related_posts_config() IS
  'Konfiguracja rekomendacji tenanta PRZEGLĄDANEGO (public_tenant_id()). '
  'Kanoniczny odczyt publiczny - zastępuje select().limit(1), który dla '
  'zalogowanego edytora obcego tenanta mógł zwrócić wiersz JEGO tenanta.';