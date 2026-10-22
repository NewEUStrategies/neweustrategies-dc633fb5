-- pgTAP: `admin_revenue_access_inventory` to raport inwentarza dla personelu
-- (admin/editor), NIE bramka czytelnika (I9b, część B, Z-S3-06; decyzja
-- właściciela 2026-10-20, zgoda delegowana).
--
-- Snapshot autoryzacji (`generate:authz-snapshot`) widzi w ciele funkcji
-- odczyt flagi `premium_content` i wpisuje ją jako bramkę tej flagi bez ról
-- omijających - skaner nie rozwija aliasu `is_admin_or_editor()`. Ten plik
-- przypina, że odczyt flagi NIE jest ścieżką dostępu czytelnika: kto nie ma
-- roli admin/editor w SWOIM najemcy, dostaje odmowę, zanim funkcja dotknie
-- danych.
--
-- CO PRZYPINA:
--   * anon - brak EXECUTE (odmowa 42501 przy wywołaniu);
--   * authenticated bez sesji (`auth.uid()` NULL) - 42501;
--   * czytelnik bez roli, konto z rolą `user`, autor - 42501;
--   * editor najemcy B z profilem w najemcy A (rola w INNYM najemcy) - 42501;
--   * editor i admin najemcy A - raport (komplet kluczy inwentarza).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9b_access_inventory_authz
BEGIN;
SELECT plan(8);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('19b60000-0000-4000-8000-0000000000a1', 'i9b-inv-a', 'I9b Inwentarz A'),
  ('19b60000-0000-4000-8000-0000000000b1', 'i9b-inv-b', 'I9b Inwentarz B');

INSERT INTO auth.users (id, email) VALUES
  ('19b60000-0000-4000-8000-00000000a0a1', 'admin@i9b-inv.test'),
  ('19b60000-0000-4000-8000-00000000a0e1', 'editor@i9b-inv.test'),
  ('19b60000-0000-4000-8000-00000000a0c1', 'author@i9b-inv.test'),
  ('19b60000-0000-4000-8000-00000000a0d1', 'user-role@i9b-inv.test'),
  ('19b60000-0000-4000-8000-00000000a001', 'reader@i9b-inv.test'),
  ('19b60000-0000-4000-8000-00000000a0f1', 'editor-b@i9b-inv.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19b60000-0000-4000-8000-00000000a0a1', 'admin@i9b-inv.test', 'Admin', '19b60000-0000-4000-8000-0000000000a1'),
  ('19b60000-0000-4000-8000-00000000a0e1', 'editor@i9b-inv.test', 'Editor', '19b60000-0000-4000-8000-0000000000a1'),
  ('19b60000-0000-4000-8000-00000000a0c1', 'author@i9b-inv.test', 'Author', '19b60000-0000-4000-8000-0000000000a1'),
  ('19b60000-0000-4000-8000-00000000a0d1', 'user-role@i9b-inv.test', 'User', '19b60000-0000-4000-8000-0000000000a1'),
  ('19b60000-0000-4000-8000-00000000a001', 'reader@i9b-inv.test', 'Reader', '19b60000-0000-4000-8000-0000000000a1'),
  -- Profil w A, rola editor tylko w B: `has_role` liczy rolę w najemcy sesji.
  ('19b60000-0000-4000-8000-00000000a0f1', 'editor-b@i9b-inv.test', 'Editor B', '19b60000-0000-4000-8000-0000000000a1');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19b60000-0000-4000-8000-00000000a0a1', 'admin', '19b60000-0000-4000-8000-0000000000a1'),
  ('19b60000-0000-4000-8000-00000000a0e1', 'editor', '19b60000-0000-4000-8000-0000000000a1'),
  ('19b60000-0000-4000-8000-00000000a0c1', 'author', '19b60000-0000-4000-8000-0000000000a1'),
  ('19b60000-0000-4000-8000-00000000a0d1', 'user', '19b60000-0000-4000-8000-0000000000a1'),
  ('19b60000-0000-4000-8000-00000000a0f1', 'editor', '19b60000-0000-4000-8000-0000000000b1');

CREATE TEMP TABLE inv_staff (who text, j jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON inv_staff TO authenticated;

CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;

-- ── A. Odmowy ───────────────────────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT public.admin_revenue_access_inventory() $$,
  '42501', NULL, 'anon: brak EXECUTE - odmowa');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT throws_ok($$ SELECT public.admin_revenue_access_inventory() $$,
  '42501', NULL, 'authenticated bez sesji (auth.uid() NULL) - odmowa');

SELECT pg_temp.as_user('19b60000-0000-4000-8000-00000000a001');
SELECT throws_ok($$ SELECT public.admin_revenue_access_inventory() $$,
  '42501', NULL, 'czytelnik bez roli - odmowa (to nie bramka czytelnika)');

SELECT pg_temp.as_user('19b60000-0000-4000-8000-00000000a0d1');
SELECT throws_ok($$ SELECT public.admin_revenue_access_inventory() $$,
  '42501', NULL, 'konto z rolą user - odmowa');

SELECT pg_temp.as_user('19b60000-0000-4000-8000-00000000a0c1');
SELECT throws_ok($$ SELECT public.admin_revenue_access_inventory() $$,
  '42501', NULL, 'autor - odmowa');

SELECT pg_temp.as_user('19b60000-0000-4000-8000-00000000a0f1');
SELECT throws_ok($$ SELECT public.admin_revenue_access_inventory() $$,
  '42501', NULL, 'editor innego najemcy (profil w A, rola w B) - odmowa');

-- ── B. Personel najemcy dostaje raport ─────────────────────────────────────
SELECT pg_temp.as_user('19b60000-0000-4000-8000-00000000a0e1');
INSERT INTO inv_staff SELECT 'editor', public.admin_revenue_access_inventory();
SELECT pg_temp.as_user('19b60000-0000-4000-8000-00000000a0a1');
INSERT INTO inv_staff SELECT 'admin', public.admin_revenue_access_inventory();
RESET ROLE;

SELECT is(
  (SELECT array_agg(who ORDER BY who) FROM inv_staff WHERE jsonb_typeof(j) = 'object'),
  ARRAY['admin', 'editor'], 'editor i admin najemcy czytają raport');
SELECT ok(
  (SELECT bool_and(j ?& ARRAY['total', 'rows', 'by_mode', 'tiers', 'dead_ends']) FROM inv_staff),
  'raport ma klucze inwentarza (suma, reguły, tryby, warstwy, ślepe zaułki)');

SELECT * FROM finish();
ROLLBACK;
