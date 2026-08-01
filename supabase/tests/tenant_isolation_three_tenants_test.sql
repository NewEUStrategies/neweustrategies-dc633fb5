-- pgTAP: regresja izolacji tenantów w konfiguracji 3-tenantowej (A/B/C).
--
-- Uzupełnienie testu `tenant_isolation_billing_storage_test.sql`, który
-- weryfikuje izolację w parze A↔B. Tutaj sprawdzamy, że polityki RLS
-- na billing_documents, donations i storage `cv` blokują wycieki
-- w OBU kierunkach dla wszystkich trzech tenantów: A↔B, A↔C, B↔C.
--
-- Scenariusz: pojedynczy shared user (u1) posiada rekordy w każdym z 3
-- tenantów. Przełączamy aktywny tenant (poprzez public.profiles.tenant_id)
-- kolejno na A, B, C i po każdej zmianie potwierdzamy:
--   * widoczny jest wyłącznie rekord aktywnego tenanta,
--   * dwa rekordy pozostałych tenantów są niewidoczne (SELECT),
--   * DELETE obcego rekordu w storage `cv` nie kasuje żadnego wiersza,
--   * INSERT (upload) do folderu obcego tenanta jest odrzucany (42501).
--
-- Uruchamianie: `supabase test db` (razem z pozostałymi testami pgTAP).

BEGIN;
SELECT plan(32);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: 3 tenanty + wspólny user ─────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1111111-1111-1111-1111-1111111111a1', 'iso3-tenant-a', 'Iso3 Tenant A'),
  ('a2222222-2222-2222-2222-2222222222a2', 'iso3-tenant-b', 'Iso3 Tenant B'),
  ('a3333333-3333-3333-3333-3333333333a3', 'iso3-tenant-c', 'Iso3 Tenant C');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000aa1', 'iso3-shared@iso.test');

-- Aktywny tenant startowo = A (będziemy go zmieniać w trakcie testu).
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a0000000-0000-0000-0000-000000000aa1', 'iso3-shared@iso.test', 'Iso3 Shared',
   'a1111111-1111-1111-1111-1111111111a1');

-- billing_documents: po jednym w każdym tenancie, ten sam user_id.
INSERT INTO public.billing_documents
  (id, tenant_id, user_id, provider_document_id, amount_cents, currency)
VALUES
  ('b0000000-0000-0000-0000-0000000000a1', 'a1111111-1111-1111-1111-1111111111a1',
   'a0000000-0000-0000-0000-000000000aa1', 'iso3_inv_a', 1000, 'PLN'),
  ('b0000000-0000-0000-0000-0000000000b1', 'a2222222-2222-2222-2222-2222222222a2',
   'a0000000-0000-0000-0000-000000000aa1', 'iso3_inv_b', 2000, 'EUR'),
  ('b0000000-0000-0000-0000-0000000000c1', 'a3333333-3333-3333-3333-3333333333a3',
   'a0000000-0000-0000-0000-000000000aa1', 'iso3_inv_c', 3000, 'USD');

-- donations: po jednej w każdym tenancie, ten sam user_id.
INSERT INTO public.donations
  (id, tenant_id, user_id, provider_session_id, amount_cents, currency, donor_email)
VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'a1111111-1111-1111-1111-1111111111a1',
   'a0000000-0000-0000-0000-000000000aa1', 'iso3_sess_a', 100, 'PLN', 'iso3-shared@iso.test'),
  ('d0000000-0000-0000-0000-0000000000b1', 'a2222222-2222-2222-2222-2222222222a2',
   'a0000000-0000-0000-0000-000000000aa1', 'iso3_sess_b', 200, 'EUR', 'iso3-shared@iso.test'),
  ('d0000000-0000-0000-0000-0000000000c1', 'a3333333-3333-3333-3333-3333333333a3',
   'a0000000-0000-0000-0000-000000000aa1', 'iso3_sess_c', 300, 'USD', 'iso3-shared@iso.test');

-- storage.objects: po jednym pliku CV w każdym tenancie.
-- storage-api >= 0055 (prevent-direct-deletes) blokuje KAZDY DELETE na
-- storage.objects statementowym triggerem protect_objects_delete, o ile nie
-- ustawiono GUC storage.allow_delete_query. Odpala sie on zanim RLS odfiltruje
-- wiersze, wiec bez tego GUC nie da sie przetestowac "DELETE zwraca 0 wierszy".
-- set_config(..., true) jest transakcyjne - znika przy ROLLBACK-u.
SELECT set_config('storage.allow_delete_query', 'true', true);

