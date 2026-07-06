
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS aliases jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS position text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS country text;

CREATE TABLE IF NOT EXISTS public.crm_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  name_norm text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  domain text,
  aliases jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_companies_tenant_name_norm_uniq
  ON public.crm_companies (tenant_id, name_norm);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_companies TO authenticated;
GRANT ALL ON public.crm_companies TO service_role;

ALTER TABLE public.crm_companies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_companies' AND policyname='crm_companies_staff_read') THEN
    CREATE POLICY crm_companies_staff_read ON public.crm_companies
      FOR SELECT TO authenticated
      USING (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'super_admin')
        OR public.has_role(auth.uid(), 'editor')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_companies' AND policyname='crm_companies_admin_write') THEN
    CREATE POLICY crm_companies_admin_write ON public.crm_companies
      FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_leads_company_id_fkey'
  ) THEN
    ALTER TABLE public.crm_leads
      ADD CONSTRAINT crm_leads_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.jsonb_append_distinct(_obj jsonb, _key text, _val text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _val IS NULL OR btrim(_val) = '' THEN _obj
    WHEN _obj ? _key AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(_obj->_key) x WHERE x = _val
    ) THEN _obj
    ELSE jsonb_set(_obj, ARRAY[_key],
      COALESCE(_obj->_key, '[]'::jsonb) || to_jsonb(_val), true)
  END
$$;

CREATE OR REPLACE FUNCTION public.crm_upsert_from_form(
  _tenant uuid,
  _email text,
  _first_name text,
  _last_name text,
  _phone text,
  _company text,
  _position text,
  _linkedin text,
  _country text,
  _source text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email_norm text := lower(btrim(coalesce(_email, '')));
  v_phone_norm text := regexp_replace(coalesce(_phone,''), '[^0-9+]', '', 'g');
  v_company_id uuid;
  v_lead_id uuid;
  v_existing public.crm_leads%ROWTYPE;
BEGIN
  IF v_email_norm = '' THEN RETURN NULL; END IF;
  IF v_phone_norm = '' THEN v_phone_norm := NULL; END IF;

  IF _company IS NOT NULL AND btrim(_company) <> '' THEN
    INSERT INTO public.crm_companies (tenant_id, name)
    VALUES (_tenant, btrim(_company))
    ON CONFLICT (tenant_id, name_norm) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_company_id;
  END IF;

  SELECT * INTO v_existing FROM public.crm_leads
   WHERE tenant_id = _tenant AND email_norm = v_email_norm LIMIT 1;

  IF v_existing.id IS NULL AND _first_name IS NOT NULL AND _last_name IS NOT NULL
     AND btrim(_first_name) <> '' AND btrim(_last_name) <> '' THEN
    SELECT * INTO v_existing FROM public.crm_leads
     WHERE tenant_id = _tenant
       AND lower(btrim(coalesce(first_name,''))) = lower(btrim(_first_name))
       AND lower(btrim(coalesce(last_name,'')))  = lower(btrim(_last_name))
       AND (v_company_id IS NULL OR company_id IS NULL OR company_id = v_company_id)
     LIMIT 1;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.crm_leads SET
      first_name    = COALESCE(NULLIF(first_name,''), _first_name),
      last_name     = COALESCE(NULLIF(last_name,''),  _last_name),
      phone         = COALESCE(NULLIF(phone,''),      _phone),
      phone_norm    = COALESCE(phone_norm,            v_phone_norm),
      company       = COALESCE(NULLIF(company,''),    _company),
      position      = COALESCE(NULLIF(position,''),   _position),
      linkedin_url  = COALESCE(NULLIF(linkedin_url,''), _linkedin),
      country       = COALESCE(NULLIF(country,''),    _country),
      company_id    = COALESCE(company_id,            v_company_id),
      aliases = public.jsonb_append_distinct(
                  public.jsonb_append_distinct(
                    public.jsonb_append_distinct(
                      public.jsonb_append_distinct(
                        public.jsonb_append_distinct(
                          public.jsonb_append_distinct(
                            public.jsonb_append_distinct(aliases, 'emails',
                              CASE WHEN v_email_norm <> lower(btrim(coalesce(v_existing.email,''))) THEN v_email_norm END),
                            'phones', CASE WHEN _phone IS NOT NULL AND v_existing.phone IS DISTINCT FROM _phone THEN _phone END),
                          'companies', CASE WHEN _company IS NOT NULL AND v_existing.company IS DISTINCT FROM _company THEN _company END),
                        'positions', CASE WHEN _position IS NOT NULL AND v_existing.position IS DISTINCT FROM _position THEN _position END),
                      'linkedins', CASE WHEN _linkedin IS NOT NULL AND v_existing.linkedin_url IS DISTINCT FROM _linkedin THEN _linkedin END),
                    'countries', CASE WHEN _country IS NOT NULL AND v_existing.country IS DISTINCT FROM _country THEN _country END),
                  'sources', _source),
      source_count = source_count + 1,
      last_activity_at = now(),
      updated_at = now()
    WHERE id = v_existing.id
    RETURNING id INTO v_lead_id;
  ELSE
    INSERT INTO public.crm_leads (
      tenant_id, email_norm, email, first_name, last_name,
      phone, phone_norm, company, company_id, position, linkedin_url, country,
      stage, tags, aliases, newsletter_status, marketing_consent, source_count, last_activity_at
    ) VALUES (
      _tenant, v_email_norm, _email, NULLIF(btrim(coalesce(_first_name,'')),''), NULLIF(btrim(coalesce(_last_name,'')),''),
      _phone, v_phone_norm, _company, v_company_id, _position, _linkedin, _country,
      'new', ARRAY[]::text[],
      CASE WHEN _source IS NOT NULL THEN jsonb_build_object('sources', jsonb_build_array(_source)) ELSE '{}'::jsonb END,
      'pending', false, 1, now()
    ) RETURNING id INTO v_lead_id;
  END IF;

  RETURN v_lead_id;
END $$;

REVOKE ALL ON FUNCTION public.crm_upsert_from_form(uuid,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_upsert_from_form(uuid,text,text,text,text,text,text,text,text,text) TO service_role;
