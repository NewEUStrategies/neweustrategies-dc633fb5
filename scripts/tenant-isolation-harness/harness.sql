-- Minimalna atrapa platformy potrzebna do WYKONANIA polityk RLS plaszczyzny
-- wlasciciela (media_mentions, saved_searches, user_follows) na czystym
-- Postgresie. Odtwarza wylacznie to, na czym te polityki realnie stoja:
-- auth.uid(), tenants, profiles, current_tenant_id(), public_tenant_id(),
-- has_role() oraz same tabele w ksztalcie z migracji zrodlowych.
--
-- Testowanym artefaktem sa POLITYKI z prawdziwej migracji (run.sh aplikuje plik
-- z supabase/migrations), a nie ich kopia - atrapa dostarcza tylko otoczenia.
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'author', 'user', 'super_admin');

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  display_name text
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

INSERT INTO public.tenants (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'nes'),
  ('22222222-2222-2222-2222-222222222222', 'Tenant B', 'tb');

CREATE OR REPLACE FUNCTION public.public_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.user_id = _user_id
       AND ur.role = _role
       AND p.tenant_id = public.current_tenant_id()
  )
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- --------------------------------------------------------------------------
-- Tabele w ksztalcie z migracji zrodlowych (kolumny istotne dla RLS).
-- --------------------------------------------------------------------------
CREATE TABLE public.media_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outlet text NOT NULL,
  title text NOT NULL,
  published_on date NOT NULL DEFAULT current_date,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  query text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);

GRANT SELECT ON public.media_mentions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.media_mentions TO authenticated;
GRANT ALL ON public.media_mentions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_searches TO authenticated;
GRANT ALL ON public.saved_searches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_follows TO authenticated;
GRANT ALL ON public.user_follows TO service_role;

ALTER TABLE public.media_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;

-- Stan SPRZED naprawy: polityki bez tenanta. Migracja z supabase/migrations je
-- podmienia - dzieki temu harness sprawdza takze, ze podmiana faktycznie zaszla.
CREATE POLICY "media_mentions public read" ON public.media_mentions
  FOR SELECT TO anon, authenticated
  USING (is_public = true AND tenant_id = (SELECT public.public_tenant_id()));
CREATE POLICY "media_mentions owner read" ON public.media_mentions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY "media_mentions owner manage" ON public.media_mentions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "media_mentions staff manage" ON public.media_mentions
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::public.app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::public.app_role)
    )
  );

CREATE POLICY "saved_searches owner select" ON public.saved_searches
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "saved_searches owner insert" ON public.saved_searches
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "saved_searches owner update" ON public.saved_searches
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "saved_searches owner delete" ON public.saved_searches
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "follows owner select" ON public.user_follows
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "follows owner insert" ON public.user_follows
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "follows owner delete" ON public.user_follows
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ==========================================================================
-- ROZSZERZENIE 2026-08-31: plaszczyzna wlasciciela w modulach monetyzacji.
--
-- Przeglad polityk modulow 13 (checkout/subskrypcje/billing) i 14 (kupony/
-- darowizny/prezenty/reklamy) wykazal SZESC dalszych wystapien tego samego
-- wzorca, co naprawiony 2026-08-29: odczyt wlasciciela bez predykatu tenanta
-- na tabeli, ktora tenant_id ma. Bramka `check:sql-owner-tenant-scope` ich nie
-- widzi, bo kazda z tych tabel ma DOKLADNIE JEDNA polityke wlascicielska
-- (tenanta pilnuje polityka ADMINISTRACYJNA, a wiec nie ma rodzenstwa
-- deklarujacego intencje) - dlatego dowod musi byc wykonawczy, nie statyczny.
--
-- Kolumny sa okrojone do tych, na ktorych stoi RLS. Polityki ponizej odtwarzaja
-- stan SPRZED naprawy - migracja 20260831060000 je podmienia.
-- ==========================================================================
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.membership_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier_key text NOT NULL DEFAULT 'member',
  source text NOT NULL DEFAULT 'manual',
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  org_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_email text,
  role text NOT NULL DEFAULT 'member',
  claimed_at timestamptz
);

CREATE TABLE public.user_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Wlascicielem linku prezentowego jest `created_by`, nie `user_id` - dlatego ta
-- luka jest niewidoczna dla heurystyki nazwy kolumny.
CREATE TABLE public.post_gift_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  post_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Atrapa wylacznie po to, by migracja 20260831060000 wykonala sie w calosci:
-- niesie ona COMMENT ON COLUMN dokumentujacy ROZSTRZYGNIECIE sprawy tenant_id
-- na tej tabeli. Bez atrapy caly plik migracji zostalby pominiety (--single-
-- transaction), a asercje ponizej testowalyby stan SPRZED naprawy, milczac.
CREATE TABLE public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'stripe',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.payment_webhook_events TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_grants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_seats TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_purchases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_gift_links TO authenticated;
GRANT ALL ON public.subscriptions, public.membership_grants, public.organization_seats,
  public.user_purchases, public.user_subscriptions, public.post_gift_links TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_gift_links ENABLE ROW LEVEL SECURITY;

-- Stan SPRZED naprawy - dokladnie tresc z migracji zrodlowych.
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "grants own read" ON public.membership_grants
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "seats own read" ON public.organization_seats
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "purchases owner read"
  ON public.user_purchases FOR SELECT TO authenticated
  USING (user_id = auth.uid()
    OR (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "subs owner read"
  ON public.user_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid()
    OR (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "gift links owner read"
  ON public.post_gift_links FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR (
      tenant_id = current_tenant_id()
      AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    )
  );