INSERT INTO storage.buckets (id, name, public) VALUES ('cv', 'cv', false)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.objects (bucket_id, name, owner)
VALUES
  ('cv',
   'a1111111-1111-1111-1111-1111111111a1/users/a0000000-0000-0000-0000-000000000aa1/cv-a.pdf',
   'a0000000-0000-0000-0000-000000000aa1'),
  ('cv',
   'a2222222-2222-2222-2222-2222222222a2/users/a0000000-0000-0000-0000-000000000aa1/cv-b.pdf',
   'a0000000-0000-0000-0000-000000000aa1'),
  ('cv',
   'a3333333-3333-3333-3333-3333333333a3/users/a0000000-0000-0000-0000-000000000aa1/cv-c.pdf',
   'a0000000-0000-0000-0000-000000000aa1');

-- ── Helper: przełączenie aktywnego tenanta (service_role) + reautentykacja ─
-- W tej samej sesji BEGIN robimy SET LOCAL ROLE authenticated + jwt.claims
-- po każdej zmianie profiles.tenant_id, żeby current_tenant_id() odczytało
-- świeżą wartość.

-- ══════════════════════════════════════════════════════════════════════════
-- KONTEKST 1: aktywny tenant = A
-- ══════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000aa1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE user_id = 'a0000000-0000-0000-0000-000000000aa1'),
  1,
  '[ctx A] billing_documents: widoczny dokładnie 1 rekord (własny w tenancie A)'
);
SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE id IN ('b0000000-0000-0000-0000-0000000000b1',
                  'b0000000-0000-0000-0000-0000000000c1')),
  0,
  '[ctx A] billing_documents: rekordy tenantów B i C niewidoczne'
);

SELECT is(
  (SELECT count(*)::int FROM public.donations
     WHERE user_id = 'a0000000-0000-0000-0000-000000000aa1'),
  1,
  '[ctx A] donations: widoczna dokładnie 1 darowizna (własna w tenancie A)'
);
SELECT is(
  (SELECT count(*)::int FROM public.donations
     WHERE id IN ('d0000000-0000-0000-0000-0000000000b1',
                  'd0000000-0000-0000-0000-0000000000c1')),
  0,
  '[ctx A] donations: darowizny tenantów B i C niewidoczne'
);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
     WHERE bucket_id = 'cv' AND owner = 'a0000000-0000-0000-0000-000000000aa1'),
  1,
  '[ctx A] storage cv: widoczny wyłącznie własny plik CV z tenanta A'
);
SELECT is(
  (SELECT count(*)::int FROM storage.objects
     WHERE bucket_id = 'cv'
       AND name IN (
         'a2222222-2222-2222-2222-2222222222a2/users/a0000000-0000-0000-0000-000000000aa1/cv-b.pdf',
         'a3333333-3333-3333-3333-3333333333a3/users/a0000000-0000-0000-0000-000000000aa1/cv-c.pdf'
       )),
  0,
  '[ctx A] storage cv: pliki CV z tenantów B i C niewidoczne'
);

-- DELETE cross-tenant (B i C) w kontekście A → 0 wierszy.
WITH del AS (
  DELETE FROM storage.objects
   WHERE bucket_id = 'cv'
     AND name IN (
       'a2222222-2222-2222-2222-2222222222a2/users/a0000000-0000-0000-0000-000000000aa1/cv-b.pdf',
       'a3333333-3333-3333-3333-3333333333a3/users/a0000000-0000-0000-0000-000000000aa1/cv-c.pdf'
     )
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM del), 0,
  '[ctx A] storage cv: DELETE plików tenantów B i C odrzucony przez RLS');

-- INSERT (upload) do folderów obcych tenantów → 42501.
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('cv',
            'a2222222-2222-2222-2222-2222222222a2/users/a0000000-0000-0000-0000-000000000aa1/leak-a-to-b.pdf',
            'a0000000-0000-0000-0000-000000000aa1')$$,
  '42501', NULL,
  '[ctx A] storage cv: upload do folderu tenanta B odrzucony przez RLS'
);
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('cv',
            'a3333333-3333-3333-3333-3333333333a3/users/a0000000-0000-0000-0000-000000000aa1/leak-a-to-c.pdf',
            'a0000000-0000-0000-0000-000000000aa1')$$,
  '42501', NULL,
  '[ctx A] storage cv: upload do folderu tenanta C odrzucony przez RLS'
);

