ALTER TABLE public.contact_messages
  ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS contact_messages_form_id_created_idx
  ON public.contact_messages (tenant_id, form_id, created_at DESC);