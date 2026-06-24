ALTER TABLE public.ad_slots ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.ad_placements ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();