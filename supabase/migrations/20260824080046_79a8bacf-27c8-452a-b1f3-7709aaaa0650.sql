ALTER TABLE public.payment_webhook_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE public.payment_webhook_events e
SET tenant_id = COALESCE(
  (SELECT p.tenant_id FROM public.profiles p WHERE p.id = e.user_id),
  public.email_default_tenant_id()
)
WHERE e.tenant_id IS NULL;

ALTER TABLE public.payment_webhook_events
  ALTER COLUMN tenant_id SET DEFAULT public.email_default_tenant_id();

ALTER TABLE public.payment_webhook_events
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS payment_webhook_events_tenant_idx
  ON public.payment_webhook_events (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.tg_payment_webhook_events_bind_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.tenant_id := COALESCE(
    (SELECT p.tenant_id FROM public.profiles p WHERE p.id = NEW.user_id),
    NEW.tenant_id,
    public.email_default_tenant_id()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_webhook_events_bind_tenant ON public.payment_webhook_events;
CREATE TRIGGER payment_webhook_events_bind_tenant
  BEFORE INSERT OR UPDATE OF user_id ON public.payment_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_webhook_events_bind_tenant();

DROP POLICY IF EXISTS "payment_webhook_events admin read" ON public.payment_webhook_events;
CREATE POLICY "payment_webhook_events admin read"
  ON public.payment_webhook_events FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_super_admin());