-- Indeksy pomocnicze pod filtry i bulk-update w CRM (leady i firmy).
CREATE INDEX IF NOT EXISTS crm_leads_owner_id_idx ON public.crm_leads (owner_id);
CREATE INDEX IF NOT EXISTS crm_leads_tenant_activity_idx ON public.crm_leads (tenant_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS crm_leads_tenant_created_idx ON public.crm_leads (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_leads_country_idx ON public.crm_leads (country);
CREATE INDEX IF NOT EXISTS crm_leads_tags_gin ON public.crm_leads USING GIN (tags);
CREATE INDEX IF NOT EXISTS crm_companies_tenant_updated_idx ON public.crm_companies (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_companies_country_idx ON public.crm_companies (country);