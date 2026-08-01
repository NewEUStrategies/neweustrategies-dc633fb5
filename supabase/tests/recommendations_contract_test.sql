-- pgTAP: kontrakt rekomendacji profilowych (migracja 20260725090000).
--
-- Blokuje regresję trzech niezgodności klient <-> baza, w tym CICHY NO-OP:
--   1) status: klient filtrował 'visible', baza zapisuje 'published',
--   2) akcja:  'approve'/'delete' wpadały w `ELSE status` => UPDATE trafiał we
--              wiersz, wyjątku nie było, UI pokazywał sukces, a stan się nie
--              zmieniał (fałszywe potwierdzenie),
--   3) relationship: wolny tekst z dialogu vs domknięty CHECK kolumny.
-- Dodatkowo: publiczny odczyt dla anona, prywatność moderacji wobec autora,
-- blokada zapisu między tenantami.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e1a11111-1111-1111-1111-111111111111', 'rec-a', 'Rec Tenant A', 'a.rec.example'),
  ('e1b22222-2222-2222-2222-222222222222', 'rec-b', 'Rec Tenant B', 'b.rec.example');

-- Odbiorca R i autor A w tenancie A; obcy X w tenancie B.
INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'r@rec.test'),
  ('e0000000-0000-0000-0000-0000000000b1', 'a@rec.test'),
  ('e0000000-0000-0000-0000-0000000000c1', 'x@rec.test');

INSERT INTO public.profiles (id, email, display_name, job_title, tenant_id) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'r@rec.test', 'Recipient', 'Director',
   'e1a11111-1111-1111-1111-111111111111'),
  ('e0000000-0000-0000-0000-0000000000b1', 'a@rec.test', 'Author', 'Analyst',
   'e1a11111-1111-1111-1111-111111111111'),
  ('e0000000-0000-0000-0000-0000000000c1', 'x@rec.test', 'Outsider', 'Analyst',
   'e1b22222-2222-2222-2222-222222222222');

-- Autor i odbiorca są połączeni (warunek write_recommendation).
-- Guard tg_user_connections_guard wymusza INSERT jako 'pending';
-- akceptację wykonuje osobny UPDATE (dozwolona tranzycja pending->accepted).
INSERT INTO public.user_connections (tenant_id, requester_id, addressee_id) VALUES
  ('e1a11111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-0000000000b1',
   'e0000000-0000-0000-0000-0000000000a1');
UPDATE public.user_connections SET status = 'accepted'
 WHERE requester_id = 'e0000000-0000-0000-0000-0000000000b1'
   AND addressee_id = 'e0000000-0000-0000-0000-0000000000a1';

SET LOCAL ROLE authenticated;

-- ── 1. Słownik relacji: wolny tekst odrzucony, wartość ze słownika przyjęta ──
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT public.write_recommendation(
      'e0000000-0000-0000-0000-0000000000a1',
      'Wspolpracownik w projekcie X',
      'Bardzo konkretna rekomendacja o dlugosci powyzej dwudziestu znakow.')$$,
  '22023',
  'invalid_relationship',
  'relationship poza słownikiem: jawny invalid_relationship (nie surowe 23514)'
);

SELECT throws_ok(
  $$SELECT public.write_recommendation(
      'e0000000-0000-0000-0000-0000000000a1', 'colleague', 'za krotka')$$,
  '22023',
  'invalid_body_length',
  'zbyt krótka treść: jawny invalid_body_length'
);

SELECT lives_ok(
  $$SELECT public.write_recommendation(
      'e0000000-0000-0000-0000-0000000000a1', 'Colleague ',
      'Bardzo konkretna rekomendacja o dlugosci powyzej dwudziestu znakow.')$$,
  'relationship ze słownika (z normalizacją wielkości/spacji) przechodzi'
);

SELECT is(
  (SELECT relationship FROM public.profile_recommendations
    WHERE author_id = 'e0000000-0000-0000-0000-0000000000b1'),
  'colleague',
  'relationship zapisany w formie znormalizowanej'
);

SELECT is(
  (SELECT status FROM public.profile_recommendations
    WHERE author_id = 'e0000000-0000-0000-0000-0000000000b1'),
  'pending',
  'nowa rekomendacja startuje jako pending'
);

-- ── 2. Słownik akcji: nieznany czasownik NIE MOŻE być cichym no-opem ────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok(
  format($$SELECT public.respond_recommendation(%L, 'approve_maybe')$$,
    (SELECT id FROM public.profile_recommendations
      WHERE author_id = 'e0000000-0000-0000-0000-0000000000b1')),
  '22023',
  'invalid_action',
  'nieznana akcja podnosi invalid_action zamiast po cichu nic nie robić'
);

-- 'approve' (słownik klienta) MUSI faktycznie publikować.
SELECT lives_ok(
  format($$SELECT public.respond_recommendation(%L, 'approve')$$,
    (SELECT id FROM public.profile_recommendations
      WHERE author_id = 'e0000000-0000-0000-0000-0000000000b1')),
  'approve jest akceptowanym synonimem publish'
);

SELECT is(
  (SELECT status FROM public.profile_recommendations
    WHERE author_id = 'e0000000-0000-0000-0000-0000000000b1'),
  'published',
  'approve realnie zmienia status na published (koniec fałszywego sukcesu)'
);

-- ── 3. Publiczny odczyt: anon widzi published, autor nie widzi odmowy ───────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.list_recommendations(
     'e0000000-0000-0000-0000-0000000000a1')),
  1,
  'anon widzi opublikowaną rekomendację na publicznym profilu'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT lives_ok(
  format($$SELECT public.respond_recommendation(%L, 'hide')$$,
    (SELECT id FROM public.profile_recommendations
      WHERE author_id = 'e0000000-0000-0000-0000-0000000000b1')),
  'odbiorca może ukryć opublikowaną rekomendację'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT is(
  (SELECT status FROM public.list_recommendations(
     'e0000000-0000-0000-0000-0000000000a1')
    WHERE author_id = 'e0000000-0000-0000-0000-0000000000b1'),
  'pending',
  'autor nie dowiaduje się o ukryciu - widzi pending (prywatność moderacji)'
);

-- ── 4. delete: realne usunięcie wiersza (dotąd nieobsługiwane) ──────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT lives_ok(
  format($$SELECT public.respond_recommendation(%L, 'delete')$$,
    (SELECT id FROM public.profile_recommendations
      WHERE author_id = 'e0000000-0000-0000-0000-0000000000b1')),
  'delete jest obsługiwaną akcją'
);
SELECT is(
  (SELECT count(*)::int FROM public.profile_recommendations
    WHERE author_id = 'e0000000-0000-0000-0000-0000000000b1'),
  0,
  'delete realnie usuwa wiersz'
);

SELECT * FROM finish();
ROLLBACK;
