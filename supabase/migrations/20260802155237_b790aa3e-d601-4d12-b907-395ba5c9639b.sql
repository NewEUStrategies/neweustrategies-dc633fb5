GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_consents TO authenticated;
GRANT ALL ON public.user_consents TO service_role;
GRANT SELECT, INSERT ON public.user_consent_events TO authenticated;
GRANT ALL ON public.user_consent_events TO service_role;
REVOKE EXECUTE ON FUNCTION public.set_user_consent(text, boolean, text, text, text, text, text) FROM anon;