-- ══════════════════════════════════════════════════════════════════════════
-- KONTEKST 2: aktywny tenant = B
-- ══════════════════════════════════════════════════════════════════════════
-- Przepięcie tenant_id wymaga kontekstu service_role: profiles_pin_tenant_id
-- (20260721052806) rozpoznaje go wyłącznie po GUC request.jwt.claim.role
-- (SECURITY DEFINER zasłania current_user, superuser nie ma taryfy ulgowej).
RESET ROLE;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
UPDATE public.profiles
   SET tenant_id = 'a2222222-2222-2222-2222-2222222222a2'
 WHERE id = 'a0000000-0000-0000-0000-000000000aa1';
SELECT set_config('request.jwt.claim.role', '', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000aa1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE user_id = 'a0000000-0000-0000-0000-000000000aa1'),
  1,
  '[ctx B] billing_documents: widoczny dokładnie 1 rekord (własny w tenancie B)'
);
SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE id = 'b0000000-0000-0000-0000-0000000000b1'),
  1,
  '[ctx B] billing_documents: widoczny konkretny rekord tenanta B'
);
SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE id IN ('b0000000-0000-0000-0000-0000000000a1',
                  'b0000000-0000-0000-0000-0000000000c1')),
  0,
  '[ctx B] billing_documents: rekordy tenantów A i C niewidoczne'
);

SELECT is(
  (SELECT count(*)::int FROM public.donations
     WHERE user_id = 'a0000000-0000-0000-0000-000000000aa1'),
  1,
  '[ctx B] donations: widoczna dokładnie 1 darowizna (własna w tenancie B)'
);
SELECT is(
  (SELECT count(*)::int FROM public.donations
     WHERE id IN ('d0000000-0000-0000-0000-0000000000a1',
                  'd0000000-0000-0000-0000-0000000000c1')),
  0,
  '[ctx B] donations: darowizny tenantów A i C niewidoczne'
);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
     WHERE bucket_id = 'cv' AND owner = 'a0000000-0000-0000-0000-000000000aa1'),
  1,
  '[ctx B] storage cv: widoczny wyłącznie własny plik CV z tenanta B'
);
SELECT is(
  (SELECT count(*)::int FROM storage.objects
     WHERE bucket_id = 'cv'
       AND name IN (
         'a1111111-1111-1111-1111-1111111111a1/users/a0000000-0000-0000-0000-000000000aa1/cv-a.pdf',
         'a3333333-3333-3333-3333-3333333333a3/users/a0000000-0000-0000-0000-000000000aa1/cv-c.pdf'
       )),
  0,
  '[ctx B] storage cv: pliki CV z tenantów A i C niewidoczne'
);

WITH del AS (
  DELETE FROM storage.objects
   WHERE bucket_id = 'cv'
     AND name IN (
       'a1111111-1111-1111-1111-1111111111a1/users/a0000000-0000-0000-0000-000000000aa1/cv-a.pdf',
       'a3333333-3333-3333-3333-3333333333a3/users/a0000000-0000-0000-0000-000000000aa1/cv-c.pdf'
     )
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM del), 0,
  '[ctx B] storage cv: DELETE plików tenantów A i C odrzucony przez RLS');

SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('cv',
            'a1111111-1111-1111-1111-1111111111a1/users/a0000000-0000-0000-0000-000000000aa1/leak-b-to-a.pdf',
            'a0000000-0000-0000-0000-000000000aa1')$$,
  '42501', NULL,
  '[ctx B] storage cv: upload do folderu tenanta A odrzucony przez RLS'
);
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('cv',
            'a3333333-3333-3333-3333-3333333333a3/users/a0000000-0000-0000-0000-000000000aa1/leak-b-to-c.pdf',
            'a0000000-0000-0000-0000-000000000aa1')$$,
  '42501', NULL,
  '[ctx B] storage cv: upload do folderu tenanta C odrzucony przez RLS'
);

-- ══════════════════════════════════════════════════════════════════════════
-- KONTEKST 3: aktywny tenant = C
-- ══════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
UPDATE public.profiles
   SET tenant_id = 'a3333333-3333-3333-3333-3333333333a3'
 WHERE id = 'a0000000-0000-0000-0000-000000000aa1';
SELECT set_config('request.jwt.claim.role', '', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000aa1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE user_id = 'a0000000-0000-0000-0000-000000000aa1'),
  1,
  '[ctx C] billing_documents: widoczny dokładnie 1 rekord (własny w tenancie C)'
);
SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE id = 'b0000000-0000-0000-0000-0000000000c1'),
  1,
  '[ctx C] billing_documents: widoczny konkretny rekord tenanta C'
);
SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE id IN ('b0000000-0000-0000-0000-0000000000a1',
                  'b0000000-0000-0000-0000-0000000000b1')),
  0,
  '[ctx C] billing_documents: rekordy tenantów A i B niewidoczne'
);

