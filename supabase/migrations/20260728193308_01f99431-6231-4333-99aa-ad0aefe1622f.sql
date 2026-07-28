CREATE TABLE IF NOT EXISTS public.auth_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  run_id text,
  message_id text,
  email_type text NOT NULL,
  lang text,
  lang_source text,
  lang_fallback boolean NOT NULL DEFAULT false,
  lang_raw text,
  recipient_masked text,
  recipient_domain text,
  sender text,
  sender_domain text,
  subject text,
  redirect_to text,
  action_url_host text,
  greeting_name text,
  status text NOT NULL DEFAULT 'enqueued',
  error_message text,
  duration_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS auth_email_events_created_at_idx
  ON public.auth_email_events (created_at DESC);
CREATE INDEX IF NOT EXISTS auth_email_events_type_idx
  ON public.auth_email_events (email_type, created_at DESC);

GRANT ALL ON public.auth_email_events TO service_role;

ALTER TABLE public.auth_email_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role manages auth email events" ON public.auth_email_events;
CREATE POLICY "service role manages auth email events"
  ON public.auth_email_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);