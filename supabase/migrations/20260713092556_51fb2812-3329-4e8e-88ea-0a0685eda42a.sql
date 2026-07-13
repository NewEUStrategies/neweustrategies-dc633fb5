-- =============================================================================
-- PR #20 redeploy: tracker depth + positions, donations, MFA step-up,
-- site_settings composite PK. All 4 migrations combined, idempotent.
-- =============================================================================

-- ---------- 20260714110000_tracker_depth_positions.sql -----------------------
ALTER TABLE public.eu_policy_items
  ADD COLUMN IF NOT EXISTS rapporteur text
    CHECK (rapporteur IS NULL OR length(btrim(rapporteur)) BETWEEN 2 AND 120),
  ADD COLUMN IF NOT EXISTS committee text
    CHECK (committee IS NULL OR length(btrim(committee)) BETWEEN 2 AND 40),
  ADD COLUMN IF NOT EXISTS lead_dg text
    CHECK (lead_dg IS NULL OR length(btrim(lead_dg)) BETWEEN 2 AND 60);

COMMENT ON COLUMN public.eu_policy_items.rapporteur IS
  'Sprawozdawca PE (nazwisko, neutralne językowo).';
COMMENT ON COLUMN public.eu_policy_items.committee IS
  'Komisja wiodąca PE, kod (np. LIBE, ITRE).';
COMMENT ON COLUMN public.eu_policy_items.lead_dg IS
  'Wiodąca DG Komisji Europejskiej (np. DG CNECT).';

CREATE TABLE IF NOT EXISTS public.eu_policy_positions (
  item_id uuid NOT NULL REFERENCES public.eu_policy_items(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  country_code text NOT NULL
    CHECK (country_code IN ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR',
                            'DE','GR','HU','IE','IT','LV','LT','LU','MT','NL',
                            'PL','PT','RO','SK','SI','ES','SE')),
  stance text NOT NULL
    CHECK (stance IN ('support', 'oppose', 'mixed', 'undecided')),
  note_pl text CHECK (note_pl IS NULL OR length(btrim(note_pl)) <= 500),
  note_en text CHECK (note_en IS NULL OR length(btrim(note_en)) <= 500),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, country_code)
);

CREATE INDEX IF NOT EXISTS idx_eu_policy_positions_tenant
  ON public.eu_policy_positions (tenant_id, item_id);

CREATE OR REPLACE FUNCTION public.tg_eu_policy_position_pin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.eu_policy_items WHERE id = NEW.item_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'eu_policy_positions: unknown item %', NEW.item_id;
  END IF;
  NEW.tenant_id := v_tenant;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS eu_policy_position_pin ON public.eu_policy_positions;
CREATE TRIGGER eu_policy_position_pin
  BEFORE INSERT OR UPDATE ON public.eu_policy_positions
  FOR EACH ROW EXECUTE FUNCTION public.tg_eu_policy_position_pin();

GRANT SELECT ON public.eu_policy_positions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.eu_policy_positions TO authenticated;
GRANT ALL ON public.eu_policy_positions TO service_role;
ALTER TABLE public.eu_policy_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy positions public read" ON public.eu_policy_positions;
CREATE POLICY "policy positions public read" ON public.eu_policy_positions
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.eu_policy_items i
       WHERE i.id = eu_policy_positions.item_id AND i.status = 'published'
    )
  );

DROP POLICY IF EXISTS "policy positions staff all" ON public.eu_policy_positions;
CREATE POLICY "policy positions staff all" ON public.eu_policy_positions
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ---------- 20260714111000_donations.sql -------------------------------------
CREATE TABLE IF NOT EXISTS public.donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'PLN',
  donor_email text,
  message text CHECK (message IS NULL OR length(btrim(message)) <= 500),
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe', 'mock')),
  provider_session_id text NOT NULL,
  provider_intent_id text,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_session_id)
);

CREATE INDEX IF NOT EXISTS idx_donations_tenant
  ON public.donations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_donations_intent
  ON public.donations (provider_intent_id);

GRANT SELECT ON public.donations TO authenticated;
GRANT ALL ON public.donations TO service_role;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "donations admin read" ON public.donations;
CREATE POLICY "donations admin read" ON public.donations
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

-- ---------- 20260714112000_mfa_staff_stepup.sql ------------------------------
CREATE OR REPLACE FUNCTION public.has_verified_mfa()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM auth.mfa_factors f
     WHERE f.user_id = auth.uid()
       AND f.status = 'verified'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_verified_mfa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_verified_mfa() TO authenticated, service_role;

-- ---------- 20260714113000_site_settings_tenant_pk.sql -----------------------
DO $$
DECLARE
  v_has_composite boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.site_settings'::regclass
       AND c.contype = 'p'
       AND a.attname = 'tenant_id'
  ) INTO v_has_composite;

  IF NOT v_has_composite THEN
    ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_pkey;
    ALTER TABLE public.site_settings
      ADD CONSTRAINT site_settings_pkey PRIMARY KEY (tenant_id, key);
  END IF;
END $$;