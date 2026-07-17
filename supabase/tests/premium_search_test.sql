-- pgTAP: wyszukiwarka premium (migracja 20260717120000).
--
-- Pokrywa własności, których nie sprawdza faceted_search_test:
--   1. Tryb "phrase": tylko sąsiadujące słowa (kolejność ma znaczenie).
--   2. Tryb "any": dowolne słowo zapytania wystarcza.
--   3. Wykluczenie -term odcina trafienia zawierające term.
--   4. "Fraza w cudzysłowie" wewnątrz trybu all wymusza sąsiedztwo.
--   5. _in='title': dopasowanie tylko w tytułach (treść nie wystarcza).
--   6. Wymiar organization: filtr _terms + faseta dim='organization'
--      + autosuggest zwraca term organizacji.
--   7. search_people_orgs: osoba redakcyjna z dorobkiem (post_count),
--      organizacja z licznikiem publikacji, prefiks nazwiska, tryb
--      przeglądania (pusta fraza) i niewidoczność osób bez dorobku.
--
-- Wszystko z perspektywy anona; tenant rozstrzygany serwerowo (publiczny).

BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;

SELECT public.public_tenant_id() AS nes \gset

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('22222222-0000-0000-0000-0000000000fe', :'nes', 'ps-home');

-- Autorka redakcyjna z dorobkiem (search_people_orgs + rola editorial).
INSERT INTO auth.users (id, email) VALUES
  ('aa000000-0000-0000-0000-0000000000b1', 'nowak@ps.test'),
  ('aa000000-0000-0000-0000-0000000000b2', 'cichy@ps.test');
INSERT INTO public.profiles (id, email, display_name, slug, tenant_id, job_title) VALUES
  ('aa000000-0000-0000-0000-0000000000b1', 'nowak@ps.test', 'Anna Nowak',
   'anna-nowak', :'nes', 'Analityczka'),
  ('aa000000-0000-0000-0000-0000000000b2', 'cichy@ps.test', 'Piotr Cichy',
   'piotr-cichy', :'nes', 'Redaktor');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('aa000000-0000-0000-0000-0000000000b1', 'author', :'nes'),
  ('aa000000-0000-0000-0000-0000000000b2', 'author', :'nes');

-- Słownik: organizacja "Sojusz Testowy" (nowy wymiar kind='organization').
INSERT INTO public.categories (id, tenant_id, slug, name_pl, name_en, kind) VALUES
  ('cc000000-0000-0000-0000-0000000000d1', :'nes', 'sojusz-testowy',
   'Sojusz Testowy', 'Test Alliance', 'organization');

-- Posty:
--  Q1: "architektura bezpieczenstwa" w tytule (sąsiadująco) + org, autorka Anna.
--  Q2: oba słowa w treści, ale NIE sąsiadująco i nie w tytule.
--  Q3: tylko "polityka handlowa" (dla trybu any i wykluczeń).
INSERT INTO public.posts
  (id, slug, status, tenant_id, parent_page_id, title_pl, title_en, content_pl,
   post_format, published_at) VALUES
  ('bb000000-0000-0000-0000-000000000001', 'ps-q1', 'published', :'nes',
   '22222222-0000-0000-0000-0000000000fe',
   'Architektura bezpieczenstwa Europy', 'Security architecture of Europe',
   'Analiza filarow wspolpracy sojuszniczej.', 'standard', now() - interval '1 day'),
  ('bb000000-0000-0000-0000-000000000002', 'ps-q2', 'published', :'nes',
   '22222222-0000-0000-0000-0000000000fe',
   'Filary wspolpracy regionalnej', 'Pillars of regional cooperation',
   'Architektura instytucji oraz kwestie bezpieczenstwa regionu.', 'standard',
   now() - interval '3 days'),
  ('bb000000-0000-0000-0000-000000000003', 'ps-q3', 'published', :'nes',
   '22222222-0000-0000-0000-0000000000fe',
   'Polityka handlowa Unii', 'Trade policy of the Union',
   'Tekst o polityce handlowej.', 'standard', now() - interval '5 days');

UPDATE public.posts SET author_id = 'aa000000-0000-0000-0000-0000000000b1'
 WHERE id IN ('bb000000-0000-0000-0000-000000000001',
              'bb000000-0000-0000-0000-000000000002');

-- Przypięcie organizacji: Q1 -> Sojusz Testowy.
INSERT INTO public.post_categories (post_id, category_id) VALUES
  ('bb000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-0000000000d1');

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);

-- 1. Tryb all (domyślny): oba słowa gdziekolwiek -> Q1 i Q2.
SELECT is(
  (SELECT count(*)::int FROM public.search_posts('architektura bezpieczenstwa')),
  2,
  'tryb all: oba słowa w dowolnym miejscu (Q1 + Q2)'
);

