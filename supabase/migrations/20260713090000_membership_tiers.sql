-- ============================================================================
-- SPOŁECZNOŚĆ 1/10: warstwy członkostwa (tiers).
--
-- Model wzorowany na platformach eksperckich (Chatham House / Politico Pro):
-- zamiast binarnego "ma subskrypcję / nie ma", każdy plan (access_plans) mapuje
-- się na WARSTWĘ członkostwa o rosnącej randze. Warstwa jest jedynym miejscem,
-- o które pytają bramki funkcji społecznościowych (wydarzenia dla członków,
-- briefingi Pro, priorytet Q&A): "czy ranga wołającego >= wymagana ranga".
--
--   membership_tiers        katalog warstw per tenant (reader/member/pro),
--                           benefits = lista marketingowa [{pl,en}],
--                           features = maszynowe bramki {"events_members":true}.
--   access_plans.tier_key   plan sprzedażowy wskazuje warstwę, którą nadaje.
--   current_membership_tier() / current_tier_rank() / has_tier_rank(n)
--                           rozstrzygane WYŁĄCZNIE serwerowo (SECURITY DEFINER):
--                           najwyższa ranga wśród AKTYWNYCH subskrypcji,
--                           fallback do warstwy domyślnej tenantu.
--
-- Wszystko idempotentne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.membership_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  rank integer NOT NULL DEFAULT 0,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  description_pl text,
  description_en text,
  benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  CHECK (key ~ '^[a-z0-9_-]{2,32}$'),
  CHECK (rank >= 0),
  CHECK (btrim(name_pl) <> '' AND btrim(name_en) <> ''),
  CHECK (jsonb_typeof(benefits) = 'array'),
  CHECK (jsonb_typeof(features) = 'object')
);

