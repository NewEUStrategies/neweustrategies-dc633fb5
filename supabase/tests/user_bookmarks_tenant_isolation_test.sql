-- pgTAP: izolacja tenanta w user_bookmarks (migracja 20260724110000).
--
-- Klasa: polityki właściciela bramkowały tylko po user_id = auth.uid(), bez
-- tenanta. Po naprawie SELECT/INSERT/DELETE wymagają dodatkowo
-- tenant_id = current_tenant_id() (tenant DOMOWY z profiles), więc wiersz z
-- innego tenanta jest niewidoczny, a zapis do obcego tenanta odrzucony.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(4);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwa tenanty z odrębnymi domenami ─────────────────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b1a11111-1111-1111-1111-111111111111', 'bm-a', 'Bookmark Tenant A', 'a.bm.example'),
  ('b1b22222-2222-2222-2222-222222222222', 'bm-b', 'Bookmark Tenant B', 'b.bm.example');

INSERT INTO auth.users (id, email) VALUES
  ('b0a00000-0000-0000-0000-0000000000a1', 'member-a@bm.test'),
  ('b0b00000-0000-0000-0000-0000000000b1', 'member-b@bm.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('b0a00000-0000-0000-0000-0000000000a1', 'member-a@bm.test', 'Member A',
   'b1a11111-1111-1111-1111-111111111111'),
  ('b0b00000-0000-0000-0000-0000000000b1', 'member-b@bm.test', 'Member B',
   'b1b22222-2222-2222-2222-222222222222');

-- Zakładki: A ma jedną w SWOIM tenancie (A). Dodatkowo wstrzykujemy wiersz z
-- user_id = A, ale tenant_id = B (dane niespójne z tenantem domowym) - po
-- naprawie ma być dla A niewidoczny.
INSERT INTO public.user_bookmarks (user_id, tenant_id, entity_type, entity_id) VALUES
  ('b0a00000-0000-0000-0000-0000000000a1', 'b1a11111-1111-1111-1111-111111111111',
   'post', 'aaaaaaaa-0000-0000-0000-0000000000a1'),
  ('b0a00000-0000-0000-0000-0000000000a1', 'b1b22222-2222-2222-2222-222222222222',
   'post', 'aaaaaaaa-0000-0000-0000-0000000000b2');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b0a00000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

-- ── 1) Widać własną zakładkę we własnym tenancie ────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.user_bookmarks
     WHERE entity_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'),
  1,
  'legit: A widzi swoją zakładkę w tenancie A'
);

-- ── 2) NIE widać własnego wiersza przypisanego do obcego tenanta ────────────
SELECT is(
  (SELECT count(*)::int FROM public.user_bookmarks
     WHERE entity_id = 'aaaaaaaa-0000-0000-0000-0000000000b2'),
  0,
  'izolacja: wiersz user_id=A z tenant_id=B jest niewidoczny (przed naprawą: 1)'
);

-- ── 3) INSERT do własnego tenanta działa (DEFAULT current_tenant_id() = A) ──
SELECT lives_ok(
  $$INSERT INTO public.user_bookmarks (user_id, entity_type, entity_id)
      VALUES ('b0a00000-0000-0000-0000-0000000000a1', 'page',
              'aaaaaaaa-0000-0000-0000-0000000000c3')$$,
  'legit: INSERT bez tenant_id trafia do tenanta domowego A'
);

-- ── 4) INSERT z jawnym obcym tenantem (B) odrzucony przez WITH CHECK ────────
SELECT throws_ok(
  $$INSERT INTO public.user_bookmarks (user_id, tenant_id, entity_type, entity_id)
      VALUES ('b0a00000-0000-0000-0000-0000000000a1',
              'b1b22222-2222-2222-2222-222222222222', 'page',
              'aaaaaaaa-0000-0000-0000-0000000000d4')$$,
  '42501',
  NULL,
  'izolacja: INSERT z tenant_id=B jest odrzucony (RLS WITH CHECK)'
);

SELECT * FROM finish();
ROLLBACK;
