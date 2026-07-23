CREATE TABLE IF NOT EXISTS public.billing_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  subscription_id uuid REFERENCES public.user_subscriptions(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.payment_orders(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'receipt', 'credit_note')),
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'open', 'void', 'refunded')),
  provider text NOT NULL DEFAULT 'stripe',
  provider_document_id text NOT NULL,
  number text,
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PLN',
  hosted_url text,
  pdf_url text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(provider_document_id) <> ''),
  UNIQUE (provider, provider_document_id)
);

COMMENT ON TABLE public.billing_documents IS
  'Rejestr dokumentów rozliczeniowych (faktury/paragony Stripe, w tym odnowienia subskrypcji). Zapis wyłącznie przez webhook (service_role); podgląd: właściciel + staff tenanta.';

CREATE INDEX IF NOT EXISTS idx_billing_documents_user
  ON public.billing_documents (user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_documents_tenant
  ON public.billing_documents (tenant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_documents_order
  ON public.billing_documents (order_id) WHERE order_id IS NOT NULL;

GRANT SELECT ON public.billing_documents TO authenticated;
GRANT ALL ON public.billing_documents TO service_role;

ALTER TABLE public.billing_documents ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_billing_documents_updated ON public.billing_documents;
CREATE TRIGGER trg_billing_documents_updated
  BEFORE UPDATE ON public.billing_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS billing_documents_owner_select ON public.billing_documents;
CREATE POLICY billing_documents_owner_select
  ON public.billing_documents FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS billing_documents_staff_select ON public.billing_documents;
CREATE POLICY billing_documents_staff_select
  ON public.billing_documents FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

CREATE OR REPLACE FUNCTION public.tg_billing_documents_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'billing_document', NEW.id::text, 'billing_document.issued.v1',
      jsonb_build_object(
        'user_id', NEW.user_id, 'kind', NEW.kind, 'number', NEW.number,
        'amount_cents', NEW.amount_cents, 'currency', NEW.currency
      ),
      NEW.user_id
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'billing_document', NEW.id::text, 'billing_document.updated.v1',
      jsonb_build_object(
        'user_id', NEW.user_id, 'kind', NEW.kind,
        'old_status', OLD.status, 'new_status', NEW.status
      ),
      NEW.user_id
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_documents_emit_events ON public.billing_documents;
CREATE TRIGGER trg_billing_documents_emit_events
  AFTER INSERT OR UPDATE ON public.billing_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_billing_documents_emit_events();

CREATE OR REPLACE FUNCTION public.tg_user_subscriptions_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier_key text;
BEGIN
  SELECT ap.tier_key INTO v_tier_key
    FROM public.access_plans ap WHERE ap.id = NEW.plan_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'subscription', NEW.id::text, 'subscription.started.v1',
      jsonb_build_object(
        'user_id', NEW.user_id, 'plan_id', NEW.plan_id, 'tier_key', v_tier_key,
        'status', NEW.status::text, 'current_period_end', NEW.current_period_end
      ),
      NEW.user_id
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'subscription', NEW.id::text, 'subscription.status_changed.v1',
        jsonb_build_object(
          'user_id', NEW.user_id, 'plan_id', NEW.plan_id, 'tier_key', v_tier_key,
          'old_status', OLD.status::text, 'new_status', NEW.status::text
        ),
        NEW.user_id
      );
    ELSIF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'subscription', NEW.id::text, 'subscription.updated.v1',
        jsonb_build_object(
          'user_id', NEW.user_id, 'plan_id', NEW.plan_id, 'tier_key', v_tier_key,
          'status', NEW.status::text, 'plan_changed', true,
          'old_plan_id', OLD.plan_id, 'new_plan_id', NEW.plan_id,
          'cancel_scheduled', NEW.canceled_at IS NOT NULL,
          'current_period_end', NEW.current_period_end
        ),
        NEW.user_id
      );
    ELSIF NEW.canceled_at IS DISTINCT FROM OLD.canceled_at
       OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end THEN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'subscription', NEW.id::text, 'subscription.updated.v1',
        jsonb_build_object(
          'user_id', NEW.user_id, 'plan_id', NEW.plan_id, 'tier_key', v_tier_key,
          'status', NEW.status::text,
          'cancel_scheduled', NEW.canceled_at IS NOT NULL,
          'current_period_end', NEW.current_period_end
        ),
        NEW.user_id
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_subscriptions_emit_events ON public.user_subscriptions;
CREATE TRIGGER trg_user_subscriptions_emit_events
  AFTER INSERT OR UPDATE ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_subscriptions_emit_events();