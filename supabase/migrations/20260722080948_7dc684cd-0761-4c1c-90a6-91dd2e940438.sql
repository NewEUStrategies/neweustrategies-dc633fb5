
CREATE OR REPLACE FUNCTION public.crm_upsert_lead_from_profile(_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  _phone_norm text;
  _safe_phone text;
BEGIN
  SELECT id, email, tenant_id, first_name, last_name, display_name, phone,
         current_company, job_title, linkedin_url, location
    INTO p
    FROM public.profiles WHERE id = _profile_id;
  IF NOT FOUND OR p.email IS NULL OR length(trim(p.email)) = 0 THEN
    RETURN;
  END IF;

  _phone_norm := NULLIF(regexp_replace(COALESCE(p.phone, ''), '\s+', '', 'g'), '');
  _safe_phone := p.phone;
  -- Jeśli numer jest już zajęty w tenant przez innego leada (po innym e-mailu),
  -- pomijamy telefon dla tego rekordu (unique constraint na phone_norm).
  IF _phone_norm IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.crm_leads
     WHERE tenant_id = COALESCE(p.tenant_id, public_tenant_id())
       AND phone_norm = _phone_norm
       AND email_norm <> lower(trim(p.email))
  ) THEN
    _safe_phone := NULL;
  END IF;

  INSERT INTO public.crm_leads (
    tenant_id, email, email_norm, first_name, last_name, phone, company, position, linkedin_url, country,
    stage, marketing_consent, last_activity_at
  ) VALUES (
    COALESCE(p.tenant_id, public_tenant_id()),
    p.email, lower(trim(p.email)),
    COALESCE(p.first_name, split_part(COALESCE(p.display_name, ''), ' ', 1)),
    COALESCE(p.last_name, NULLIF(split_part(COALESCE(p.display_name, ''), ' ', 2), '')),
    _safe_phone, p.current_company, p.job_title, p.linkedin_url, p.location,
    'new'::crm_stage, false, now()
  )
  ON CONFLICT (tenant_id, email_norm) DO UPDATE
    SET first_name   = COALESCE(EXCLUDED.first_name, public.crm_leads.first_name),
        last_name    = COALESCE(EXCLUDED.last_name, public.crm_leads.last_name),
        phone        = COALESCE(public.crm_leads.phone, EXCLUDED.phone),
        company      = COALESCE(EXCLUDED.company, public.crm_leads.company),
        position     = COALESCE(EXCLUDED.position, public.crm_leads.position),
        linkedin_url = COALESCE(EXCLUDED.linkedin_url, public.crm_leads.linkedin_url),
        country      = COALESCE(EXCLUDED.country, public.crm_leads.country),
        updated_at   = now();
EXCEPTION WHEN unique_violation THEN
  -- Fallback: druga próba bez telefonu, jeśli i tak nastąpi kolizja.
  INSERT INTO public.crm_leads (
    tenant_id, email, email_norm, first_name, last_name, company, position, linkedin_url, country,
    stage, marketing_consent, last_activity_at
  ) VALUES (
    COALESCE(p.tenant_id, public_tenant_id()),
    p.email, lower(trim(p.email)),
    COALESCE(p.first_name, split_part(COALESCE(p.display_name, ''), ' ', 1)),
    COALESCE(p.last_name, NULLIF(split_part(COALESCE(p.display_name, ''), ' ', 2), '')),
    p.current_company, p.job_title, p.linkedin_url, p.location,
    'new'::crm_stage, false, now()
  )
  ON CONFLICT (tenant_id, email_norm) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.crm_upsert_lead_from_subscriber(_sub_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  SELECT id, email, tenant_id, first_name, last_name, display_name, status
    INTO s
    FROM public.newsletter_subscribers WHERE id = _sub_id;
  IF NOT FOUND OR s.email IS NULL OR length(trim(s.email)) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.crm_leads (
    tenant_id, email, email_norm, first_name, last_name,
    stage, marketing_consent, newsletter_status, last_activity_at
  ) VALUES (
    COALESCE(s.tenant_id, public_tenant_id()),
    s.email, lower(trim(s.email)),
    COALESCE(s.first_name, split_part(COALESCE(s.display_name, ''), ' ', 1)),
    COALESCE(s.last_name, NULLIF(split_part(COALESCE(s.display_name, ''), ' ', 2), '')),
    'new'::crm_stage, (s.status = 'subscribed'), s.status, now()
  )
  ON CONFLICT (tenant_id, email_norm) DO UPDATE
    SET first_name        = COALESCE(EXCLUDED.first_name, public.crm_leads.first_name),
        last_name         = COALESCE(EXCLUDED.last_name, public.crm_leads.last_name),
        newsletter_status = EXCLUDED.newsletter_status,
        marketing_consent = public.crm_leads.marketing_consent OR EXCLUDED.marketing_consent,
        updated_at        = now();
END $$;

CREATE OR REPLACE FUNCTION public.crm_backfill_all_leads()
RETURNS TABLE(profiles_synced integer, subscribers_synced integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _p int := 0;
  _s int := 0;
  r RECORD;
BEGIN
  IF _uid IS NULL OR NOT (
    public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'super_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN SELECT id FROM public.profiles WHERE email IS NOT NULL AND length(trim(email)) > 0 LOOP
    PERFORM public.crm_upsert_lead_from_profile(r.id);
    _p := _p + 1;
  END LOOP;

  FOR r IN SELECT id FROM public.newsletter_subscribers WHERE email IS NOT NULL AND length(trim(email)) > 0 LOOP
    PERFORM public.crm_upsert_lead_from_subscriber(r.id);
    _s := _s + 1;
  END LOOP;

  RETURN QUERY SELECT _p, _s;
END $$;

REVOKE ALL ON FUNCTION public.crm_backfill_all_leads() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_backfill_all_leads() TO authenticated;

CREATE OR REPLACE FUNCTION public._trg_profile_to_crm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND length(trim(NEW.email)) > 0 THEN
    PERFORM public.crm_upsert_lead_from_profile(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profile_sync_crm_lead ON public.profiles;
CREATE TRIGGER profile_sync_crm_lead
  AFTER INSERT OR UPDATE OF email, first_name, last_name, phone, current_company, job_title, linkedin_url, location
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._trg_profile_to_crm();

CREATE OR REPLACE FUNCTION public._trg_subscriber_to_crm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND length(trim(NEW.email)) > 0 THEN
    PERFORM public.crm_upsert_lead_from_subscriber(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS subscriber_sync_crm_lead ON public.newsletter_subscribers;
CREATE TRIGGER subscriber_sync_crm_lead
  AFTER INSERT OR UPDATE OF email, status, first_name, last_name
  ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public._trg_subscriber_to_crm();

-- Jednorazowy backfill.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE email IS NOT NULL AND length(trim(email)) > 0 LOOP
    PERFORM public.crm_upsert_lead_from_profile(r.id);
  END LOOP;
  FOR r IN SELECT id FROM public.newsletter_subscribers WHERE email IS NOT NULL AND length(trim(email)) > 0 LOOP
    PERFORM public.crm_upsert_lead_from_subscriber(r.id);
  END LOOP;
END $$;
