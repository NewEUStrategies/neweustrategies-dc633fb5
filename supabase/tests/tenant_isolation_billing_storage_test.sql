-- pgTAP: regresja izolacji tenantów dla tabel billing/donations oraz storage CV.
--
-- Weryfikuje, że polityki RLS zaostrzone w migracjach z lipca 2026
-- (billing_documents_owner_select, donations own read, cv owner read/delete)
-- rzeczywiście blokują dostęp między tenantami, nawet jeśli ten sam
-- auth.uid() posiada rekordy w wielu tenantach.
--
-- Scenariusz: pojedynczy użytkownik (u1) ma profile w tenantach A oraz B,
-- oraz rekordy billingowe/donacje/pliki CV w obu tenantach. Przy aktywnym
-- kontekście tenanta A widzi TYLKO rekordy A; rekordy B są niewidoczne.
--
-- Uruchamianie: `supabase test db` (razem z pozostałymi testami pgTAP).

BEGIN;
SELECT plan(25);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed ───────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('c1111111-1111-1111-1111-1111111111c1', 'iso-tenant-a', 'Isolation Tenant A'),
  ('c2222222-2222-2222-2222-2222222222c2', 'iso-tenant-b', 'Isolation Tenant B');

-- Wspólny użytkownik podpięty do obu tenantów (profil w A jako "aktywnym").
INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-0000-0000-000000000cc1', 'shared-user@iso.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c0000000-0000-0000-0000-000000000cc1', 'shared-user@iso.test', 'Shared User', 'c1111111-1111-1111-1111-1111111111c1');

-- billing_documents: po jednym dokumencie w każdym tenancie, ten sam user_id.
INSERT INTO public.billing_documents
  (id, tenant_id, user_id, provider_document_id, amount_cents, currency)
VALUES
  ('d0000000-0000-0000-0000-00000000ad01', 'c1111111-1111-1111-1111-1111111111c1',
   'c0000000-0000-0000-0000-000000000cc1', 'inv_a_1', 10000, 'PLN'),
  ('d0000000-0000-0000-0000-00000000bd01', 'c2222222-2222-2222-2222-2222222222c2',
   'c0000000-0000-0000-0000-000000000cc1', 'inv_b_1', 20000, 'EUR');

-- donations: po jednej darowiźnie w każdym tenancie, ten sam user_id.
INSERT INTO public.donations
  (id, tenant_id, user_id, provider_session_id, amount_cents, currency, donor_email)
VALUES
  ('e0000000-0000-0000-0000-00000000ae01', 'c1111111-1111-1111-1111-1111111111c1',
   'c0000000-0000-0000-0000-000000000cc1', 'sess_a_1', 5000, 'PLN', 'shared-user@iso.test'),
  ('e0000000-0000-0000-0000-00000000be01', 'c2222222-2222-2222-2222-2222222222c2',
   'c0000000-0000-0000-0000-000000000cc1', 'sess_b_1', 7500, 'EUR', 'shared-user@iso.test');

-- storage.objects: po jednym pliku CV w każdym tenancie (bucket 'cv').
-- Konwencja ścieżki (spójna z politykami cv): <tenant_id>/users/<auth.uid()>/<file>.
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
   'c1111111-1111-1111-1111-1111111111c1/users/c0000000-0000-0000-0000-000000000cc1/cv-a.pdf',
   'c0000000-0000-0000-0000-000000000cc1'),
  ('cv',
   'c2222222-2222-2222-2222-2222222222c2/users/c0000000-0000-0000-0000-000000000cc1/cv-b.pdf',
   'c0000000-0000-0000-0000-000000000cc1');

-- ── Wcielenie: zalogowany user w kontekście tenanta A ──────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000cc1","role":"authenticated"}', true);

-- Kontrola pozytywna: własny rekord w aktywnym tenancie A jest widoczny.
SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE id = 'd0000000-0000-0000-0000-00000000ad01'),
  1,
  'billing_documents: user widzi własny dokument w aktywnym tenancie A'
);

