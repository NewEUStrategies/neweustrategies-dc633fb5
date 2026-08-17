ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.crm_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_name text,
  ADD COLUMN IF NOT EXISTS organization_logo_url text,
  ADD COLUMN IF NOT EXISTS organization_website text,
  ADD COLUMN IF NOT EXISTS is_sponsored boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsored_kind text,
  ADD COLUMN IF NOT EXISTS sponsored_advertiser_name text,
  ADD COLUMN IF NOT EXISTS sponsored_advertiser_url text,
  ADD COLUMN IF NOT EXISTS sponsored_payer_name text,
  ADD COLUMN IF NOT EXISTS sponsored_note_pl text,
  ADD COLUMN IF NOT EXISTS sponsored_note_en text,
  ADD COLUMN IF NOT EXISTS sponsored_affiliate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsored_political boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsored_political_process text,
  ADD COLUMN IF NOT EXISTS sponsored_sponsor_controller text,
  ADD COLUMN IF NOT EXISTS sponsored_order_ref text,
  ADD COLUMN IF NOT EXISTS sponsored_marked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sponsored_marked_at timestamptz;

COMMENT ON COLUMN public.posts.organization_id IS 'CRM company this post is attributed to. Reference only - the public render reads the organization_* snapshot.';
COMMENT ON COLUMN public.posts.organization_name IS 'Snapshot of the organization name shown to readers at publication time.';
COMMENT ON COLUMN public.posts.organization_logo_url IS 'Snapshot of the organization logo URL.';
COMMENT ON COLUMN public.posts.organization_website IS 'Snapshot of the organization website.';
COMMENT ON COLUMN public.posts.is_sponsored IS 'TRUE = commercial relationship; disclosure label must render above content.';
COMMENT ON COLUMN public.posts.sponsored_kind IS 'advertisement | sponsored | partner | barter | self_promo.';
COMMENT ON COLUMN public.posts.sponsored_advertiser_name IS 'Advertiser name; required to publish a flagged post (server gate).';
COMMENT ON COLUMN public.posts.sponsored_advertiser_url IS 'Advertiser electronic address (statutory element).';
COMMENT ON COLUMN public.posts.sponsored_payer_name IS 'Who paid, when different from the advertiser.';
COMMENT ON COLUMN public.posts.sponsored_political IS 'TRUE = political advertising under Regulation (EU) 2024/900.';
COMMENT ON COLUMN public.posts.sponsored_political_process IS 'Process the political advertisement concerns.';
COMMENT ON COLUMN public.posts.sponsored_sponsor_controller IS 'Entity ultimately controlling the sponsor.';
COMMENT ON COLUMN public.posts.sponsored_note_pl IS 'Optional PL addendum below the canonical label.';
COMMENT ON COLUMN public.posts.sponsored_note_en IS 'Optional EN addendum below the canonical label.';
COMMENT ON COLUMN public.posts.sponsored_affiliate IS 'TRUE = body contains affiliate links.';
COMMENT ON COLUMN public.posts.sponsored_order_ref IS 'Editorial-internal order/contract reference. Do not store secrets here.';
COMMENT ON COLUMN public.posts.sponsored_marked_by IS 'Who declared the commercial relationship.';
COMMENT ON COLUMN public.posts.sponsored_marked_at IS 'When the commercial relationship was declared.';

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_sponsored_kind_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_sponsored_kind_check
  CHECK (sponsored_kind IS NULL OR sponsored_kind IN ('advertisement','sponsored','partner','barter','self_promo'));

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_sponsored_disclosure_complete_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_sponsored_disclosure_complete_check
  CHECK (is_sponsored = false OR sponsored_kind IS NOT NULL);

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_sponsored_political_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_sponsored_political_check
  CHECK (sponsored_political = false OR is_sponsored = true);

CREATE INDEX IF NOT EXISTS posts_organization_id_idx ON public.posts (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_tenant_sponsored_idx ON public.posts (tenant_id, published_at DESC) WHERE is_sponsored = true;

GRANT SELECT (
  organization_id, organization_name, organization_logo_url, organization_website,
  is_sponsored, sponsored_kind, sponsored_advertiser_name, sponsored_advertiser_url,
  sponsored_payer_name, sponsored_note_pl, sponsored_note_en, sponsored_affiliate,
  sponsored_political, sponsored_political_process, sponsored_sponsor_controller
) ON public.posts TO anon, authenticated;

DROP FUNCTION IF EXISTS public.search_companies_public(text, integer);
CREATE FUNCTION public.search_companies_public(_query text, _limit integer DEFAULT 12)
RETURNS TABLE(id uuid, name text, country text, branch text, city text, address text,
              postal_code text, website text, phone text, domain text, logo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, country, branch, city, address, postal_code, website, phone, domain, logo_url
  FROM public.crm_companies
  WHERE tenant_id = public.current_tenant_id()
    AND (coalesce(_query, '') = '' OR name ILIKE '%' || _query || '%')
  ORDER BY name
  LIMIT _limit;
$$;
REVOKE ALL ON FUNCTION public.search_companies_public(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.search_companies_public(text, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.create_company_self_service(text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.create_company_self_service(text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.create_company_self_service(text, text, text, text, text, text, text, text, text, text);
CREATE FUNCTION public.create_company_self_service(
  _name text, _country text DEFAULT NULL, _branch text DEFAULT NULL, _city text DEFAULT NULL,
  _address text DEFAULT NULL, _postal_code text DEFAULT NULL, _website text DEFAULT NULL,
  _phone text DEFAULT NULL, _logo_url text DEFAULT NULL, _domain text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id uuid;
  existing_id uuid;
BEGIN
  IF _name IS NULL OR btrim(_name) = '' THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  SELECT id INTO existing_id
  FROM public.crm_companies
  WHERE tenant_id = public.current_tenant_id()
    AND name_norm = lower(btrim(_name))
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    IF _logo_url IS NOT NULL AND btrim(_logo_url) <> '' THEN
      UPDATE public.crm_companies
         SET logo_url = _logo_url, updated_at = now()
       WHERE id = existing_id
         AND tenant_id = public.current_tenant_id()
         AND (logo_url IS NULL OR btrim(logo_url) = '');
    END IF;
    RETURN existing_id;
  END IF;

  INSERT INTO public.crm_companies (
    tenant_id, created_by, name, country, branch, city, address, postal_code,
    website, phone, logo_url, domain
  ) VALUES (
    public.current_tenant_id(), auth.uid(), _name,
    nullif(trim(coalesce(_country, '')), ''),
    nullif(trim(coalesce(_branch, '')), ''),
    nullif(trim(coalesce(_city, '')), ''),
    nullif(trim(coalesce(_address, '')), ''),
    nullif(trim(coalesce(_postal_code, '')), ''),
    nullif(trim(coalesce(_website, '')), ''),
    nullif(trim(coalesce(_phone, '')), ''),
    nullif(trim(coalesce(_logo_url, '')), ''),
    nullif(trim(coalesce(_domain, '')), '')
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
REVOKE ALL ON FUNCTION public.create_company_self_service(text, text, text, text, text, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_company_self_service(text, text, text, text, text, text, text, text, text, text) TO authenticated;