CREATE OR REPLACE FUNCTION public.search_companies_public(
  _query text,
  _limit integer DEFAULT 12
)
RETURNS TABLE(
  id uuid,
  name text,
  country text,
  branch text,
  city text,
  address text,
  postal_code text,
  website text,
  phone text,
  domain text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, country, branch, city, address, postal_code, website, phone, domain
  FROM public.crm_companies
  WHERE tenant_id = public.current_tenant_id()
    AND (coalesce(_query, '') = '' OR name ILIKE '%' || _query || '%')
  ORDER BY name
  LIMIT _limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_companies_public(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_company_self_service(
  _name text,
  _country text DEFAULT NULL,
  _branch text DEFAULT NULL,
  _city text DEFAULT NULL,
  _address text DEFAULT NULL,
  _postal_code text DEFAULT NULL,
  _website text DEFAULT NULL,
  _phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id
  FROM public.crm_companies
  WHERE tenant_id = public.current_tenant_id()
    AND name_norm = lower(btrim(_name))
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  INSERT INTO public.crm_companies (
    tenant_id, created_by, name, country, branch, city, address, postal_code, website, phone
  ) VALUES (
    public.current_tenant_id(),
    auth.uid(),
    _name,
    nullif(trim(coalesce(_country, '')), ''),
    nullif(trim(coalesce(_branch, '')), ''),
    nullif(trim(coalesce(_city, '')), ''),
    nullif(trim(coalesce(_address, '')), ''),
    nullif(trim(coalesce(_postal_code, '')), ''),
    nullif(trim(coalesce(_website, '')), ''),
    nullif(trim(coalesce(_phone, '')), '')
  )
  RETURNING id INTO new_id;

  RETURN new_id;
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO existing_id
  FROM public.crm_companies
  WHERE tenant_id = public.current_tenant_id()
    AND name_norm = lower(btrim(_name))
  LIMIT 1;
  RETURN existing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_company_self_service(text, text, text, text, text, text, text, text) TO authenticated;