-- Izolacja: dokument tego samego user_id w tenancie B jest niewidoczny.
SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE id = 'd0000000-0000-0000-0000-00000000bd01'),
  0,
  'billing_documents: dokument tenanta B niewidoczny, mimo tego samego user_id'
);

-- Kontrola pozytywna: donacja własna w tenancie A widoczna.
SELECT is(
  (SELECT count(*)::int FROM public.donations
     WHERE id = 'e0000000-0000-0000-0000-00000000ae01'),
  1,
  'donations: user widzi własną donację w aktywnym tenancie A'
);

-- Izolacja: donacja tego samego user_id w tenancie B jest niewidoczna.
SELECT is(
  (SELECT count(*)::int FROM public.donations
     WHERE id = 'e0000000-0000-0000-0000-00000000be01'),
  0,
  'donations: donacja tenanta B niewidoczna, mimo tego samego user_id'
);

-- Storage CV: user widzi tylko swój plik w aktywnym tenancie A.
SELECT is(
  (SELECT count(*)::int FROM storage.objects
     WHERE bucket_id = 'cv'
       AND name = 'c1111111-1111-1111-1111-1111111111c1/users/c0000000-0000-0000-0000-000000000cc1/cv-a.pdf'),
  1,
  'storage cv: user widzi własny plik CV w aktywnym tenancie A'
);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
     WHERE bucket_id = 'cv'
       AND name = 'c2222222-2222-2222-2222-2222222222c2/users/c0000000-0000-0000-0000-000000000cc1/cv-b.pdf'),
  0,
  'storage cv: plik CV tenanta B niewidoczny (SELECT), mimo tego samego owner_id'
);

-- DELETE cross-tenant musi być odrzucone przez RLS (0 skasowanych wierszy).
WITH del AS (
  DELETE FROM storage.objects
   WHERE bucket_id = 'cv'
     AND name = 'c2222222-2222-2222-2222-2222222222c2/users/c0000000-0000-0000-0000-000000000cc1/cv-b.pdf'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM del), 0,
  'storage cv: DELETE pliku tenanta B odrzucone przez RLS w kontekście tenanta A');

-- ── Przełączenie kontekstu na tenant B (ta sama auth.uid()) ────────────────
-- Symulujemy zmianę aktywnego tenanta przez przepięcie profiles.tenant_id.
-- profiles_pin_tenant_id (20260721052806) blokuje zmianę tenant_id nawet
-- superuserowi - przepuszcza wyłącznie kontekst service_role rozpoznawany po
-- GUC request.jwt.claim.role (SECURITY DEFINER zasłania current_user).
RESET ROLE;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
UPDATE public.profiles
   SET tenant_id = 'c2222222-2222-2222-2222-2222222222c2'
 WHERE id = 'c0000000-0000-0000-0000-000000000cc1';
SELECT set_config('request.jwt.claim.role', '', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000cc1","role":"authenticated"}', true);

-- Symetria: po przełączeniu na tenant B widoczne są tylko rekordy B.
SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE id = 'd0000000-0000-0000-0000-00000000bd01'),
  1,
  'billing_documents: po przełączeniu na tenant B widać rekord B'
);

SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
     WHERE id = 'd0000000-0000-0000-0000-00000000ad01'),
  0,
  'billing_documents: rekord tenanta A staje się niewidoczny w kontekście B'
);

SELECT is(
  (SELECT count(*)::int FROM public.donations
     WHERE id = 'e0000000-0000-0000-0000-00000000ae01'),
  0,
  'donations: rekord tenanta A niewidoczny po przełączeniu do tenanta B'
);

-- ── INSERT cross-tenant (billing_documents / donations) ────────────────────
-- Kontekst nadal: authenticated jako shared user, aktywny tenant = B.
-- Zapisy do billing_documents / donations są service_role-only (brak
-- polityk INSERT/UPDATE dla authenticated), więc KAŻDY INSERT z sesji
-- authenticated musi zostać odrzucony przez RLS - w szczególności próba
-- podszycia się pod obcy tenant.

