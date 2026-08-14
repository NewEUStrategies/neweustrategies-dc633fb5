-- Powierzchnia styku modułu REKRUTACJA, której nie ma w scripts/pg-harness.
--
-- Ten plik NIE zastępuje pg-harness/harness.sql - dokłada się do niego. Tam są
-- tenanty, role, `auth.uid()`, `is_staff()`, `current_tenant_id()`, `crm_leads`
-- i atrapy magazynu; tutaj wyłącznie to, czego dotykają migracje careers:
--
--   * `contact_messages` - tabela, na której stoi CAŁY moduł (zgłoszenie, pola
--     rekrutacyjne w `custom`, pipeline przez FK, kolejka usunięć CV),
--   * dwie kolumny `storage.buckets`, których atrapa nie ma, a migracja
--     20260814090000 je ustawia (limit rozmiaru i lista MIME = egzekucja
--     serwerowa publicznego uploadu),
--   * `public_tenant_id()` sterowalny z sesji - inaczej nie da się odegrać
--     „anonim wgrywa CV z hosta najemcy B", a to jest cały sens polityki INSERT.
--
-- Kształt `contact_messages` odtworzony z CREATE TABLE (20260625112137) plus
-- kolumny dołożone późniejszymi migracjami; lista jest zgodna z `Row` tej tabeli
-- w `src/integrations/supabase/types.ts`, czyli ze stanem, który realnie widzi
-- kod. Kolumn nieużywanych przez ten moduł nie pomijamy - inaczej test
-- przechodziłby na fikcji, a to jest dokładnie ten błąd, przed którym ostrzega
-- README pg-harnessu.

-- `tenants.is_default` istnieje w prawdziwym schemacie (patrz `Row` tabeli
-- `tenants` w types.ts) i migracje careers wybierają po niej najemcę do
-- backfillu. Atrapa z pg-harnessu jej nie ma, a bez niej backfill wywala się na
-- nieistniejącej kolumnie - czyli test przewracałby się na atrapie, nie na
-- migracji.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
UPDATE public.tenants SET is_default = true
 WHERE id = '11111111-1111-1111-1111-111111111111'
   AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE is_default);

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  first_name text,
  last_name text,
  email text NOT NULL,
  phone text,
  company text,
  subject text,
  message text NOT NULL,
  consent boolean NOT NULL DEFAULT false,
  consents jsonb NOT NULL DEFAULT '[]'::jsonb,
  custom jsonb NOT NULL DEFAULT '{}'::jsonb,
  lang text NOT NULL DEFAULT 'pl',
  recipient text,
  newsletter_opt_in boolean NOT NULL DEFAULT false,
  source text,
  form_id text,
  form_name text,
  form_type text NOT NULL DEFAULT 'contact',
  page_url text,
  referer text,
  ip text,
  user_agent text,
  status text NOT NULL DEFAULT 'new',
  tags text[] NOT NULL DEFAULT '{}',
  assigned_to uuid,
  read_at timestamptz,
  archived_at timestamptz,
  confirmation_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE, DELETE ON public.contact_messages TO authenticated;
GRANT ALL ON public.contact_messages TO service_role;

DROP POLICY IF EXISTS contact_messages_staff_read ON public.contact_messages;
CREATE POLICY contact_messages_staff_read ON public.contact_messages
  FOR SELECT TO authenticated
  USING (public.is_staff() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS contact_messages_admin_delete ON public.contact_messages;
CREATE POLICY contact_messages_admin_delete ON public.contact_messages
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

-- Atrapa `storage.buckets` z pg-harnessu ma tylko (id, name, public).
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS file_size_limit bigint;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS allowed_mime_types text[];

-- Granty schematu `storage`, które w prawdziwym Supabase zakłada rozszerzenie
-- magazynu. Bez nich test polityk bucketu wywala się na "permission denied for
-- schema storage" - czyli na ATRAPIE, zanim w ogóle dojdzie do RLS, a to jest
-- dokładnie ten fałszywy wynik, przed którym ostrzega README pg-harnessu.
-- RLS zostaje jedyną bramką: `storage.objects` ma ją włączoną i FORCE, więc
-- grant sam z siebie niczego nie otwiera.
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
GRANT SELECT ON storage.buckets TO anon, authenticated;
GRANT ALL ON storage.objects TO service_role;
GRANT ALL ON storage.buckets TO service_role;

-- To samo dla schematu `auth`: w Supabase grant zakłada GoTrue, a bez niego
-- polityka wołająca `auth.uid()` z kontekstu roli klienckiej pada na
-- "permission denied for schema auth".
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

/**
 * `current_tenant_id()` musi być SECURITY DEFINER - tak brzmi OSTATNIA definicja
 * w migracjach (20260626180412; wcześniejszy `ALTER ... SECURITY INVOKER`
 * z 20260626162717 został nią zastąpiony). Atrapa w pg-harness/harness.sql ma
 * SECURITY INVOKER, więc czytała `profiles` prawami wołającego i pod RLS
 * zwracała NULL - a polityka `tenant_id = current_tenant_id()` z NULL-em po
 * prawej nie przepuszcza NICZEGO. Test tenant-scope „przechodziłby" wtedy przez
 * odcięcie wszystkiego, także własnego najemcy, czyli mierzyłby atrapę.
 */
CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
$$;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO anon, authenticated, service_role;

/**
 * `public_tenant_id()` sterowany sesją.
 *
 * Atrapa z pg-harnessu zwraca NAJSTARSZEGO tenanta, co dla modułu klubowego
 * wystarcza. Tutaj nie: polityka INSERT-u na bucket `career-cv` wiąże ścieżkę
 * pliku z tenantem PRZEGLĄDANEGO HOSTA, więc bez możliwości przestawienia tej
 * wartości test „anonim z hosta B nie wgra pliku do katalogu A" nie istnieje.
 *
 * Semantyka przypięcia zalogowanego wołającego do tenanta domowego jest
 * odtworzona 1:1 z 20260805114407 - to ona jest mitygacją podrobionego
 * nagłówka `x-tenant-host` i test tenant-scope musi ją widzieć.
 */
CREATE OR REPLACE FUNCTION public.public_tenant_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_asserted uuid := NULLIF(current_setting('request.tenant.id', true), '')::uuid;
  v_home uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_home := public.current_tenant_id();
    IF v_home IS NOT NULL AND v_asserted IS DISTINCT FROM v_home THEN
      RETURN v_home;
    END IF;
  END IF;
  RETURN COALESCE(
    v_asserted,
    (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
    (SELECT id FROM public.tenants ORDER BY created_at ASC LIMIT 1)
  );
END $$;
