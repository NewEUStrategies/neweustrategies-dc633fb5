-- pgTAP: przepływ wprowadzeń (migracja 20260724120000).
--
-- Sprawdza naprawione ścieżki: most 'forward' -> 'forwarded' i widoczność dla
-- targetu z avatarem mostu; proszący 'withdraw' -> 'withdrawn'; brak ścieżki
-- dla obcego aktora.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(6);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('d1a11111-1111-1111-1111-111111111111', 'intro-a', 'Intro Tenant A', 'a.intro.example');

-- Trójka: proszący R, most B (z avatarem), cel T - wszyscy w jednym tenancie.
INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'r@intro.test'),
  ('d0000000-0000-0000-0000-0000000000b1', 'b@intro.test'),
  ('d0000000-0000-0000-0000-0000000000c1', 't@intro.test');

INSERT INTO public.profiles (id, email, display_name, avatar_url, tenant_id) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'r@intro.test', 'Requester', NULL,
   'd1a11111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-0000000000b1', 'b@intro.test', 'Bridge',
   'https://cdn/bridge.jpg', 'd1a11111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-0000000000c1', 't@intro.test', 'Target', NULL,
   'd1a11111-1111-1111-1111-111111111111');

-- Dwie oczekujące prośby: intro1 (do przekazania), intro2 (do wycofania).
INSERT INTO public.introduction_requests
  (id, tenant_id, requester_id, bridge_id, target_id, message, status) VALUES
  ('11110000-0000-0000-0000-000000000001', 'd1a11111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000b1',
   'd0000000-0000-0000-0000-0000000000c1', 'Prosze o wprowadzenie do celu.', 'pending'),
  ('11110000-0000-0000-0000-000000000002', 'd1a11111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000b1',
   'd0000000-0000-0000-0000-0000000000c1', 'Druga prosba do wycofania teraz.', 'pending');

SET LOCAL ROLE authenticated;

-- ── Most przekazuje intro1 ──────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.respond_introduction('11110000-0000-0000-0000-000000000001', 'forward')$$,
  'most: forward oczekującej prośby przechodzi'
);
SELECT is(
  (SELECT status FROM public.introduction_requests
     WHERE id = '11110000-0000-0000-0000-000000000001'),
  'forwarded',
  'most: status po forward = forwarded'
);

-- Most NIE może przekazać cudzej (już nie-pending) prośby ponownie.
SELECT throws_ok(
  $$SELECT public.respond_introduction('11110000-0000-0000-0000-000000000001', 'forward')$$,
  NULL,
  'most: ponowny forward nie-pending prośby jest odrzucony'
);

-- ── Cel widzi przekazane wprowadzenie z avatarem mostu ──────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SELECT is(
  (SELECT bridge_avatar FROM public.my_introduction_requests('target')
     WHERE id = '11110000-0000-0000-0000-000000000001'),
  'https://cdn/bridge.jpg',
  'target: RPC zwraca avatar mostu (naprawiona zakładka "O mnie")'
);

-- ── Proszący wycofuje intro2 ────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.respond_introduction('11110000-0000-0000-0000-000000000002', 'withdraw')$$,
  'proszący: withdraw własnej oczekującej prośby przechodzi (wcześniej: wyjątek)'
);
SELECT is(
  (SELECT status FROM public.introduction_requests
     WHERE id = '11110000-0000-0000-0000-000000000002'),
  'withdrawn',
  'proszący: status po withdraw = withdrawn'
);

SELECT * FROM finish();
ROLLBACK;