-- Cross-tenant: user w kontekście B próbuje wstawić dokument tenanta A.
SELECT throws_ok(
  $$INSERT INTO public.billing_documents
      (tenant_id, user_id, provider_document_id, amount_cents, currency)
    VALUES ('c1111111-1111-1111-1111-1111111111c1',
            'c0000000-0000-0000-0000-000000000cc1',
            'inv_cross_a', 999, 'PLN')$$,
  '42501',
  NULL,
  'billing_documents: INSERT cross-tenant (A z kontekstu B) odrzucony przez RLS'
);

-- Own-tenant: nawet zapis do aktywnego tenanta jest zablokowany dla
-- authenticated (brak polityki INSERT → operacja tylko przez service_role).
SELECT throws_ok(
  $$INSERT INTO public.billing_documents
      (tenant_id, user_id, provider_document_id, amount_cents, currency)
    VALUES ('c2222222-2222-2222-2222-2222222222c2',
            'c0000000-0000-0000-0000-000000000cc1',
            'inv_own_b', 111, 'EUR')$$,
  '42501',
  NULL,
  'billing_documents: INSERT z sesji authenticated zablokowany także w aktywnym tenancie (service_role-only)'
);

SELECT throws_ok(
  $$INSERT INTO public.donations
      (tenant_id, user_id, provider_session_id, amount_cents, currency)
    VALUES ('c1111111-1111-1111-1111-1111111111c1',
            'c0000000-0000-0000-0000-000000000cc1',
            'sess_cross_a', 100, 'PLN')$$,
  '42501',
  NULL,
  'donations: INSERT cross-tenant (A z kontekstu B) odrzucony przez RLS'
);

SELECT throws_ok(
  $$INSERT INTO public.donations
      (tenant_id, user_id, provider_session_id, amount_cents, currency)
    VALUES ('c2222222-2222-2222-2222-2222222222c2',
            'c0000000-0000-0000-0000-000000000cc1',
            'sess_own_b', 100, 'EUR')$$,
  '42501',
  NULL,
  'donations: INSERT z sesji authenticated zablokowany także w aktywnym tenancie (service_role-only)'
);

-- ── UPDATE cross-tenant / own-tenant ───────────────────────────────────────
-- Brak polityki UPDATE ⇒ 0 zaktualizowanych wierszy (bez błędu). Rekord
-- obcego tenanta jest dodatkowo niewidoczny dla SELECT-during-UPDATE, więc
-- cross-tenant UPDATE nie może nawet odnaleźć wiersza-celu.

WITH upd AS (
  UPDATE public.billing_documents
     SET amount_cents = amount_cents + 1
   WHERE id = 'd0000000-0000-0000-0000-00000000ad01'  -- rekord tenanta A
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
  'billing_documents: UPDATE cross-tenant (rekord A z kontekstu B) nie modyfikuje wierszy');

WITH upd AS (
  UPDATE public.billing_documents
     SET amount_cents = amount_cents + 1
   WHERE id = 'd0000000-0000-0000-0000-00000000bd01'  -- rekord aktywnego tenanta B
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
  'billing_documents: UPDATE własnego rekordu też zablokowany dla authenticated (service_role-only)');

WITH upd AS (
  UPDATE public.donations
     SET amount_cents = amount_cents + 1
   WHERE id = 'e0000000-0000-0000-0000-00000000ae01'  -- rekord tenanta A
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
  'donations: UPDATE cross-tenant (rekord A z kontekstu B) nie modyfikuje wierszy');

WITH upd AS (
  UPDATE public.donations
     SET amount_cents = amount_cents + 1
   WHERE id = 'e0000000-0000-0000-0000-00000000be01'  -- rekord aktywnego tenanta B
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
  'donations: UPDATE własnego rekordu też zablokowany dla authenticated (service_role-only)');

-- ── Storage CV: INSERT (upload) i UPDATE (podgląd/metadata) ────────────────
-- Kontekst nadal: authenticated jako shared user, aktywny tenant = B.
-- Polityka "cv owner upload" (INSERT) wymaga ścieżki:
--   <current_tenant_id()>/users/<auth.uid()>/<file>
-- Wszelkie odchylenia (obcy tenant, obcy user, zła struktura) → 42501.
-- Brak polityki UPDATE dla bucketu 'cv' ⇒ każdy UPDATE zwraca 0 wierszy,
-- co blokuje m.in. rename/move/metadata-swap między tenantami.