-- Dokładnie jedna warstwa domyślna (dla zalogowanych bez subskrypcji) per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_tiers_default
  ON public.membership_tiers (tenant_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_membership_tiers_tenant_rank
  ON public.membership_tiers (tenant_id, rank DESC) WHERE active;

DROP TRIGGER IF EXISTS membership_tiers_set_updated_at ON public.membership_tiers;
CREATE TRIGGER membership_tiers_set_updated_at
  BEFORE UPDATE ON public.membership_tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.membership_tiers TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.membership_tiers TO authenticated;
GRANT ALL ON public.membership_tiers TO service_role;
ALTER TABLE public.membership_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tiers public read" ON public.membership_tiers;
CREATE POLICY "tiers public read" ON public.membership_tiers
  FOR SELECT TO anon, authenticated
  USING (active AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "tiers staff read" ON public.membership_tiers;
CREATE POLICY "tiers staff read" ON public.membership_tiers
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "tiers admin write" ON public.membership_tiers;
CREATE POLICY "tiers admin write" ON public.membership_tiers
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

-- Plan sprzedażowy wskazuje nadawaną warstwę.
ALTER TABLE public.access_plans ADD COLUMN IF NOT EXISTS tier_key text;

-- ----------------------------------------------------------------------------
-- Rozstrzyganie warstwy wołającego. Zwraca dokładnie jeden wiersz:
--   1. najwyższa ranga wśród aktywnych subskrypcji (plan -> tier_key),
--   2. inaczej warstwa domyślna tenantu,
--   3. inaczej wbudowany fallback ('reader', 0) - żeby bramki nigdy nie padły.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_membership_tier()
RETURNS TABLE (key text, rank integer, name_pl text, name_en text, features jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT COALESCE(public.public_tenant_id(), public.current_tenant_id()) AS tid
  ),
  sub_tier AS (
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
      JOIN t ON ap.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key AND mt.active
     WHERE us.user_id = auth.uid()
       AND us.status = 'active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
     ORDER BY mt.rank DESC
     LIMIT 1
  ),
  def AS (
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.membership_tiers mt
      JOIN t ON mt.tenant_id = t.tid
     WHERE mt.is_default AND mt.active
     LIMIT 1
  )
  SELECT * FROM sub_tier
  UNION ALL
  SELECT * FROM def WHERE NOT EXISTS (SELECT 1 FROM sub_tier)
  UNION ALL
  SELECT 'reader', 0, 'Czytelnik', 'Reader', '{}'::jsonb
   WHERE NOT EXISTS (SELECT 1 FROM sub_tier)
     AND NOT EXISTS (SELECT 1 FROM def);
$$;

REVOKE EXECUTE ON FUNCTION public.current_membership_tier() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_membership_tier()
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_tier_rank()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT rank FROM public.current_membership_tier() LIMIT 1), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.current_tier_rank() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_tier_rank() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_tier_rank(_min integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_tier_rank() >= COALESCE(_min, 0);
$$;

REVOKE EXECUTE ON FUNCTION public.has_tier_rank(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_tier_rank(integer) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Seed trzech warstw dla KAŻDEGO istniejącego tenanta + trigger dla nowych.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_membership_tiers(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.membership_tiers
    (tenant_id, key, rank, name_pl, name_en, description_pl, description_en,
     benefits, features, is_default, sort_order)
  SELECT p_tenant, v.key, v.rank, v.name_pl, v.name_en, v.desc_pl, v.desc_en,
         v.benefits, v.features, v.is_default, v.sort_order
    FROM (VALUES
      ('reader', 0,
       'Czytelnik', 'Reader',
       'Bezpłatne konto: lektura, zakładki, obserwowanie i dyskusja.',
       'Free account: reading, bookmarks, follows and discussion.',
       '[{"pl":"Dostęp do treści otwartych","en":"Access to open content"},
         {"pl":"Zakładki i obserwowanie tematów","en":"Bookmarks and topic follows"},
         {"pl":"Udział w dyskusjach","en":"Join the discussion"}]'::jsonb,
       '{}'::jsonb, true, 0),
      ('member', 10,
       'Członek', 'Member',
       'Pełny dostęp do analiz oraz wydarzeń i briefingów dla członków.',
       'Full access to analyses plus member events and briefings.',
       '[{"pl":"Wszystkie analizy premium","en":"All premium analyses"},
         {"pl":"Wydarzenia i briefingi dla członków","en":"Member events and briefings"},
         {"pl":"Nagrania z wydarzeń","en":"Event recordings"},
         {"pl":"Cotygodniowy digest e-mail","en":"Weekly e-mail digest"}]'::jsonb,
       '{"events_members": true, "recordings": true}'::jsonb, false, 10),
      ('pro', 20,
       'Pro', 'Pro',
       'Dla profesjonalistów public affairs: pełny pakiet plus priorytet pytań do ekspertów.',
       'For public-affairs professionals: everything plus priority expert Q&A.',
       '[{"pl":"Wszystko z planu Członek","en":"Everything in Member"},
         {"pl":"Priorytet pytań w sesjach Q&A","en":"Priority in expert Q&A"},
         {"pl":"Zamknięte briefingi Pro","en":"Closed-door Pro briefings"},
         {"pl":"Tracker legislacyjny z alertami","en":"Legislative tracker with alerts"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true}'::jsonb,
       false, 20)
    ) AS v(key, rank, name_pl, name_en, desc_pl, desc_en, benefits, features, is_default, sort_order)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.membership_tiers mt
      WHERE mt.tenant_id = p_tenant AND mt.key = v.key
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) TO service_role;

DO $$
DECLARE v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_membership_tiers(v_t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.tg_tenants_seed_membership_tiers()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_membership_tiers(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_seed_membership_tiers ON public.tenants;
CREATE TRIGGER tenants_seed_membership_tiers
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tg_tenants_seed_membership_tiers();

-- Istniejące płatne plany nadają domyślnie warstwę "member" (admin może
-- przemapować w panelu; NULL zostaje tylko tam, gdzie ktoś świadomie odepnie).
UPDATE public.access_plans SET tier_key = 'member' WHERE tier_key IS NULL;
