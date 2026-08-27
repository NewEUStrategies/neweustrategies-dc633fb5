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

-- `user_roles.tenant_id` istnieje w prawdziwym schemacie: dostawia ją migracja
-- platformy 20260531181120 (`ADD COLUMN`, backfill, `SET NOT NULL`), a `Insert`
-- tej tabeli w `types.ts` ma `tenant_id` jako pole WYMAGANE. Atrapa ze wspólnego
-- harnessu stawia `user_roles` tylko z `(user_id, role)` - i na tym wywalała się
-- migracja 20260824074231, która przedefiniowuje `is_super_admin()` na wersję
-- ZAKRESOWANĄ TENANTEM i tę kolumnę czyta:
--
--   ERROR:  column "tenant_id" does not exist
--   LINE 13:        AND tenant_id = public.current_tenant_id()
--
-- To 42703, nie 42P01, i - co ważniejsze - tabela JEST w zadeklarowanym zasięgu
-- tego harnessu, bo stawia ją `pg-harness/harness.sql`. Jej niepełny kształt to
-- więc defekt ATRAPY, a nie powód do pomijania migracji: kryterium SKIP
-- z `pg-harness` celowo nie łapie ani tej klasy błędu, ani obiektów w zasięgu.
--
-- NOT NULL wchodzi od razu, bo w tym momencie tabela jest pusta - produkcja
-- doszła do tego samego stanu w trzech krokach tylko dlatego, że miała dane.
-- Konsekwencja jest zamierzona: fixture w `runtime_test.sql` MUSI nadać rolom
-- tenanta. Rola bez tenanta na produkcji istnieć nie może, więc fixture, który
-- ją zakłada, mierzyłby stan nieosiągalny - a od 20260824074231 `is_super_admin()`
-- zwracałoby na nim po cichu FALSE.
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL
  REFERENCES public.tenants(id) ON DELETE CASCADE;

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

-- ---------------------------------------------------------------------------
-- ATRAPY-CELE POLITYK. Powierzchnia, o której ten harness NIC NIE TWIERDZI.
-- ---------------------------------------------------------------------------
--
-- DLACZEGO TO NIE JEST SPRAWA DLA MECHANIKI `SKIP` Z PG-HARNESSU.
--
-- Migracja 20260824074231 (panel Lovable, nazwa z UUID-em) dotyka czterech
-- domen naraz: webhooków CRM, integracji, REKRUTACJI i workflow. Wygląda jak
-- zlepek z commitu dfc23e4, ale nim NIE JEST: nie ma w niej kilku niezależnych
-- migracji pod jedną wersją, jest jedna spójna ZMIANA HARTUJĄCA - przestawienie
-- KAŻDEJ polityki `*_staff_*` z `is_staff()` (które przepuszcza rolę `author`)
-- na nowe `is_admin_or_editor()` (tylko `admin` i `editor`). Cztery domeny to
-- zasięg tej jednej zmiany, nie cztery zlepione migracje.
--
-- Dowód, że sekcji rekrutacyjnej nie pokrywa nic innego (`grep` po
-- `supabase/migrations`):
--   * `public.is_admin_or_editor()` definiuje w całym repo TYLKO ten plik;
--   * polityki `career_applications_staff_read` / `_staff_update`
--     i `career_application_events_staff_read` mają wcześniejsze definicje
--     (20260814110000, 20260814123014), ale OBIE stoją na `is_staff()` - czyli
--     na stanie, którego produkcja już nie ma;
--   * `career_cv_staff_read` / `_staff_delete` - to samo: sześć wcześniejszych
--     plików, wszystkie przed zaostrzeniem.
-- Sekcja rekrutacyjna tego pliku jest więc NAJNOWSZYM stanem modułu, a nie
-- podzbiorem czegokolwiek. W dfc23e4 wolno było pominąć plik dokładnie dlatego,
-- że klubowa sekcja zlepka była NADZBIOREM osobnego pliku i pominięcie nie
-- odbierało bramce ani jednej linii SQL-a modułu. Tutaj jest odwrotnie.
--
-- Gdzie by to bolało: `ON_ERROR_STOP=1` przerywa plik na PIERWSZYM błędzie,
-- a pierwszy brakujący obiekt (`public.crm_webhook_endpoints`) leży w wierszu
-- 38, natomiast sekcja rekrutacyjna w wierszach 51-99 - czyli ZA błędem. SKIP
-- zostawiłby harness z politykami opartymi o `is_staff()` i cicho przestałby
-- pilnować dokładnie tego zaostrzenia, po które ta migracja powstała: że
-- `author` traci dostęp do zgłoszeń rekrutacyjnych i do CV.
--
-- CZYM SĄ TE TABELE, A CZYM NIE SĄ. Są wyłącznie CELAMI POLITYK: istnieją, żeby
-- `DROP POLICY IF EXISTS` / `CREATE POLICY` z tej migracji miały na czym stanąć
-- i żeby plik dobiegł do sekcji rekrutacyjnej. Mają dokładnie te kolumny,
-- których dotyka `USING`/`WITH CHECK` tej migracji - `workflow_templates` nawet
-- `tenant_id` nie ma, bo jej polityka pyta tylko o rolę (i produkcyjna tabela
-- też go nie ma, patrz 20260711204000). NIE odtwarzają produkcyjnego kształtu,
-- więc NIE WOLNO na nich niczego twierdzić - `run.sh` pilnuje tego wprost
-- i przewraca bramkę, gdy `runtime_test.sql` odwoła się do którejkolwiek.
--
-- Znaczniki `ATRAPA-CEL-POLITYKI` niżej są JEDYNYM źródłem tej listy: `run.sh`
-- czyta ją z tego pliku, więc lista w logu nie może rozjechać się z kodem.
-- RLS włączamy, a grantów nie dajemy żadnych, żeby żaden przyszły test nie
-- wziął tych atrap za powierzchnię otwartą dla roli klienckiej.

-- ATRAPA-CEL-POLITYKI: crm_webhook_endpoints
CREATE TABLE IF NOT EXISTS public.crm_webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE
);

-- ATRAPA-CEL-POLITYKI: integration_endpoints
CREATE TABLE IF NOT EXISTS public.integration_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE
);

-- ATRAPA-CEL-POLITYKI: integration_deliveries
CREATE TABLE IF NOT EXISTS public.integration_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE
);

-- ATRAPA-CEL-POLITYKI: workflow_definitions
CREATE TABLE IF NOT EXISTS public.workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE
);

-- ATRAPA-CEL-POLITYKI: workflow_runs
CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE
);

-- ATRAPA-CEL-POLITYKI: workflow_templates
CREATE TABLE IF NOT EXISTS public.workflow_templates (
  key text PRIMARY KEY
);

ALTER TABLE public.crm_webhook_endpoints  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_endpoints  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_definitions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_templates     ENABLE ROW LEVEL SECURITY;
