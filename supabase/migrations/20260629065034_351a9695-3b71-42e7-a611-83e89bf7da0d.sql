
REVOKE ALL ON FUNCTION public.guess_gender_from_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guess_gender_from_name(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.profiles_autofill_gender() FROM PUBLIC, anon;
