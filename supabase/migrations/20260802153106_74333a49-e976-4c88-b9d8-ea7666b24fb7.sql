ALTER TABLE public.integration_endpoints
  ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();