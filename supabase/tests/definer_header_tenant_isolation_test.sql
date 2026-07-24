-- pgTAP: izolacja tenanta w staffowych funkcjach SECURITY DEFINER wobec
-- podrobionego nagłówka x-tenant-host (migracja 20260724100000).
--
-- Klasa błędu: funkcje skalowały dane po public_tenant_id() (nagłówek, ustawiany
-- po stronie klienta), a rolę sprawdzały przez has_role() (tenant DOMOWY). Admin
-- tenanta A wołając RPC z x-tenant-host: <domena B> czytał/pisał dane B.
--
-- Reprezentant klasy: get_user_monthly_metering_count (najmniejsza powierzchnia
-- schematu). Regresję dla całej klasy pilnuje wspólny mechanizm: po naprawie
-- tenant pochodzi z current_tenant_id() (domowy), więc podrobiony nagłówek nie
-- zmienia zakresu danych.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(3);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwa tenanty z odrębnymi domenami ─────────────────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('c1a11111-1111-1111-1111-111111111111', 'hdr-a', 'Header Tenant A', 'a.hdr.example'),
  ('c1b22222-2222-2222-2222-222222222222', 'hdr-b', 'Header Tenant B', 'b.hdr.example');

-- Admin należy do A; użytkownicy-cele mieszkają w A oraz w B.
INSERT INTO auth.users (id, email) VALUES
  ('c0a00000-0000-0000-0000-0000000000a1', 'admin-a@hdr.test'),
  ('c0a00000-0000-0000-0000-0000000000a2', 'member-a@hdr.test'),
  ('c0b00000-0000-0000-0000-0000000000b1', 'member-b@hdr.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c0a00000-0000-0000-0000-0000000000a1', 'admin-a@hdr.test', 'Admin A',
   'c1a11111-1111-1111-1111-111111111111'),
  ('c0a00000-0000-0000-0000-0000000000a2', 'member-a@hdr.test', 'Member A',
   'c1a11111-1111-1111-1111-111111111111'),
  ('c0b00000-0000-0000-0000-0000000000b1', 'member-b@hdr.test', 'Member B',
   'c1b22222-2222-2222-2222-222222222222');

-- Admin tylko w tenancie A (has_role scope = current_tenant_id = A).
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c0a00000-0000-0000-0000-0000000000a1', 'admin', 'c1a11111-1111-1111-1111-111111111111');

INSERT INTO public.metering_settings (tenant_id, enabled, member_monthly_limit) VALUES
  ('c1a11111-1111-1111-1111-111111111111', true, 5),
  ('c1b22222-2222-2222-2222-222222222222', true, 5);

-- Odsłony bieżącego miesiąca: member A ma 2 w tenancie A; member B ma 3 w B.
INSERT INTO public.metered_views (tenant_id, user_id, entity_type, entity_id) VALUES
  ('c1a11111-1111-1111-1111-111111111111', 'c0a00000-0000-0000-0000-0000000000a2', 'post', gen_random_uuid()),
  ('c1a11111-1111-1111-1111-111111111111', 'c0a00000-0000-0000-0000-0000000000a2', 'post', gen_random_uuid()),
  ('c1b22222-2222-2222-2222-222222222222', 'c0b00000-0000-0000-0000-0000000000b1', 'post', gen_random_uuid()),
  ('c1b22222-2222-2222-2222-222222222222', 'c0b00000-0000-0000-0000-0000000000b1', 'post', gen_random_uuid()),
  ('c1b22222-2222-2222-2222-222222222222', 'c0b00000-0000-0000-0000-0000000000b1', 'post', gen_random_uuid());

SET LOCAL ROLE authenticated;

-- ── 1) FORGE: admin A z podrobionym nagłówkiem B nie widzi liczników B ──────
SELECT set_config('request.jwt.claims',
  '{"sub":"c0a00000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT set_config('request.headers', '{"x-tenant-host":"b.hdr.example"}', true);
SELECT is(
  (SELECT used FROM public.get_user_monthly_metering_count('c0b00000-0000-0000-0000-0000000000b1')),
  0,
  'forge: admin A z x-tenant-host=B NIE widzi licznika membera B (przed naprawą: 3)'
);

-- ── 2) POZYTYWNA: admin A czyta członka SWOJEGO tenanta (nagłówek bez znaczenia)
SELECT is(
  (SELECT used FROM public.get_user_monthly_metering_count('c0a00000-0000-0000-0000-0000000000a2')),
  2,
  'legit: admin A widzi licznik membera A - naprawa nie psuje własnego tenanta'
);

-- ── 3) SELF: member B czyta własny licznik we własnym tenancie ──────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"c0b00000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT is(
  (SELECT used FROM public.get_user_monthly_metering_count('c0b00000-0000-0000-0000-0000000000b1')),
  3,
  'self: member B widzi własny licznik (ścieżka self działa)'
);

SELECT * FROM finish();
ROLLBACK;
