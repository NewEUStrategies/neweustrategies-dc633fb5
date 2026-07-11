-- pgTAP: search_people po refaktorze trigramowym (20260710153000).
--
-- Weryfikowane wlasnosci (zachowanie identyczne z wersja sprzed indeksu):
--   1. Podciag dowolnej kolumny haystacka (tu: current_company) znajduje
--      profil opt-in tego samego tenanta.
--   2. Profil z discoverable=false NIGDY nie jest zwracany - takze przy
--      pustym zapytaniu (przegladanie katalogu).
--   3. Wolajacy nie widzi samego siebie.
--   4. Wielkosc liter zapytania nie ma znaczenia (haystack jest lower()).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(5);

-- -- Seed (jako wlasciciel; triggery auth.users wylaczone jak w tescie RLS) --
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a7111111-1111-1111-1111-111111111111', 'tenant-ps', 'Tenant PS');

INSERT INTO auth.users (id, email) VALUES
  ('a7000000-0000-0000-0000-0000000000aa', 'caller-ps@ps.test'),
  ('a7000000-0000-0000-0000-0000000000bb', 'open-ps@ps.test'),
  ('a7000000-0000-0000-0000-0000000000cc', 'hidden-ps@ps.test');

INSERT INTO public.profiles
  (id, email, display_name, tenant_id, discoverable, current_company, specialization)
VALUES
  ('a7000000-0000-0000-0000-0000000000aa', 'caller-ps@ps.test', 'Caller PS',
   'a7111111-1111-1111-1111-111111111111', true, 'Quantum Analytics', NULL),
  ('a7000000-0000-0000-0000-0000000000bb', 'open-ps@ps.test', 'Open PS',
   'a7111111-1111-1111-1111-111111111111', true, 'Quantum Analytics', 'Energy policy'),
  ('a7000000-0000-0000-0000-0000000000cc', 'hidden-ps@ps.test', 'Hidden PS',
   'a7111111-1111-1111-1111-111111111111', false, 'Quantum Analytics', NULL);

-- -- Wcielenie: zwykly zalogowany klient -------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a7000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

-- 1. Podciag firmy znajduje profil opt-in.
SELECT is(
  (SELECT count(*)::int FROM public.search_people(p_query => 'antum an', p_limit => 50)),
  1,
  'podciag current_company znajduje discoverable profil tego samego tenanta'
);

SELECT is(
  (SELECT sp.display_name FROM public.search_people(p_query => 'antum an', p_limit => 50) sp LIMIT 1),
  'Open PS',
  'zwrocony zostal wlasciwy profil'
);

-- 2. Pusty query = przegladanie katalogu: tylko opt-in, bez self.
SELECT is(
  (SELECT count(*)::int FROM public.search_people(p_query => '', p_limit => 50)),
  1,
  'przegladanie katalogu zwraca wylacznie profile discoverable (bez self i bez hidden)'
);

-- 3. Profil hidden nie wycieka nawet przy dopasowaniu tresci.
SELECT is(
  (SELECT count(*)::int FROM public.search_people(p_query => 'Hidden', p_limit => 50)),
  0,
  'discoverable=false nigdy nie jest zwracany'
);

-- 4. Zapytanie jest case-insensitive.
SELECT is(
  (SELECT count(*)::int FROM public.search_people(p_query => 'ENERGY POL', p_limit => 50)),
  1,
  'wielkosc liter zapytania nie ma znaczenia'
);

SELECT * FROM finish();
ROLLBACK;
