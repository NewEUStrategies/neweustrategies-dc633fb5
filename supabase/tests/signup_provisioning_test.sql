-- pgTAP: handle_new_user - koniec samoobsługowego tworzenia tenanta+admina
-- (re-audyt N4, migracja 20260703120200).
--
-- Kontrakt:
--   * rejestracja bez metadanych -> reader ('user') w tenancie domyślnym,
--     ZERO nowych tenantów (dotychczas: nowy tenant + admin!);
--   * signup_type='staff' w raw_USER_meta_data (w pełni kontrolowane przez
--     klienta w auth.signUp) jest ignorowane -> nadal reader, zero tenantów;
--   * signup_type='staff' w raw_APP_meta_data (zapisywalne wyłącznie przez
--     service role - auth.admin API) -> świadome prowizjonowanie: nowy tenant
--     + rola admin;
--   * jawny 'reader' pozostaje readerem.
--
-- Gałąź bootstrap (pierwsze konto w pustym tenancie domyślnym -> admin) nie
-- jest tu testowana: wymagałaby opróżnienia profiles, a testowa baza może
-- zawierać seed. Zamiast tego seedujemy jeden profil wprost, by bootstrap na
-- pewno NIE był aktywny - testujemy ścieżki osiągalne dla klienta.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(12);

-- ── Warunek wstępny: tenant domyślny ma już profil (bootstrap wyłączony) ────
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, email) VALUES
  ('50000000-0000-0000-0000-000000000000', 'pre-existing@nes.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('50000000-0000-0000-0000-000000000000', 'pre-existing@nes.test', 'Pre Existing',
   COALESCE(
     (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
     (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1)));
ALTER TABLE auth.users ENABLE TRIGGER USER;

CREATE TEMP TABLE tenant_count_before AS
  SELECT count(*)::int AS n FROM public.tenants;

-- ── 1. Zwykła rejestracja (bez metadanych) -> reader w tenancie domyślnym ───
INSERT INTO auth.users (id, email) VALUES
  ('51000000-0000-0000-0000-000000000001', 'plain@user.test');

SELECT is(
  (SELECT tenant_id FROM public.profiles
    WHERE id = '51000000-0000-0000-0000-000000000001'),
  (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
  'rejestracja bez metadanych trafia do tenanta domyślnego'
);
SELECT is(
  (SELECT array_agg(role ORDER BY role) FROM public.user_roles
    WHERE user_id = '51000000-0000-0000-0000-000000000001'),
  ARRAY['user']::app_role[],
  'rejestracja bez metadanych dostaje rolę user (nie admin)'
);
SELECT is(
  (SELECT count(*)::int FROM public.tenants),
  (SELECT n FROM tenant_count_before),
  'rejestracja bez metadanych nie tworzy tenanta'
);

-- ── 2. Spoofing: signup_type=staff w raw_user_meta_data (klient) ────────────
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('52000000-0000-0000-0000-000000000002', 'spoof@attacker.test',
   '{"signup_type":"staff","tenant_slug":"evil-corp","tenant_name":"Evil Corp"}');

SELECT is(
  (SELECT tenant_id FROM public.profiles
    WHERE id = '52000000-0000-0000-0000-000000000002'),
  (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
  'spoofowany staff w user_metadata trafia do tenanta domyślnego'
);
SELECT is(
  (SELECT array_agg(role ORDER BY role) FROM public.user_roles
    WHERE user_id = '52000000-0000-0000-0000-000000000002'),
  ARRAY['user']::app_role[],
  'spoofowany staff w user_metadata dostaje rolę user (bez eskalacji)'
);
SELECT is(
  (SELECT count(*)::int FROM public.tenants WHERE slug LIKE 'evil-corp%'),
  0,
  'spoofowany staff w user_metadata nie tworzy tenanta'
);

-- ── 3. Jawny reader (ścieżka UI - LoginPopup/login/AuthFormBlocks) ──────────
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('53000000-0000-0000-0000-000000000003', 'reader@user.test',
   '{"signup_type":"reader","display_name":"Czytelnik"}');

SELECT is(
  (SELECT array_agg(role ORDER BY role) FROM public.user_roles
    WHERE user_id = '53000000-0000-0000-0000-000000000003'),
  ARRAY['user']::app_role[],
  'jawny reader pozostaje readerem'
);
SELECT is(
  (SELECT display_name FROM public.profiles
    WHERE id = '53000000-0000-0000-0000-000000000003'),
  'Czytelnik',
  'display_name z metadanych klienta zapisuje się normalnie'
);

-- ── 4. Prowizjonowanie serwerowe: staff w raw_APP_meta_data ─────────────────
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('54000000-0000-0000-0000-000000000004', 'owner@acme.test',
   '{"signup_type":"staff","tenant_slug":"acme-media","tenant_name":"Acme Media"}',
   '{"display_name":"Acme Owner"}');

SELECT is(
  (SELECT count(*)::int FROM public.tenants WHERE slug = 'acme-media'),
  1,
  'staff w app_metadata (service role) tworzy tenant'
);
SELECT is(
  (SELECT tenant_id FROM public.profiles
    WHERE id = '54000000-0000-0000-0000-000000000004'),
  (SELECT id FROM public.tenants WHERE slug = 'acme-media'),
  'prowizjonowany staff trafia do nowo utworzonego tenanta'
);
SELECT is(
  (SELECT array_agg(role ORDER BY role) FROM public.user_roles
    WHERE user_id = '54000000-0000-0000-0000-000000000004'),
  ARRAY['admin']::app_role[],
  'prowizjonowany staff dostaje rolę admin w swoim tenancie'
);
SELECT is(
  (SELECT count(*)::int FROM public.tenants),
  (SELECT n FROM tenant_count_before) + 1,
  'łącznie powstał dokładnie jeden nowy tenant (ten prowizjonowany)'
);

SELECT * FROM finish();
ROLLBACK;