-- 2. Tryb phrase: tylko sąsiadujące słowa -> wyłącznie Q1.
SELECT is(
  (SELECT array_agg(slug) FROM public.search_posts(
     'architektura bezpieczenstwa', 80, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, 'relevance', 'phrase')),
  ARRAY['ps-q1'],
  'tryb phrase: wymusza sąsiedztwo słów (tylko Q1)'
);

-- 3. "Fraza w cudzysłowie" w trybie all działa jak sąsiedztwo.
SELECT is(
  (SELECT array_agg(slug) FROM public.search_posts('"architektura bezpieczenstwa"')),
  ARRAY['ps-q1'],
  'cudzysłów w trybie all: fraza wymusza sąsiedztwo (tylko Q1)'
);

-- 4. Tryb any: dowolne słowo -> "bezpieczenstwa handlowa" łapie Q1, Q2 i Q3.
SELECT is(
  (SELECT count(*)::int FROM public.search_posts(
     'bezpieczenstwa handlowa', 80, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, 'relevance', 'any')),
  3,
  'tryb any: dowolne słowo zapytania wystarcza (Q1 + Q2 + Q3)'
);

-- 5. Wykluczenie: "architektura -filary" odcina Q2 (filary w tytule/treści).
SELECT is(
  (SELECT array_agg(slug) FROM public.search_posts('architektura -filary')),
  ARRAY['ps-q1'],
  'wykluczenie -term odcina trafienia z termem (zostaje Q1)'
);

-- 6. Samo wykluczenie -> NULL tsquery -> tryb przeglądania (pełne archiwum).
SELECT is(
  (SELECT count(*)::int FROM public.search_posts('-architektura')),
  3,
  'zapytanie z samych wykluczeń nie zawęża (tryb przeglądania)'
);

-- 7. _in='title': "filary" jest w tytule Q2, ale tylko w treści Q1.
SELECT is(
  (SELECT array_agg(slug) FROM public.search_posts(
     'filary', 80, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, 'relevance', 'all', 'title')),
  ARRAY['ps-q2'],
  '_in=title: dopasowanie wyłącznie w tytułach'
);

-- 8. Filtr termu organizacji zawęża do Q1.
SELECT is(
  (SELECT array_agg(slug) FROM public.search_posts(
     NULL, 80, NULL, NULL, NULL, NULL,
     ARRAY['cc000000-0000-0000-0000-0000000000d1']::uuid[])),
  ARRAY['ps-q1'],
  'filtr termu organizacji zawęża zbiór'
);

-- 9. Faseta dim='organization' liczy publikacje organizacji.
SELECT is(
  (SELECT cnt FROM public.search_facets(NULL)
    WHERE dim = 'organization' AND slug = 'sojusz-testowy'),
  1::bigint,
  'faseta organization liczy trafienia'
);

-- 10. Autosuggest podpowiada term organizacji z kind='organization'.
SELECT ok(
  EXISTS (SELECT 1 FROM public.search_autosuggest('Sojusz')
           WHERE kind = 'organization' AND slug = 'sojusz-testowy'),
  'autosuggest zwraca organizację dla prefiksu nazwy'
);

-- 11. search_people_orgs: osoba z dorobkiem, poprawny licznik publikacji.
SELECT is(
  (SELECT post_count FROM public.search_people_orgs('Anna')
    WHERE kind = 'person' AND slug = 'anna-nowak'),
  2::bigint,
  'search_people_orgs: osoba z licznikiem publikacji (2)'
);

-- 12. search_people_orgs: organizacja z licznikiem publikacji.
SELECT is(
  (SELECT post_count FROM public.search_people_orgs('Sojusz')
    WHERE kind = 'organization' AND slug = 'sojusz-testowy'),
  1::bigint,
  'search_people_orgs: organizacja z licznikiem publikacji (1)'
);

-- 13. Tryb przeglądania (pusta fraza) zwraca osobę i organizację.
SELECT ok(
  EXISTS (SELECT 1 FROM public.search_people_orgs(NULL) WHERE slug = 'anna-nowak')
  AND EXISTS (SELECT 1 FROM public.search_people_orgs(NULL) WHERE slug = 'sojusz-testowy'),
  'search_people_orgs: pusta fraza = przeglądanie (osoba + organizacja)'
);

-- 14. Osoba redakcyjna BEZ dorobku i bez publicznego profilu jest niewidoczna.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.search_people_orgs(NULL) WHERE slug = 'piotr-cichy'),
  'search_people_orgs: brak dorobku i publicznego profilu = niewidoczny'
);

SELECT * FROM finish();
ROLLBACK;
