
-- Module B: Profile + Checkout foundations

-- 1. Extend access_plans with features and badge
ALTER TABLE public.access_plans
  ADD COLUMN IF NOT EXISTS features_pl jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS features_en jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS badge_pl text,
  ADD COLUMN IF NOT EXISTS badge_en text,
  ADD COLUMN IF NOT EXISTS highlighted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_days integer NOT NULL DEFAULT 0;

-- 2. Billing profiles (one per user, per tenant)
CREATE TABLE IF NOT EXISTS public.billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name text,
  company text,
  tax_id text,
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  postal_code text,
  region text,
  country_code text NOT NULL DEFAULT 'PL',
  is_company boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_profiles TO authenticated;
GRANT ALL ON public.billing_profiles TO service_role;

ALTER TABLE public.billing_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing owner read" ON public.billing_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "billing owner insert" ON public.billing_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.current_tenant_id());
CREATE POLICY "billing owner update" ON public.billing_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "billing owner delete" ON public.billing_profiles FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER billing_profiles_updated_at BEFORE UPDATE ON public.billing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Payment orders (universal: subscription, one-time, post purchase)
DO $$ BEGIN
  CREATE TYPE public.order_kind AS ENUM ('subscription', 'one_time');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.order_status AS ENUM ('pending', 'processing', 'paid', 'failed', 'refunded', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.order_kind NOT NULL,
  status public.order_status NOT NULL DEFAULT 'pending',
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PLN',
  plan_id uuid REFERENCES public.access_plans(id) ON DELETE SET NULL,
  entity_type public.access_entity_type,
  entity_id uuid,
  provider text NOT NULL DEFAULT 'stripe',
  provider_session_id text,
  provider_intent_id text,
  invoice_url text,
  receipt_email text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON public.payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_tenant ON public.payment_orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_session ON public.payment_orders(provider_session_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_orders TO authenticated;
GRANT ALL ON public.payment_orders TO service_role;

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders owner read" ON public.payment_orders FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "orders owner insert" ON public.payment_orders FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.current_tenant_id());
CREATE POLICY "orders admin update" ON public.payment_orders FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER payment_orders_updated_at BEFORE UPDATE ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Allow user_subscriptions/user_purchases insert via service_role only (already locked - just ensure)
-- (Webhook will use service role to insert)
