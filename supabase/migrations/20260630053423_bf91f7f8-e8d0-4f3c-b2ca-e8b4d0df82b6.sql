
ALTER VIEW public.crm_leads_all SET (security_invoker = true);

REVOKE EXECUTE ON FUNCTION public.crm_upsert_lead(uuid, text, text, text, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_upsert_lead(uuid, text, text, text, text, text, boolean, boolean) TO authenticated, service_role;
