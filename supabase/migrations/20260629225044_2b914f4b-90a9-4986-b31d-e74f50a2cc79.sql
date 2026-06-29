
ALTER TABLE public.contact_messages
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS newsletter_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS contact_messages_unread_idx
  ON public.contact_messages (tenant_id, created_at DESC)
  WHERE read_at IS NULL AND archived_at IS NULL;

-- Contact form configuration storage (per-tenant) for admin defaults / email templates
CREATE TABLE IF NOT EXISTS public.contact_form_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  default_recipient text,
  auto_reply_enabled boolean NOT NULL DEFAULT true,
  auto_reply_subject_pl text NOT NULL DEFAULT 'Dziękujemy za wiadomość',
  auto_reply_subject_en text NOT NULL DEFAULT 'Thank you for your message',
  auto_reply_body_pl text NOT NULL DEFAULT 'Dziękujemy za kontakt - odpowiemy najszybciej jak to możliwe.',
  auto_reply_body_en text NOT NULL DEFAULT 'Thanks for reaching out - we will reply as soon as possible.',
  notify_admin_enabled boolean NOT NULL DEFAULT true,
  notify_admin_subject_pl text NOT NULL DEFAULT 'Nowa wiadomość kontaktowa',
  notify_admin_subject_en text NOT NULL DEFAULT 'New contact message',
  from_address text,
  from_name text,
  newsletter_double_optin boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_form_settings TO authenticated;
GRANT ALL ON public.contact_form_settings TO service_role;

ALTER TABLE public.contact_form_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read contact settings"
  ON public.contact_form_settings FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'editor')));

CREATE POLICY "Admins can manage contact settings"
  ON public.contact_form_settings FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() AND has_role(auth.uid(),'admin'))
  WITH CHECK (tenant_id = current_tenant_id() AND has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_contact_form_settings_updated_at
  BEFORE UPDATE ON public.contact_form_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
