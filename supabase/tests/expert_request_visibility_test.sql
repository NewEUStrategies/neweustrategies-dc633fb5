-- pgTAP: sterowanie widocznością "Zapytania do eksperta" (migracja 20260724130000).
--
-- Pokrywa admiński przełącznik per-user admin_set_expert_requests_enabled:
-- autoryzacja (tylko admin), izolacja tenanta, faktyczna zmiana flagi. Bramki
-- serwerowe w send_expert_inmail (recipient/global) walidowane lokalnie -
-- wymagają pełnego seedu warstw/tierów, więc tu skupiamy się na RPC admina.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(4);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e1a11111-1111-1111-1111-111111111111', 'er-a', 'ER Tenant A', 'a.er.example'),
  ('e1b22222-2222-2222-2222-222222222222', 'er-b', 'ER Tenant B', 'b.er.example');

INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'admin-a@er.test'),
  ('e0000000-0000-0000-0000-0000000000a2', 'expert-a@er.test'),
  ('e0000000-0000-0000-0000-0000000000b1', 'expert-b@er.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'admin-a@er.test', 'Admin A',
   'e1a11111-1111-1111-1111-111111111111'),
  ('e0000000-0000-0000-0000-0000000000a2', 'expert-a@er.test', 'Expert A',
   'e1a11111-1111-1111-1111-111111111111'),
  ('e0000000-0000-0000-0000-0000000000b1', 'expert-b@er.test', 'Expert B',
   'e1b22222-2222-2222-2222-222222222222');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'admin', 'e1a11111-1111-1111-1111-111111111111');

SET LOCAL ROLE authenticated;

-- ── 1) Admin A wyłącza przycisk swojemu ekspertowi A ────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.admin_set_expert_requests_enabled('e0000000-0000-0000-0000-0000000000a2', false)$$,
  'admin: może wyłączyć zapytania ekspertowi w swoim tenancie'
);
SELECT is(
  (SELECT expert_requests_enabled FROM public.profiles
     WHERE id = 'e0000000-0000-0000-0000-0000000000a2'),
  false,
  'admin: flaga faktycznie ustawiona na false'
);

-- ── 2) Admin A NIE może dotknąć eksperta z tenanta B ────────────────────────
SELECT throws_ok(
  $$SELECT public.admin_set_expert_requests_enabled('e0000000-0000-0000-0000-0000000000b1', false)$$,
  NULL,
  'izolacja: admin A nie ustawia flagi ekspertowi tenanta B'
);

-- ── 3) Nie-admin (zwykły ekspert A) nie ma dostępu do RPC ────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.admin_set_expert_requests_enabled('e0000000-0000-0000-0000-0000000000a2', true)$$,
  NULL,
  'authz: użytkownik bez roli admin dostaje odmowę'
);

SELECT * FROM finish();
ROLLBACK;
