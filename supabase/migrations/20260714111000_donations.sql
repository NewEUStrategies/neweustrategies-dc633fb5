-- ============================================================================
-- Kanał darowizn / mecenatu (P1, model "mecenatu obywatelskiego" Nowej
-- Konfederacji) - rekomendacja z docs/OCENA_KONKURENCYJNA_2026-07-13.md.
--
-- Darowizny celowo NIE przechodzą przez payment_orders: tamta tabela wymaga
-- user_id (darczyńca może być anonimowy) i zasila silnik uprawnień
-- (grantEntitlement) - darowizna nie nadaje żadnego dostępu. Zamiast tego
-- lekka tabela księgowa zapisywana WYŁĄCZNIE przez service role:
--   - webhook Stripe (checkout.session.completed z metadata.kind=donation),
--   - tryb mock (brak klucza Stripe) w server fn.
-- Unikalny provider_session_id czyni zapis idempotentnym przy retry webhooka.
-- ============================================================================

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

-- Zapis tylko service role (webhook / mock server fn); odczyt tylko admin
-- swojego tenanta. Celowo BEZ grantów INSERT/UPDATE dla authenticated.
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
