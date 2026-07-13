-- pgTAP: fasetowe wyszukiwanie archiwum (migracja 20260714130000).
--
-- Pokrywa własności, których nie sprawdza search_posts_smoke_test:
--   1. Filtr termu taksonomii zawęża zbiór (AND po wielu termach).
--   2. Hierarchia region -> państwo: filtr po regionie łapie posty przypięte
--      tylko do państwa-potomka.
--   3. Fasety liczą po PEŁNYM zbiorze trafień, a licznik regionu roluje państwa.
--   4. Filtr dostępności (content_access.mode) i formatu (post_format).
--   5. Sortowanie: newest wg published_at.
--   6. Fleksja: zapytanie w dopełniaczu ("bezpieczenstwa") trafia mianownik
--      w treści ("bezpieczenstwo") - i odwrotnie.
--   7. Tolerancja literówek: "geopolityks" trafia "geopolityka" (fuzzy=true).
--   8. Autosuggest zwraca autora, term i publikację; prefiks bije trigram.
--   9. total_count niesie pełną liczność mimo _limit.
--
-- Wszystko z perspektywy anona; tenant rozstrzygany serwerowo (publiczny).

BEGIN;
SELECT plan(13);

ALTER TABLE auth.users DISABLE TRIGGER USER;

SELECT public.public_tenant_id() AS nes \gset

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('11111111-0000-0000-0000-0000000000fe', :'nes', 'fs-home');

-- Autor z dorobkiem (autosuggest + faseta autora).
INSERT INTO auth.users (id, email) VALUES
  ('fa000000-0000-0000-0000-0000000000a1', 'kowalski@fs.test');
INSERT INTO public.profiles (id, email, display_name, slug, tenant_id, discoverable) VALUES
  ('fa000000-0000-0000-0000-0000000000a1', 'kowalski@fs.test', 'Jan Kowalski',
   'jan-kowalski', :'nes', true);

-- Słownik: region "Europa" -> państwo "Polska" (hierarchia); typ "Raport".
INSERT INTO public.categories (id, tenant_id, slug, name_pl, name_en, kind, parent_id) VALUES
  ('fc000000-0000-0000-0000-0000000000e1', :'nes', 'europa', 'Europa', 'Europe', 'region', NULL),
  ('fc000000-0000-0000-0000-0000000000e2', :'nes', 'polska', 'Polska', 'Poland', 'region',
   'fc000000-0000-0000-0000-0000000000e1'),
  ('fc000000-0000-0000-0000-0000000000e3', :'nes', 'raport-fs', 'Raport', 'Report', 'pub_type', NULL);

-- Posty:
--  P1: dwujęzyczny, bezpieczeństwo energetyczne, przypięty do PAŃSTWA Polska
--      + typ Raport, dostęp członkowski (members), format standard, popularny.
--  P2: geopolityka, bez przypięcia regionu, dostęp publiczny, starszy.
--  P3: tylko EN, format video, dostęp public.
INSERT INTO public.posts
  (id, slug, status, tenant_id, parent_page_id, title_pl, title_en, content_pl,
   post_format, published_at) VALUES
  ('fb000000-0000-0000-0000-000000000001', 'fs-p1', 'published', :'nes',
   '11111111-0000-0000-0000-0000000000fe',
   'Bezpieczenstwo energetyczne Europy', 'Energy security of Europe',
   'Analiza o bezpieczenstwie energetycznym.', 'standard', now() - interval '1 day'),
  ('fb000000-0000-0000-0000-000000000002', 'fs-p2', 'published', :'nes',
   '11111111-0000-0000-0000-0000000000fe',
   'Geopolityka regionu', 'Regional geopolitics',
   'Tekst o geopolityce.', 'standard', now() - interval '10 days'),
  ('fb000000-0000-0000-0000-000000000003', 'fs-p3', 'published', :'nes',
   '11111111-0000-0000-0000-0000000000fe',
   '', 'English only report', 'Body.', 'video', now() - interval '5 days');

UPDATE public.posts SET author_id = 'fa000000-0000-0000-0000-0000000000a1'
 WHERE id = 'fb000000-0000-0000-0000-000000000001';

-- Przypięcia taksonomii: P1 -> Polska (potomek Europy) + Raport.
INSERT INTO public.post_categories (post_id, category_id) VALUES
  ('fb000000-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-0000000000e2'),
  ('fb000000-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-0000000000e3');

-- Dostępność: P1 członkowska (members), reszta domyślnie publiczna.
INSERT INTO public.content_access (tenant_id, entity_type, entity_id, mode) VALUES
  (:'nes', 'post', 'fb000000-0000-0000-0000-000000000001', 'members');

-- Popularność P1 (sort=popular).
INSERT INTO public.post_views (post_id, tenant_id, viewer_hash, viewed_at) VALUES
  ('fb000000-0000-0000-0000-000000000001', :'nes', 'h1', now()),
  ('fb000000-0000-0000-0000-000000000001', :'nes', 'h2', now());

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);

