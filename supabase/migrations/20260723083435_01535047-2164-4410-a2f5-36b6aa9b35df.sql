ALTER FUNCTION public.pricing_catalog_v4_benefits() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.pricing_catalog_v4_benefits() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_pricing_catalog_v4(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pricing_catalog_v4_benefits() TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_pricing_catalog_v4(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) TO service_role;