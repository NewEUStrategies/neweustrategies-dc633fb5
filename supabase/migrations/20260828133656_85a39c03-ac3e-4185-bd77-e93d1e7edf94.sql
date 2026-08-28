ALTER TABLE public.crm_companies ADD COLUMN IF NOT EXISTS email text;

CREATE OR REPLACE FUNCTION public.crm_company_search(p_query text, p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid, name text, logo_url text, city text, country text, branch text, website text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.id, c.name, c.logo_url, c.city, c.country, c.branch, c.website
  FROM public.crm_companies c
  WHERE auth.uid() IS NOT NULL
    AND btrim(COALESCE(p_query, '')) <> ''
    AND c.tenant_id = COALESCE(public._caller_tenant(), public.public_tenant_id())
    AND c.name_norm LIKE '%' || lower(btrim(p_query)) || '%'
  ORDER BY position(lower(btrim(p_query)) in c.name_norm), c.name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 25)
$function$;

REVOKE ALL ON FUNCTION public.crm_company_search(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_company_search(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_company_create_self(
  p_name text,
  p_logo_url text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_branch text DEFAULT NULL
)
RETURNS TABLE(id uuid, name text, logo_url text, city text, country text, branch text, website text)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := COALESCE(public._caller_tenant(), public.public_tenant_id());
  v_name text := btrim(COALESCE(p_name, ''));
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF v_name = '' OR length(v_name) > 200 THEN
    RAISE EXCEPTION 'invalid company name' USING ERRCODE = '22023';
  END IF;
  IF p_email IS NOT NULL AND btrim(p_email) <> '' AND btrim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid company email' USING ERRCODE = '22023';
  END IF;

  SELECT c.id INTO v_id
  FROM public.crm_companies c
  WHERE c.tenant_id = v_tenant AND c.name_norm = lower(v_name)
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.crm_companies (
      tenant_id, name, logo_url, address, city, postal_code, country, phone, email, website, branch, created_by
    ) VALUES (
      v_tenant, v_name,
      NULLIF(btrim(COALESCE(p_logo_url, '')), ''),
      NULLIF(btrim(COALESCE(p_address, '')), ''),
      NULLIF(btrim(COALESCE(p_city, '')), ''),
      NULLIF(btrim(COALESCE(p_postal_code, '')), ''),
      NULLIF(btrim(COALESCE(p_country, '')), ''),
      NULLIF(btrim(COALESCE(p_phone, '')), ''),
      NULLIF(btrim(COALESCE(p_email, '')), ''),
      NULLIF(btrim(COALESCE(p_website, '')), ''),
      NULLIF(btrim(COALESCE(p_branch, '')), ''),
      v_uid
    )
    RETURNING crm_companies.id INTO v_id;
  ELSE
    UPDATE public.crm_companies c SET
      logo_url = COALESCE(c.logo_url, NULLIF(btrim(COALESCE(p_logo_url, '')), '')),
      address = COALESCE(c.address, NULLIF(btrim(COALESCE(p_address, '')), '')),
      city = COALESCE(c.city, NULLIF(btrim(COALESCE(p_city, '')), '')),
      postal_code = COALESCE(c.postal_code, NULLIF(btrim(COALESCE(p_postal_code, '')), '')),
      country = COALESCE(c.country, NULLIF(btrim(COALESCE(p_country, '')), '')),
      phone = COALESCE(c.phone, NULLIF(btrim(COALESCE(p_phone, '')), '')),
      email = COALESCE(c.email, NULLIF(btrim(COALESCE(p_email, '')), '')),
      website = COALESCE(c.website, NULLIF(btrim(COALESCE(p_website, '')), '')),
      branch = COALESCE(c.branch, NULLIF(btrim(COALESCE(p_branch, '')), '')),
      updated_at = now()
    WHERE c.id = v_id;
  END IF;

  RETURN QUERY
    SELECT c.id, c.name, c.logo_url, c.city, c.country, c.branch, c.website
    FROM public.crm_companies c WHERE c.id = v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_company_create_self(text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_company_create_self(text, text, text, text, text, text, text, text, text, text) TO authenticated;