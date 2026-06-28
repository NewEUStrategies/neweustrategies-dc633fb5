-- pgTAP: izolacja tenantów na poziomie bazy (RLS) + przypięcie profiles.tenant_id.
--
-- Weryfikuje dwie krytyczne dla bezpieczeństwa własności z migracji
-- 20260628230000_tenant_isolation_and_authz.sql oraz polityk RLS na posts:
--   1. „user tenanta A nie czyta postów B" — RLS na public.posts nie pozwala
--      członkowi tenanta A zobaczyć ŻADNYCH wierszy tenanta B (ani szkiców,
--      ani opublikowanych — polityka publiczna jest zawężona do tenanta
--      publicznego, więc opublikowane posty obcego tenanta też nie wyciekają).
--   2. „UPDATE tenant_id jest ignorowany" — trigger profiles_pin_tenant cicho
--      cofa próbę zmiany własnego tenant_id (przejęcie kontekstu innej firmy),
--      nie wywracając przy tym legalnych zmian innych kolumn profilu.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(6);

-- ── Seed ───────────────────────────────────────────────────────────────────
-- Seedujemy jako właściciel/superuser (RLS pomijane). Wyłączamy WSZYSTKIE
-- triggery użytkownika na auth.users, żeby nadać tenant_id i role jawnie zamiast
-- polegać na auto-provisioningu — na auth.users wisi już kilka triggerów AFTER
-- INSERT (handle_new_user tworzący tenant per e-mail oraz nadawanie super_admin
-- dla konta marketingowego). DISABLE TRIGGER USER jest odporne na dodawanie
-- kolejnych i jest transakcyjne (cofane przez ROLLBACK).
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Dwa NIEpubliczne tenanty (różne od 'nes'), więc polityka „Public reads
-- published posts" (tenant_id = public_tenant_id()) nie obejmuje żadnego z nich.
INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'tenant-a', 'Tenant A'),
  ('b2222222-2222-2222-2222-222222222222', 'tenant-b', 'Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000aa', 'admin-a@a.test'),
  ('b0000000-0000-0000-0000-0000000000bb', 'admin-b@b.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000aa', 'admin-a@a.test', 'User A', 'a1111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-0000000000bb', 'admin-b@b.test', 'User B', 'b2222222-2222-2222-2222-222222222222');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000aa', 'admin', 'a1111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-0000000000bb', 'admin', 'b2222222-2222-2222-2222-222222222222');

-- posts.parent_page_id jest NOT NULL → każdy post musi mieć stronę-rodzica.
INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a1111111-1111-1111-1111-111111111111', 'a-home'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'b2222222-2222-2222-2222-222222222222', 'b-home');

INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'a-post',  'a0000000-0000-0000-0000-0000000000aa', 'published', 'a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Post A'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-draft', 'b0000000-0000-0000-0000-0000000000bb', 'draft',     'b2222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Draft B'),
  ('00000000-0000-0000-0000-0000000000b2', 'b-pub',   'b0000000-0000-0000-0000-0000000000bb', 'published', 'b2222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Pub B');

-- ── Wcielenie: zalogowany user tenanta A ────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

-- „user tenanta A nie czyta postów B"
SELECT is(
  (SELECT count(*)::int FROM public.posts WHERE id = '00000000-0000-0000-0000-0000000000b1'),
  0,
  'user tenanta A nie czyta postów B (szkic tenanta B niewidoczny)'
);

SELECT is(
  (SELECT count(*)::int FROM public.posts WHERE id = '00000000-0000-0000-0000-0000000000b2'),
  0,
  'user tenanta A nie czyta postów B (opublikowany post tenanta B też nie wycieka)'
);

-- Kontrola pozytywna: własny tenant widoczny (inaczej testy izolacji byłyby puste).
SELECT is(
  (SELECT count(*)::int FROM public.posts WHERE id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'user tenanta A czyta własny post'
);

SELECT is(
  (SELECT array_agg(slug ORDER BY slug) FROM public.posts),
  ARRAY['a-post'],
  'RLS pokazuje userowi A wyłącznie posty jego tenanta'
);

-- ── „UPDATE tenant_id jest ignorowany" ──────────────────────────────────────
-- User A aktualizuje WŁASNY profil i przy okazji próbuje przejąć tenant B.
-- RLS „Users update own profile" przepuszcza (auth.uid() = id), ale trigger
-- BEFORE UPDATE cofa tenant_id.
UPDATE public.profiles
   SET tenant_id    = 'b2222222-2222-2222-2222-222222222222',
       display_name = 'Hacked A'
 WHERE id = 'a0000000-0000-0000-0000-0000000000aa';

RESET ROLE;  -- czytamy zapisany wiersz jako właściciel (z pominięciem RLS)

SELECT is(
  (SELECT tenant_id FROM public.profiles WHERE id = 'a0000000-0000-0000-0000-0000000000aa'),
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'UPDATE tenant_id jest ignorowany (tenant_id przypięty do pierwotnej wartości)'
);

-- Trigger nie może wywracać legalnych zmian — inne kolumny zapisują się normalnie.
SELECT is(
  (SELECT display_name FROM public.profiles WHERE id = 'a0000000-0000-0000-0000-0000000000aa'),
  'Hacked A',
  'pozostałe kolumny profilu aktualizują się normalnie (przypięcie dotyczy tylko tenant_id)'
);

SELECT * FROM finish();
ROLLBACK;
