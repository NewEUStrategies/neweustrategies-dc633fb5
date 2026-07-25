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
SELECT plan(10);

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
-- Symulujemy zmianę aktywnego tenanta przez przepięcie profiles.tenant_id
-- w roli service (SET LOCAL ROLE resetuje ten sam blok BEGIN).
RESET ROLE;
UPDATE public.profiles
   SET tenant_id = 'c2222222-2222-2222-2222-2222222222c2'
 WHERE id = 'c0000000-0000-0000-0000-000000000cc1';

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

SELECT * FROM finish();
ROLLBACK;