SELECT is(
  (SELECT count(*)::int FROM public.donations
     WHERE user_id = 'a0000000-0000-0000-0000-000000000aa1'),
  1,
  '[ctx C] donations: widoczna dokładnie 1 darowizna (własna w tenancie C)'
);
SELECT is(
  (SELECT count(*)::int FROM public.donations
     WHERE id IN ('d0000000-0000-0000-0000-0000000000a1',
                  'd0000000-0000-0000-0000-0000000000b1')),
  0,
  '[ctx C] donations: darowizny tenantów A i B niewidoczne'
);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
     WHERE bucket_id = 'cv' AND owner = 'a0000000-0000-0000-0000-000000000aa1'),
  1,
  '[ctx C] storage cv: widoczny wyłącznie własny plik CV z tenanta C'
);
SELECT is(
  (SELECT count(*)::int FROM storage.objects
     WHERE bucket_id = 'cv'
       AND name IN (
         'a1111111-1111-1111-1111-1111111111a1/users/a0000000-0000-0000-0000-000000000aa1/cv-a.pdf',
         'a2222222-2222-2222-2222-2222222222a2/users/a0000000-0000-0000-0000-000000000aa1/cv-b.pdf'
       )),
  0,
  '[ctx C] storage cv: pliki CV z tenantów A i B niewidoczne'
);

WITH del AS (
  DELETE FROM storage.objects
   WHERE bucket_id = 'cv'
     AND name IN (
       'a1111111-1111-1111-1111-1111111111a1/users/a0000000-0000-0000-0000-000000000aa1/cv-a.pdf',
       'a2222222-2222-2222-2222-2222222222a2/users/a0000000-0000-0000-0000-000000000aa1/cv-b.pdf'
     )
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM del), 0,
  '[ctx C] storage cv: DELETE plików tenantów A i B odrzucony przez RLS');

SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('cv',
            'a1111111-1111-1111-1111-1111111111a1/users/a0000000-0000-0000-0000-000000000aa1/leak-c-to-a.pdf',
            'a0000000-0000-0000-0000-000000000aa1')$$,
  '42501', NULL,
  '[ctx C] storage cv: upload do folderu tenanta A odrzucony przez RLS'
);
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('cv',
            'a2222222-2222-2222-2222-2222222222a2/users/a0000000-0000-0000-0000-000000000aa1/leak-c-to-b.pdf',
            'a0000000-0000-0000-0000-000000000aa1')$$,
  '42501', NULL,
  '[ctx C] storage cv: upload do folderu tenanta B odrzucony przez RLS'
);

-- ══════════════════════════════════════════════════════════════════════════
-- SANITY (service_role): wszystkie 3 rekordy w każdej z tabel istnieją,
-- żaden nie został przypadkiem skasowany podczas prób cross-tenant DELETE.
-- ══════════════════════════════════════════════════════════════════════════
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE id IN ('b0000000-0000-0000-0000-0000000000a1',
                  'b0000000-0000-0000-0000-0000000000b1',
                  'b0000000-0000-0000-0000-0000000000c1')),
  3,
  '[sanity] billing_documents: wszystkie 3 rekordy A/B/C istnieją po testach'
);

SELECT is(
  (SELECT count(*)::int FROM public.donations
     WHERE id IN ('d0000000-0000-0000-0000-0000000000a1',
                  'd0000000-0000-0000-0000-0000000000b1',
                  'd0000000-0000-0000-0000-0000000000c1')),
  3,
  '[sanity] donations: wszystkie 3 rekordy A/B/C istnieją po testach'
);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
     WHERE bucket_id = 'cv'
       AND name IN (
         'a1111111-1111-1111-1111-1111111111a1/users/a0000000-0000-0000-0000-000000000aa1/cv-a.pdf',
         'a2222222-2222-2222-2222-2222222222a2/users/a0000000-0000-0000-0000-000000000aa1/cv-b.pdf',
         'a3333333-3333-3333-3333-3333333333a3/users/a0000000-0000-0000-0000-000000000aa1/cv-c.pdf'
       )),
  3,
  '[sanity] storage cv: wszystkie 3 pliki CV A/B/C istnieją po testach'
);

SELECT * FROM finish();
ROLLBACK;