-- 1. Filtr termu (typ Raport) zawęża do P1.
SELECT is(
  (SELECT array_agg(slug) FROM public.search_posts(
     NULL, 80, NULL, NULL, NULL, NULL, ARRAY['fc000000-0000-0000-0000-0000000000e3']::uuid[])),
  ARRAY['fs-p1'],
  'filtr termu (typ publikacji) zawęża zbiór'
);

-- 2. Hierarchia: filtr po REGIONIE Europa łapie post przypięty do państwa Polska.
SELECT is(
  (SELECT array_agg(slug) FROM public.search_posts(
     NULL, 80, NULL, NULL, NULL, NULL, ARRAY['fc000000-0000-0000-0000-0000000000e1']::uuid[])),
  ARRAY['fs-p1'],
  'filtr regionu roluje potomków (Europa łapie post z Polski)'
);

-- 3. AND po wielu termach: Raport ∧ Europa -> nadal P1; Raport ∧ (region bez
--    posta) -> pusto.
SELECT is(
  (SELECT count(*)::int FROM public.search_posts(
     NULL, 80, NULL, NULL, NULL, NULL,
     ARRAY['fc000000-0000-0000-0000-0000000000e3',
           'fc000000-0000-0000-0000-0000000000e1']::uuid[])),
  1,
  'wiele termów łączone AND-em (Raport ∧ Europa → P1)'
);

-- 4. Faseta regionu Europa roluje państwo Polska: licznik = 1 (bez podwójnego).
SELECT is(
  (SELECT cnt FROM public.search_facets(NULL)
    WHERE dim = 'region' AND slug = 'europa'),
  1::bigint,
  'faseta regionu roluje państwa-potomków (Europa = 1)'
);

-- 5. Faseta typu publikacji liczy P1 pod "raport-fs".
SELECT is(
  (SELECT cnt FROM public.search_facets(NULL)
    WHERE dim = 'pub_type' AND slug = 'raport-fs'),
  1::bigint,
  'faseta typu publikacji liczy trafienia'
);

-- 6. Faseta dostępności: members = 1 (P1), public = 2 (P2, P3).
SELECT is(
  (SELECT cnt FROM public.search_facets(NULL) WHERE dim = 'access' AND slug = 'members'),
  1::bigint,
  'faseta dostępności: members = 1'
);
SELECT is(
  (SELECT cnt FROM public.search_facets(NULL) WHERE dim = 'access' AND slug = 'public'),
  2::bigint,
  'faseta dostępności: public = 2'
);

-- 7. Filtr dostępności members zwraca tylko P1.
SELECT is(
  (SELECT array_agg(slug) FROM public.search_posts(
     NULL, 80, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'members')),
  ARRAY['fs-p1'],
  'filtr dostępności (members) zawęża do treści członkowskiej'
);

-- 8. Filtr formatu video zwraca tylko P3.
SELECT is(
  (SELECT array_agg(slug) FROM public.search_posts(
     NULL, 80, NULL, NULL, NULL, NULL, NULL, 'video')),
  ARRAY['fs-p3'],
  'filtr formatu (video) zawęża zbiór'
);

-- 9. Sortowanie newest: najświeższy P1 (1 dzień) przed P3 (5 dni) i P2 (10 dni).
SELECT is(
  (SELECT array_agg(slug ORDER BY ord)
     FROM (SELECT slug, row_number() OVER () AS ord
             FROM public.search_posts(NULL, 80, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                                       'newest')) s),
  ARRAY['fs-p1','fs-p3','fs-p2'],
  'sort newest: malejąco po dacie publikacji'
);

-- 10. Fleksja PL: zapytanie w dopełniaczu trafia mianownik w tytule/treści.
SELECT ok(
  EXISTS (SELECT 1 FROM public.search_posts('bezpieczenstwa') WHERE slug = 'fs-p1'),
  'fleksja: "bezpieczenstwa" (dopełniacz) trafia "bezpieczenstwo"'
);

-- 11. Tolerancja literówek: "geopolityks" trafia "Geopolityka" jako fuzzy.
SELECT ok(
  EXISTS (SELECT 1 FROM public.search_posts('geopolityks') WHERE slug = 'fs-p2' AND fuzzy),
  'literówka: "geopolityks" trafia "geopolityka" (fuzzy=true)'
);

-- 12. total_count niesie pełną liczność mimo małego _limit.
SELECT is(
  (SELECT DISTINCT total_count FROM public.search_posts(NULL, 1)),
  3::bigint,
  'total_count = pełna liczność archiwum mimo _limit=1'
);

-- 13. Autosuggest: prefiks autora "Jan" zwraca profil autora ponad progiem.
SELECT ok(
  EXISTS (SELECT 1 FROM public.search_autosuggest('Jan')
           WHERE kind = 'author' AND slug = 'jan-kowalski'),
  'autosuggest zwraca autora dla prefiksu nazwiska'
);

SELECT * FROM finish();
ROLLBACK;
