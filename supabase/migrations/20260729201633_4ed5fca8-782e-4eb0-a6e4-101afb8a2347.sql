CREATE TABLE public.payment_integration_state (
  environment text PRIMARY KEY CHECK (environment IN ('sandbox','live')),
  fingerprint text,
  last_synced_at timestamptz,
  last_status text CHECK (last_status IN ('ok','partial','failed')),
  last_reason text,
  last_error text,
  last_report jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.payment_integration_state TO service_role;

ALTER TABLE public.payment_integration_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_integration_state_service_only"
  ON public.payment_integration_state FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_payment_integration_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_integration_state_updated_at
  BEFORE UPDATE ON public.payment_integration_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_payment_integration_state();