-- Cross-tenant upload: z kontekstu B próbujemy wgrać plik do folderu tenanta A.
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('cv',
            'c1111111-1111-1111-1111-1111111111c1/users/c0000000-0000-0000-0000-000000000cc1/cv-cross-a.pdf',
            'c0000000-0000-0000-0000-000000000cc1')$$,
  '42501',
  NULL,
  'storage cv: INSERT (upload) do folderu tenanta A z kontekstu B odrzucony przez RLS'
);

-- Upload pod obcy user_id w aktywnym tenancie B (podszywanie się).
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('cv',
            'c2222222-2222-2222-2222-2222222222c2/users/00000000-0000-0000-0000-0000000000ff/cv-hijack.pdf',
            'c0000000-0000-0000-0000-000000000cc1')$$,
  '42501',
  NULL,
  'storage cv: INSERT pod obcy user_id w aktywnym tenancie odrzucony przez RLS'
);

-- Kontrola pozytywna: upload własnego pliku w aktywnym tenancie B działa.
INSERT INTO storage.objects (bucket_id, name, owner)
VALUES ('cv',
        'c2222222-2222-2222-2222-2222222222c2/users/c0000000-0000-0000-0000-000000000cc1/cv-b-2.pdf',
        'c0000000-0000-0000-0000-000000000cc1');

SELECT is(
  (SELECT count(*)::int FROM storage.objects
     WHERE bucket_id = 'cv'
       AND name = 'c2222222-2222-2222-2222-2222222222c2/users/c0000000-0000-0000-0000-000000000cc1/cv-b-2.pdf'),
  1,
  'storage cv: własny upload w aktywnym tenancie widoczny przez SELECT tego samego usera'
);

-- Cross-tenant UPDATE (podgląd/rename pliku tenanta A z kontekstu B) → 0 wierszy.
WITH upd AS (
  UPDATE storage.objects
     SET name = 'c2222222-2222-2222-2222-2222222222c2/users/c0000000-0000-0000-0000-000000000cc1/stolen.pdf'
   WHERE bucket_id = 'cv'
     AND name = 'c1111111-1111-1111-1111-1111111111c1/users/c0000000-0000-0000-0000-000000000cc1/cv-a.pdf'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
  'storage cv: UPDATE cross-tenant (rename pliku A z kontekstu B) nie modyfikuje wierszy');

-- UPDATE własnego pliku w aktywnym tenancie: brak polityki UPDATE ⇒ 0 wierszy.
WITH upd AS (
  UPDATE storage.objects
     SET owner = 'c0000000-0000-0000-0000-000000000cc1'
   WHERE bucket_id = 'cv'
     AND name = 'c2222222-2222-2222-2222-2222222222c2/users/c0000000-0000-0000-0000-000000000cc1/cv-b.pdf'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
  'storage cv: UPDATE własnego pliku w aktywnym tenancie zablokowany (brak polityki UPDATE)'
);

-- Sanity: rekordy w bazie pozostały nietknięte przez próby UPDATE powyżej.
-- Sprawdzamy jako service (RESET ROLE), bo RLS użytkownika filtruje wynik.
RESET ROLE;
SELECT is(
  (SELECT amount_cents FROM public.billing_documents
     WHERE id = 'd0000000-0000-0000-0000-00000000ad01'),
  10000,
  'billing_documents: kwota rekordu A niezmieniona po próbach UPDATE z sesji authenticated'
);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
     WHERE bucket_id = 'cv'
       AND name = 'c1111111-1111-1111-1111-1111111111c1/users/c0000000-0000-0000-0000-000000000cc1/cv-a.pdf'),
  1,
  'storage cv: oryginalny plik CV tenanta A niezmieniony po próbach cross-tenant UPDATE'
);

SELECT * FROM finish();
ROLLBACK;

