
CREATE TABLE IF NOT EXISTS public.newsletter_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  name text NOT NULL,
  subject_pl text NOT NULL DEFAULT '',
  subject_en text NOT NULL DEFAULT '',
  html_pl text NOT NULL DEFAULT '',
  html_en text NOT NULL DEFAULT '',
  from_name text,
  from_email text,
  reply_to text,
  audience_filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','sending','sent','failed','cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  recipient_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.newsletter_campaigns TO authenticated;
GRANT ALL ON public.newsletter_campaigns TO service_role;

ALTER TABLE public.newsletter_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaigns_staff_select" ON public.newsletter_campaigns;
CREATE POLICY "campaigns_staff_select" ON public.newsletter_campaigns
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));

DROP POLICY IF EXISTS "campaigns_staff_insert" ON public.newsletter_campaigns;
CREATE POLICY "campaigns_staff_insert" ON public.newsletter_campaigns
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));

DROP POLICY IF EXISTS "campaigns_staff_update" ON public.newsletter_campaigns;
CREATE POLICY "campaigns_staff_update" ON public.newsletter_campaigns
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')))
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "campaigns_staff_delete" ON public.newsletter_campaigns;
CREATE POLICY "campaigns_staff_delete" ON public.newsletter_campaigns
  FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id()
    AND has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS newsletter_campaigns_tenant_idx
  ON public.newsletter_campaigns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS newsletter_campaigns_status_idx
  ON public.newsletter_campaigns (tenant_id, status);

DROP TRIGGER IF EXISTS newsletter_campaigns_updated_at ON public.newsletter_campaigns;
CREATE TRIGGER newsletter_campaigns_updated_at
  BEFORE UPDATE ON public.newsletter_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.newsletter_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  campaign_id uuid NOT NULL REFERENCES public.newsletter_campaigns(id) ON DELETE CASCADE,
  subscriber_id uuid REFERENCES public.newsletter_subscribers(id) ON DELETE SET NULL,
  email text NOT NULL,
  language text NOT NULL DEFAULT 'pl',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','skipped')),
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, email)
);

GRANT SELECT ON public.newsletter_campaign_recipients TO authenticated;
GRANT ALL ON public.newsletter_campaign_recipients TO service_role;

ALTER TABLE public.newsletter_campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_recipients_staff_select" ON public.newsletter_campaign_recipients;
CREATE POLICY "campaign_recipients_staff_select" ON public.newsletter_campaign_recipients
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));

CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_idx
  ON public.newsletter_campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS campaign_recipients_tenant_idx
  ON public.newsletter_campaign_recipients (tenant_id, created_at DESC);
