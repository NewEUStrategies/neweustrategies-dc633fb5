REVOKE EXECUTE ON FUNCTION public.record_seo_404(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_seo_404(uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_redirect_hit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_redirect_hit(uuid) TO service_role;