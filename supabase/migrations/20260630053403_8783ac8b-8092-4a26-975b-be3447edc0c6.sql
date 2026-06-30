
-- ============ CRM core ============

CREATE TYPE public.crm_stage AS ENUM ('new','contacted','qualified','proposal','won','lost','archived');
CREATE TYPE public.crm_source_type AS ENUM ('contact_form','newsletter','comment','webinar','import','other');

-- Extend contact_messages with form identification + consents snapshot
ALTER TABLE public.contact_messages
  ADD COLUMN IF NOT EXISTS form_id text,
  ADD COLUMN IF NOT EXISTS form_name text,
  ADD COLUMN IF NOT EXISTS form_type text NOT NULL DEFAULT 'contact_form',
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS consents jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS referer text,
  ADD COLUMN IF NOT EXISTS page_url text;

CREATE INDEX IF NOT EXISTS contact_messages_email_idx ON public.contact_messages (tenant_id, lower(email));
CREATE INDEX IF NOT EXISTS contact_messages_form_idx ON public.contact_messages (tenant_id, form_type, created_at DESC);

-- Extend newsletter_subscribers with consent snapshot if missing
ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS consents jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS source_form_id text,
  ADD COLUMN IF NOT EXISTS source_form_name text,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

-- ============ Immutable consent audit log ============
CREATE TABLE public.crm_consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id(),
  email text NOT NULL,
  source_type public.crm_source_type NOT NULL,
  source_id uuid,
  form_id text,
  form_name text,
  consent_key text NOT NULL,
  consent_text text NOT NULL,
  consent_version text,
  given boolean NOT NULL,
  ip text,
  user_agent text,
  lang text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.crm_consent_log TO authenticated;
GRANT SELECT, INSERT ON public.crm_consent_log TO anon;
GRANT ALL ON public.crm_consent_log TO service_role;
ALTER TABLE public.crm_consent_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert consent log"
  ON public.crm_consent_log FOR INSERT
  WITH CHECK (tenant_id = public.public_tenant_id());

CREATE POLICY "Staff read consent log"
  ON public.crm_consent_log FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
    OR public.is_super_admin()
  );

CREATE INDEX crm_consent_log_email_idx ON public.crm_consent_log (tenant_id, lower(email), created_at DESC);
CREATE INDEX crm_consent_log_source_idx ON public.crm_consent_log (source_type, source_id);

-- ============ Lead aggregate state (keyed by tenant+email) ============
CREATE TABLE public.crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id(),
  email_norm text NOT NULL,
  email text NOT NULL,
  first_name text,
  last_name text,
  phone text,
  company text,
  stage public.crm_stage NOT NULL DEFAULT 'new',
  owner_id uuid,
  tags text[] NOT NULL DEFAULT '{}',
  follow_up_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  source_count int NOT NULL DEFAULT 1,
  newsletter_status text,
  marketing_consent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email_norm)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_leads TO authenticated;
GRANT ALL ON public.crm_leads TO service_role;
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read leads"
  ON public.crm_leads FOR SELECT TO authenticated
  USING (
    (tenant_id = public.current_tenant_id()
      AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')))
    OR public.is_super_admin()
  );
CREATE POLICY "Staff insert leads"
  ON public.crm_leads FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );
CREATE POLICY "Staff update leads"
  ON public.crm_leads FOR UPDATE TO authenticated
  USING (
    (tenant_id = public.current_tenant_id()
      AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')))
    OR public.is_super_admin()
  );
CREATE POLICY "Admins delete leads"
  ON public.crm_leads FOR DELETE TO authenticated
  USING (
    (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
    OR public.is_super_admin()
  );

CREATE TRIGGER trg_crm_leads_updated_at BEFORE UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX crm_leads_stage_idx ON public.crm_leads (tenant_id, stage, last_activity_at DESC);
CREATE INDEX crm_leads_owner_idx ON public.crm_leads (owner_id);

-- ============ Lead notes ============
CREATE TABLE public.crm_lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id(),
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  author_id uuid,
  body text NOT NULL,
  is_internal boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_lead_notes TO authenticated;
GRANT ALL ON public.crm_lead_notes TO service_role;
ALTER TABLE public.crm_lead_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read notes" ON public.crm_lead_notes FOR SELECT TO authenticated
  USING (
    (tenant_id = public.current_tenant_id()
      AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')))
    OR public.is_super_admin()
  );
CREATE POLICY "Staff write notes" ON public.crm_lead_notes FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
    AND author_id = auth.uid()
  );
CREATE POLICY "Author edits own notes" ON public.crm_lead_notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.is_super_admin());
CREATE POLICY "Author deletes own notes" ON public.crm_lead_notes FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.is_super_admin());

CREATE INDEX crm_lead_notes_lead_idx ON public.crm_lead_notes (lead_id, created_at DESC);

