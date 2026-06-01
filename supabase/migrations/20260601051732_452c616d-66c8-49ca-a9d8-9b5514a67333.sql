-- ENUMs
DO $$ BEGIN
  CREATE TYPE public.access_mode AS ENUM ('public','members','paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.access_entity_type AS ENUM ('post','page','media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.plan_interval AS ENUM ('month','year','one_time');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.purchase_status AS ENUM ('pending','active','refunded','canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) access_plans
CREATE TABLE public.access_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  name_pl text NOT NULL DEFAULT '',
  name_en text NOT NULL DEFAULT '',
  description_pl text,
  description_en text,
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PLN',
  interval plan_interval NOT NULL DEFAULT 'month',
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.access_plans TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_plans TO authenticated;
GRANT ALL ON public.access_plans TO service_role;

ALTER TABLE public.access_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plans public read"
  ON public.access_plans FOR SELECT
  USING (active = true OR (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'editor'::app_role))));

CREATE POLICY "plans staff insert"
  ON public.access_plans FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'editor'::app_role)));

CREATE POLICY "plans staff update"
  ON public.access_plans FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'editor'::app_role)))
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "plans staff delete"
  ON public.access_plans FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER trg_access_plans_updated
  BEFORE UPDATE ON public.access_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) content_access
CREATE TABLE public.content_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  entity_type access_entity_type NOT NULL,
  entity_id uuid NOT NULL,
  mode access_mode NOT NULL DEFAULT 'public',
  plan_ids uuid[] NOT NULL DEFAULT '{}',
  one_time_price_cents integer,
  one_time_currency text DEFAULT 'PLN',
  teaser_pl text,
  teaser_en text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id)
);

CREATE INDEX idx_content_access_entity ON public.content_access (entity_type, entity_id);
CREATE INDEX idx_content_access_tenant ON public.content_access (tenant_id);

GRANT SELECT ON public.content_access TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_access TO authenticated;
GRANT ALL ON public.content_access TO service_role;

ALTER TABLE public.content_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_access public read"
  ON public.content_access FOR SELECT
  USING (true);

CREATE POLICY "content_access staff manage"
  ON public.content_access FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'editor'::app_role) OR has_role(auth.uid(),'author'::app_role)))
  WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'editor'::app_role) OR has_role(auth.uid(),'author'::app_role)));

CREATE TRIGGER trg_content_access_updated
  BEFORE UPDATE ON public.content_access
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) user_purchases
CREATE TABLE public.user_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  entity_type access_entity_type NOT NULL,
  entity_id uuid NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PLN',
  status purchase_status NOT NULL DEFAULT 'active',
  external_ref text,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entity_type, entity_id)
);

CREATE INDEX idx_user_purchases_user ON public.user_purchases (user_id);
CREATE INDEX idx_user_purchases_entity ON public.user_purchases (entity_type, entity_id);

GRANT SELECT, INSERT ON public.user_purchases TO authenticated;
GRANT ALL ON public.user_purchases TO service_role;

ALTER TABLE public.user_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchases owner read"
  ON public.user_purchases FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (tenant_id = current_tenant_id() AND has_role(auth.uid(),'admin'::app_role)));

-- inserts will normally happen via service_role (server-side checkout)

-- 4) user_subscriptions
CREATE TABLE public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES public.access_plans(id) ON DELETE CASCADE,
  status purchase_status NOT NULL DEFAULT 'active',
  external_ref text,
  started_at timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_subs_user ON public.user_subscriptions (user_id);
CREATE INDEX idx_user_subs_plan ON public.user_subscriptions (plan_id);

GRANT SELECT ON public.user_subscriptions TO authenticated;
GRANT ALL ON public.user_subscriptions TO service_role;

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subs owner read"
  ON public.user_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (tenant_id = current_tenant_id() AND has_role(auth.uid(),'admin'::app_role)));

-- 5) access function
CREATE OR REPLACE FUNCTION public.has_content_access(
  _user_id uuid,
  _entity_type access_entity_type,
  _entity_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode access_mode;
  v_plans uuid[];
BEGIN
  SELECT mode, plan_ids INTO v_mode, v_plans
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF NOT FOUND OR v_mode = 'public' THEN
    RETURN true;
  END IF;

  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_mode = 'members' THEN
    RETURN true;
  END IF;

  -- mode = 'paid'
  IF EXISTS (
    SELECT 1 FROM public.user_purchases
     WHERE user_id = _user_id
       AND entity_type = _entity_type
       AND entity_id = _entity_id
       AND status = 'active'
  ) THEN
    RETURN true;
  END IF;

  IF array_length(v_plans, 1) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_subscriptions
     WHERE user_id = _user_id
       AND plan_id = ANY (v_plans)
       AND status = 'active'
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

GRANT EXECUTE ON FUNCTION public.has_content_access(uuid, access_entity_type, uuid) TO anon, authenticated;