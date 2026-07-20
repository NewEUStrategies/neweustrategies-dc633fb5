-- pgTAP: operatory boolowskie wyszukiwarki (migracja 20260720140000).
--
-- Kontrakt nes_search_tsquery_adv v2:
--   * operatory AND / OR / NOT działają TYLKO pisane WIELKIMI literami
--     (konwencja Google/Scopus); małe "and/or/not" pozostają zwykłymi słowami,
--   * OR wiąże sąsiednie atomy w grupę alternatywy: "a b OR c" == a & (b | c),
--   * NOT wyklucza następny atom (słowo albo "frazę") - odpowiednik prefiksu -,
--   * AND to jawny zapis domyślnego złączenia (nie jest już szukanym słowem!),
--   * zapytanie bez pozytywnej treści (same wykluczenia/operatory) -> NULL,
--   * reszta kontraktu v1 bez zmian: unaccent+lower, sanityzacja, polska
--     fleksja, "frazy" przez <->, tryby all/any/phrase.
--
-- Kontrakt nes_search_positive_rest:
--   * usuwa -wykluczenia, "NOT <atom>", samodzielne tokeny AND/OR/NOT
--     i cudzysłowy; unaccent+lower; '' == tryb przeglądania,
--   * granice słów: NOTHING/ANDROID/OREO nie są operatorami.
--
-- Asercje semantyczne (@@ na tsvectorze), nie tekstowe - kontrakt nie zależy
-- od kolejności/nawiasowania stringa budowanego przez parser.

BEGIN;
SELECT plan(20);

-- ── AND: jawny zapis domyślnego złączenia (regresja: nie jest słowem) ────────
SELECT ok(
  to_tsvector('simple', unaccent('ukraina wspolpraca nato'))
    @@ public.nes_search_tsquery_adv('ukraina AND nato'),
  'AND: tekst bez dosłownego słowa "and" trafia (operator, nie term)'
);

SELECT ok(
  NOT (to_tsvector('simple', unaccent('ukraina gospodarka'))
    @@ public.nes_search_tsquery_adv('ukraina AND nato')),
  'AND: brak drugiego termu -> brak trafienia'
);

-- ── OR: grupa alternatywy sąsiednich atomów ──────────────────────────────────
SELECT ok(
  to_tsvector('simple', unaccent('rosja sankcje'))
    @@ public.nes_search_tsquery_adv('nato OR rosja'),
  'OR: trafia dokument z prawą stroną alternatywy'
);

SELECT ok(
  NOT (to_tsvector('simple', unaccent('niemcy polityka'))
    @@ public.nes_search_tsquery_adv('nato OR rosja')),
  'OR: dokument bez żadnego członu alternatywy -> brak trafienia'
);

SELECT ok(
  to_tsvector('simple', unaccent('energia jadrowa'))
    @@ public.nes_search_tsquery_adv('energia atomowa OR jadrowa'),
  'OR wiąże sąsiadów (jak Google): "a b OR c" == a & (b | c)'
);

SELECT ok(
  NOT (to_tsvector('simple', unaccent('atomowa jadrowa'))
    @@ public.nes_search_tsquery_adv('energia atomowa OR jadrowa')),
  'OR wiąże sąsiadów: człon spoza grupy (a) pozostaje wymagany'
);

SELECT ok(
  to_tsvector('simple', unaccent('onz rezolucja'))
    @@ public.nes_search_tsquery_adv('unia OR nato OR onz'),
  'OR: łańcuch a OR b OR c tworzy jedną grupę alternatywy'
);

-- ── NOT: wykluczenie następnego atomu ────────────────────────────────────────
SELECT ok(
  NOT (to_tsvector('simple', unaccent('nato szczyt'))
    @@ public.nes_search_tsquery_adv('nato NOT szczyt')),
  'NOT: dokument z wykluczonym słowem odpada'
);

SELECT ok(
  to_tsvector('simple', unaccent('nato rozszerzenie'))
    @@ public.nes_search_tsquery_adv('nato NOT szczyt'),
  'NOT: dokument bez wykluczonego słowa trafia'
);

SELECT ok(
  NOT (to_tsvector('simple', unaccent('nato szczyt wilenski deklaracja'))
    @@ public.nes_search_tsquery_adv('nato NOT "szczyt wilenski"')),
  'NOT "fraza": sąsiadujące słowa frazy wykluczają dokument'
);

SELECT ok(
  to_tsvector('simple', unaccent('nato szczyt w wilnie wilenski klimat'))
    @@ public.nes_search_tsquery_adv('nato NOT "szczyt wilenski"'),
  'NOT "fraza": te same słowa rozdzielone innymi NIE wykluczają'
);

SELECT ok(
  public.nes_search_tsquery_adv('NOT nato') IS NULL,
  'same wykluczenia (NOT x) -> NULL (tryb przeglądania, nie "wszystko poza")'
);

-- ── Wielkość liter i granice słów ────────────────────────────────────────────
SELECT ok(
  NOT (to_tsvector('simple', unaccent('kawa herbata'))
    @@ public.nes_search_tsquery_adv('kawa or herbata')),
  'małe "or" pozostaje zwykłym słowem (wymagane w dokumencie)'
);

-- ── Tryby dopasowania z operatorami ──────────────────────────────────────────
SELECT ok(
  NOT (to_tsvector('simple', unaccent('rosja sankcje'))
    @@ public.nes_search_tsquery_adv('nato rosja NOT sankcje', 'any')),
  'any + NOT: wykluczenie działa AND-em także przy alternatywie pozytywów'
);

SELECT ok(
  to_tsvector('simple', unaccent('nato manewry'))
    @@ public.nes_search_tsquery_adv('nato rosja NOT sankcje', 'any'),
  'any + NOT: czysty człon alternatywy trafia'
);

-- ── Regresje kontraktu v1 ────────────────────────────────────────────────────
SELECT is(
  public.nes_search_tsquery_adv('Gdańsk')::text,
  '''gdansk'':*',
  'regresja: unaccent + lower + prefiks bez zmian'
);

SELECT ok(
  to_tsvector('simple', unaccent('bezpieczeństwo energetyczne'))
    @@ public.nes_search_tsquery_adv('bezpieczeństwa'),
  'regresja: polska fleksja (rdzeń OR-owany z surowym termem) bez zmian'
);

-- ── nes_search_positive_rest ─────────────────────────────────────────────────
SELECT is(
  public.nes_search_positive_rest('nato AND -sankcje NOT "unia europejska" OR rosja'),
  'nato rosja',
  'positive_rest: usuwa -wykluczenia, NOT <atom> i tokeny AND/OR'
);

SELECT ok(
  public.nes_search_positive_rest('NOT nato') = ''
    AND public.nes_search_positive_rest('-nato') = '',
  'positive_rest: same wykluczenia -> pusty string (tryb przeglądania)'
);

SELECT is(
  public.nes_search_positive_rest('NOTHING ANDROID OREO'),
  'nothing android oreo',
  'positive_rest: NOTHING/ANDROID/OREO to słowa, nie operatory (granice słów)'
);

SELECT * FROM finish();
ROLLBACK;