-- ============ Integrations (Merydian + future) ============
CREATE TABLE public.crm_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE DEFAULT public.public_tenant_id(),
  merydian_enabled boolean NOT NULL DEFAULT false,
  merydian_mode text NOT NULL DEFAULT 'webhook',
  merydian_webhook_url text,
  merydian_webhook_secret text,
  merydian_api_base text,
  merydian_api_key text,
  merydian_workspace_id text,
  forward_stages public.crm_stage[] NOT NULL DEFAULT ARRAY['new']::public.crm_stage[],
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_integrations TO authenticated;
GRANT ALL ON public.crm_integrations TO service_role;
ALTER TABLE public.crm_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read integrations" ON public.crm_integrations FOR SELECT TO authenticated
  USING (
    (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'admin'))
    OR public.is_super_admin()
  );
CREATE POLICY "Admins write integrations" ON public.crm_integrations FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins update integrations" ON public.crm_integrations FOR UPDATE TO authenticated
  USING (
    (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'admin'))
    OR public.is_super_admin()
  );

CREATE TRIGGER trg_crm_integrations_updated_at BEFORE UPDATE ON public.crm_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Lead upsert helper + triggers ============
CREATE OR REPLACE FUNCTION public.crm_upsert_lead(
  _tenant uuid,
  _email text,
  _first_name text,
  _last_name text,
  _phone text,
  _company text,
  _newsletter boolean,
  _marketing boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid; v_norm text;
BEGIN
  IF _email IS NULL OR length(trim(_email)) = 0 THEN RETURN NULL; END IF;
  v_norm := lower(trim(_email));

  INSERT INTO public.crm_leads (
    tenant_id, email_norm, email, first_name, last_name, phone, company,
    newsletter_status, marketing_consent, source_count, last_activity_at
  )
  VALUES (
    coalesce(_tenant, public.public_tenant_id()), v_norm, _email,
    _first_name, _last_name, _phone, _company,
    CASE WHEN _newsletter THEN 'pending' ELSE NULL END,
    coalesce(_marketing, false), 1, now()
  )
  ON CONFLICT (tenant_id, email_norm) DO UPDATE
  SET first_name = coalesce(EXCLUDED.first_name, public.crm_leads.first_name),
      last_name  = coalesce(EXCLUDED.last_name,  public.crm_leads.last_name),
      phone      = coalesce(EXCLUDED.phone,      public.crm_leads.phone),
      company    = coalesce(EXCLUDED.company,    public.crm_leads.company),
      newsletter_status = coalesce(EXCLUDED.newsletter_status, public.crm_leads.newsletter_status),
      marketing_consent = public.crm_leads.marketing_consent OR EXCLUDED.marketing_consent,
      source_count = public.crm_leads.source_count + 1,
      last_activity_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- Trigger: any new contact_message → upsert lead
CREATE OR REPLACE FUNCTION public.contact_messages_to_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.crm_upsert_lead(
    NEW.tenant_id, NEW.email,
    coalesce(NEW.first_name, split_part(NEW.name,' ',1)),
    coalesce(NEW.last_name,  nullif(substring(NEW.name from position(' ' in NEW.name)+1), '')),
    NEW.phone, NEW.company,
    NEW.newsletter_opt_in, NEW.consent
  );
  RETURN NEW;
END $$;
CREATE TRIGGER trg_contact_messages_to_lead AFTER INSERT ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.contact_messages_to_lead();

-- Trigger: any newsletter subscriber → upsert lead
CREATE OR REPLACE FUNCTION public.newsletter_to_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.crm_upsert_lead(
    NEW.tenant_id, NEW.email, NEW.first_name, NEW.last_name,
    NULL, NULL, true, true
  );
  UPDATE public.crm_leads
     SET newsletter_status = NEW.status
   WHERE tenant_id = NEW.tenant_id AND email_norm = lower(NEW.email);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_newsletter_to_lead AFTER INSERT OR UPDATE OF status ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_to_lead();

-- Backfill from existing contact_messages and newsletter_subscribers
INSERT INTO public.crm_leads (tenant_id, email_norm, email, first_name, last_name, phone, company, marketing_consent, source_count, last_activity_at, created_at)
SELECT tenant_id, lower(email), max(email),
       max(first_name), max(last_name), max(phone), max(company),
       bool_or(consent), count(*)::int, max(created_at), min(created_at)
  FROM public.contact_messages
 GROUP BY tenant_id, lower(email)
ON CONFLICT (tenant_id, email_norm) DO NOTHING;

INSERT INTO public.crm_leads (tenant_id, email_norm, email, first_name, last_name, marketing_consent, source_count, last_activity_at, created_at, newsletter_status)
SELECT tenant_id, lower(email), max(email),
       max(first_name), max(last_name),
       true, count(*)::int, max(coalesce(updated_at, created_at)), min(created_at), max(status)
  FROM public.newsletter_subscribers
 GROUP BY tenant_id, lower(email)
ON CONFLICT (tenant_id, email_norm) DO UPDATE
   SET source_count = public.crm_leads.source_count + EXCLUDED.source_count,
       newsletter_status = coalesce(EXCLUDED.newsletter_status, public.crm_leads.newsletter_status);

-- Cross-tenant view for super admins
CREATE OR REPLACE VIEW public.crm_leads_all AS
  SELECT l.*, t.slug AS tenant_slug, t.name AS tenant_name
    FROM public.crm_leads l
    LEFT JOIN public.tenants t ON t.id = l.tenant_id;
GRANT SELECT ON public.crm_leads_all TO authenticated;
