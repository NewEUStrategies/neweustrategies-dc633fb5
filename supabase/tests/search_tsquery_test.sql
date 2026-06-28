-- pgTAP: public.nes_search_tsquery — normalizacja frazy użytkownika na tsquery.
--
-- Kontrakt funkcji (migracja 20260628210000_fulltext_search.sql):
--   * unaccent + lower  → diakrytyki i wielkość liter bez znaczenia,
--   * każdy term jako prefiks (`:*`)            → wrażenie instant-search,
--   * termy łączone AND-em (` & `)              → zawężanie wyników,
--   * sanityzacja do [a-z0-9] wewnątrz termu    → odporność na znaki specjalne,
--   * puste / złożone z samej interpunkcji wejście → NULL (zero wyników),
--     dzięki czemu RPC wyszukiwania zwraca pusty zbiór zamiast się wywracać.
--
-- Część asercji jest tekstowa (dokładny zapis tsquery), a część semantyczna
-- (@@ na tsvectorze) — żeby kontrakt AND/prefiksu nie zależał od kolejności
-- sklejania termów przez string_agg.

BEGIN;
SELECT plan(10);

-- ── Normalizacja pojedynczego termu (dokładny tekst tsquery) ────────────────
SELECT is(
  public.nes_search_tsquery('Gdańsk')::text,
  '''gdansk'':*',
  'unaccent + lower + prefiks: "Gdańsk" → ''gdansk'':*'
);

SELECT is(
  public.nes_search_tsquery('geo!@#pol')::text,
  '''geopol'':*',
  'znaki specjalne usuwane wewnątrz termu: "geo!@#pol" → ''geopol'':*'
);

-- ── Wejścia bez treści → NULL (zero wyników w RPC) ──────────────────────────
SELECT ok(public.nes_search_tsquery('')    IS NULL, 'pusty string → NULL');
SELECT ok(public.nes_search_tsquery('   ') IS NULL, 'same białe znaki → NULL');
SELECT ok(public.nes_search_tsquery(NULL)  IS NULL, 'NULL → NULL');
SELECT ok(public.nes_search_tsquery('!!! @@@ ###') IS NULL, 'sama interpunkcja → NULL');

-- ── Semantyka AND / prefiks / diakrytyki (dopasowanie do tsvectora) ─────────
SELECT ok(
  to_tsvector('simple', unaccent('unia europejska polityka')) @@ public.nes_search_tsquery('Unia Europejska'),
  'termy łączone AND-em: wszystkie obecne → trafienie'
);

SELECT ok(
  NOT (to_tsvector('simple', unaccent('unia polityka')) @@ public.nes_search_tsquery('Unia Europejska')),
  'termy łączone AND-em: brak jednego termu → brak trafienia'
);

SELECT ok(
  to_tsvector('simple', unaccent('geopolityka')) @@ public.nes_search_tsquery('geopol'),
  'prefiks: "geopol" trafia "geopolityka"'
);

SELECT ok(
  to_tsvector('simple', unaccent('Gdansk')) @@ public.nes_search_tsquery('Gdańsk'),
  'diakrytyki bez znaczenia: zapytanie "Gdańsk" trafia tekst "Gdansk"'
);

SELECT * FROM finish();
ROLLBACK;
