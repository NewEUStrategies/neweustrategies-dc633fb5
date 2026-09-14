CREATE OR REPLACE FUNCTION public.email_account_tenant_for_address(p_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_tenant uuid;
  v_count integer;
BEGIN
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  SELECT count(DISTINCT p.tenant_id) INTO v_count
    FROM public.profiles p
   WHERE lower(btrim(p.email)) = v_email AND p.tenant_id IS NOT NULL;

  IF v_count <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT DISTINCT p.tenant_id INTO v_tenant
    FROM public.profiles p
   WHERE lower(btrim(p.email)) = v_email AND p.tenant_id IS NOT NULL;

  RETURN v_tenant;
END;
$fn$;

COMMENT ON FUNCTION public.email_account_tenant_for_address(text) IS
  'Najemca KONTA o tym adresie: wylacznie profiles, wylacznie jednoznacznie, bez fallbacku na tenanta domyslnego. NULL znaczy "nie wiadomo" i jest odpowiedzia - pozwala wolajacemu siegnac po host powrotu. Do poczty autoryzacyjnej; wypis i poczta transakcyjna zostaja przy email_resolve_tenant_for_address.';

REVOKE ALL ON FUNCTION public.email_account_tenant_for_address(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_account_tenant_for_address(text)
  TO service_role;
