-- ============================================================================
-- „POWIĄZANE KATEGORIE / TAGI" NA ARCHIWACH: RANKING Z REALNEGO SYGNAŁU
-- ============================================================================
--
-- PRZYCZYNA ŹRÓDŁOWA. Sekcja pod listą archiwum (`ArchiveBody.tsx`) i widżet
-- sidebara (`ArchiveSidebar.tsx`) - dwie skopiowane implementacje z różnymi
-- limitami (12 i 10) i różnymi kluczami cache - pytały PostgREST o DOWOLNE inne
-- terminy: `.from("categories").select(...).neq("id", taxonomyId).limit(12)`.
-- Bez `ORDER BY` i bez żadnego związku z bieżącym archiwum, czyli pierwsze
-- wiersze w kolejności fizycznej tabeli.
--
-- SKUTEK. Czytelnik archiwum „Energetyka" dostawał jako „powiązane" to, co
-- akurat leżało na początku sterty (np. „Kultura", „Sport"), ten sam zestaw pod
-- KAŻDYM archiwum i zestaw zmieniający się po VACUUM. Szum podpisany jako
-- rekomendacja - a do tego dwa zapytania o to samo na jednej stronie, gdy
-- redakcja włączyła i sekcję, i widżet.
--
-- ROZWIĄZANIE. `related_taxonomies(_kind, _taxonomy_id, _limit)` liczy
-- WSPÓŁWYSTĘPOWANIE na opublikowanych wpisach: kandydatem jest termin tego
-- samego rodzaju, który dzieli z bieżącym co najmniej jeden opublikowany,
-- nieusunięty wpis. Ranking to kosinus znormalizowanego współwystępowania:
--
--     score = shared / sqrt(n_bieżący * n_kandydat)
--
-- gdzie `n` to liczba opublikowanych wpisów terminu. DLACZEGO NIE SAMO
-- `shared`: surowa liczba wspólnych wpisów zawsze wynosi na szczyt największy
-- termin serwisu („Polityka" z tysiącem wpisów dzieli coś z każdym), czyli pod
-- każdym archiwum ten sam hub - ten sam błąd co wcześniej, tylko lepiej ukryty.
-- Kosinus mierzy, jak MOCNO dwa terminy się pokrywają, a nie jak duży jest
-- kandydat. Remisy: więcej wspólnych wpisów wyżej, potem nazwa, slug i id -
-- kolejność jest deterministyczna, więc cache i SSR nie migają.
--
-- WYNIK LICZONY JAKO sqrt(shared² / (n_bieżący * n_kandydat)), NIE JAKO
-- shared / sqrt(...). Matematycznie to ten sam kosinus, ale w float8 nie ten
-- sam porządek remisów: przy `shared / sqrt(n_b * n_k)` równe kosinusy często
-- różniły się o 1 ulp (1 / sqrt(6 * 1) > 3 / sqrt(6 * 9) daje `t`, choć oba
-- to 1/sqrt(6)), więc ORDER BY sortował po szumie zaokrągleń i reguła „przy
-- remisie więcej wspólnych wpisów wyżej" w ogóle nie dochodziła do głosu.
-- W obecnej postaci shared² i n_b * n_k są dokładnymi liczbami całkowitymi
-- w float8 (daleko poniżej 2^53), a dzielenie i pierwiastek są w IEEE 754
-- poprawnie zaokrąglane - równe ułamki dają BITOWO równy wynik, a monotoniczne
-- zaokrąglenie nigdy nie odwraca kolejności różnych. Zmierzone na siatce
-- równych par: stara postać 11 985 rozjazdów na 54 905, obecna 0.
--
-- „TEN SAM RODZAJ" NA DWÓCH POZIOMACH. `_kind` rozdziela kategorie i tagi
-- (osobne tabele, osobne trasy `/category/$slug` i `/tag/$slug`). Kategorie
-- mają DODATKOWO wymiar `categories.kind` (category, pub_type, region, topic,
-- project, series, organization) - kandydat musi należeć do tego samego
-- wymiaru co termin bieżący. Bez tego format („Komentarz", `pub_type`), który
-- siedzi na co drugim wpisie, wchodziłby jako „powiązana kategoria" tematu.
--
-- DLACZEGO SECURITY DEFINER, A NIE INVOKER - ZMIERZONE, NIE ZAŁOŻONE.
-- Pierwsza wersja była SECURITY INVOKER (niech RLS wołającego decyduje), ale
-- polityki publiczne liczą `public_tenant_id()` PER WIERSZ: `post_categories
-- public read` / `post_tags public read` to `EXISTS (... p.tenant_id =
-- public_tenant_id() ...)`, a sama funkcja (plpgsql: nagłówki żądania,
-- weryfikacja asercji hosta, odczyt `tenants`) kosztuje ~0,15 ms na wywołanie.
-- Na replice z 30 tys. wpisów, 78 tys. wierszy pivotu kategorii i 150 tys.
-- pivotu tagów wywołanie jako `anon` trwało 1,2-3,6 s (sam `count(*)` z pivotu
-- kategorii-huba: 2,7 s). Ta funkcja - SECURITY DEFINER, najemca policzony
-- RAZ - na tych samych danych: tag 14-18 ms, zwykła kategoria 51-56 ms,
-- kategoria-hub (60% wpisów) 89-121 ms, wynik identyczny. Sekcja dekoracyjna
-- archiwum nie może kosztować sekund bazy.
--
-- ZAKRES JAWNY, JAK W `popular_post_ids` / `related_posts_dwell`. Skoro RLS
-- nie działa, funkcja sama oddaje dokładnie to, co anonim zobaczyłby przez
-- polityki publiczne:
--   * najemca PUBLICZNY - `public_tenant_id()` (host żądania), liczony raz
--     w CTE `tenant`; termin bieżący, jego wpisy i kandydaci muszą do niego
--     należeć (kandydat i wpis są dodatkowo zakotwiczone w najemcy terminu,
--     więc wiersz pivotu łączący obcych najemców niczego nie wnosi);
--   * WYŁĄCZNIE wpisy `status = 'published' AND deleted_at IS NULL` - także
--     w mianowniku (`n`), więc szkic nie zawyża rozmiaru terminu;
--   * żadnego `has_role()` w ciele - inwariant `check:sql-tenant-scope`.
-- Zalogowany redaktor dostaje ten sam publiczny wynik co anonim (szkice, które
-- widzi przez RLS, nie wchodzą do rankingu).
--
-- KONTRAKT WEJŚCIA.
--   * nieznany `_kind` (cokolwiek poza 'category' / 'tag'), NULL albo
--     nieistniejący / obcy termin -> PUSTY wynik, nie wyjątek. Funkcja zasila
--     sekcję dekoracyjną archiwum: błąd i brak sygnału mają dla czytelnika ten
--     sam skutek (sekcji nie ma), a jedyny wołający
--     (`src/lib/queries/relatedTaxonomies.ts`) ma `_kind` typowany unią;
--   * `_limit` klamrowany do 1..24 (NULL -> 12) - sufit chroni bazę przed
--     wołaniem PostgREST wprost z dowolną liczbą.
--
-- DWIE GAŁĘZIE, CELOWO ZDUBLOWANE. Wspólne CTE nad `UNION ALL` obu pivotów
-- planer (plan generyczny funkcji SQL - `_kind` nie jest stałą) traktował
-- jak jedną relację o nieznanym rozmiarze i skanował CAŁE `post_categories`
-- i `posts` przy każdym wywołaniu - koszt rósł z rozmiarem serwisu, nie
-- archiwum. Osobne gałęzie z bramką `_kind = ...` dają planerowi bezpośrednie
-- tabele: wpisy terminu idą indeksem po terminie
-- (`post_categories_category_idx` / `idx_post_tags_tag`), a gałąź
-- z niepasującym `_kind` ma pustą kotwicę i nie czyta nic (EXPLAIN: „never
-- executed"). Dla tagów (rzadki pivot) planer bierze indeksy na każdym kroku:
-- pozostałe tagi wpisów kluczem głównym `(post_id, tag_id)`, rozmiary
-- kandydatów - indeksem po tagu. Dla kategorii rozmiary kandydatów liczy jednym
-- przebiegiem pivotu z hashem `posts` - i to jest właściwy plan, nie przeoczenie:
-- kategorii jest kilkadziesiąt, a kategoria-hub współwystępuje niemal ze
-- wszystkimi, więc mianownik i tak obejmuje prawie cały pivot najemcy. Rozmiar
-- liczy JEDEN agregat dla wszystkich kandydatów - wersja z LATERAL per kandydat
-- powtarzała w planie generycznym pełny skan `posts` dla każdego z nich
-- (kategoria-hub: 742 ms).
--
-- `SET jit = off`. Plan generyczny wycenia obie gałęzie naraz, więc koszt
-- szacunkowy przekracza `jit_above_cost` i każde wywołanie płaciło za
-- kompilację LLVM więcej niż za samo zapytanie (tag: 69-88 ms z JIT, 11 ms
-- bez). Zapytanie jest krótkie i OLTP-owe - JIT nie ma tu czego przyspieszyć.
--
-- Regresję pilnuje `supabase/tests/related_taxonomies_test.sql`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.related_taxonomies(
  _kind text,
  _taxonomy_id uuid,
  _limit integer DEFAULT 12
)
RETURNS TABLE (
  id uuid,
  slug text,
  name_pl text,
  name_en text,
  shared_posts integer,
  score double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET jit = off
AS $$
  WITH tenant AS (
    -- Najemca publiczny RAZ na wywołanie (nie per wiersz, jak w politykach).
    SELECT public.public_tenant_id() AS id
  ),

  -- ── Kategorie ────────────────────────────────────────────────────────────
  cat_anchor AS (
    SELECT c.id, c.tenant_id, c.kind
      FROM public.categories c
      JOIN tenant tn ON tn.id = c.tenant_id
     WHERE _kind = 'category'
       AND c.id = _taxonomy_id
  ),
  cat_anchor_posts AS (
    SELECT pc.post_id
      FROM cat_anchor a
      JOIN public.post_categories pc ON pc.category_id = a.id
      JOIN public.posts p ON p.id = pc.post_id
     WHERE p.tenant_id = a.tenant_id
       AND p.status = 'published'
       AND p.deleted_at IS NULL
  ),
  cat_shared AS (
    SELECT pc.category_id AS term_id, count(*)::integer AS shared_posts
      FROM cat_anchor_posts ap
      JOIN public.post_categories pc ON pc.post_id = ap.post_id
     WHERE pc.category_id <> _taxonomy_id
     GROUP BY pc.category_id
  ),
  -- Rozmiar kandydata tą samą miarą co termin bieżący - JEDNYM agregatem
  -- dla wszystkich kandydatów (nie LATERAL per kandydat: plan generyczny
  -- powtarzał wtedy pełny skan `posts` dla każdego z nich).
  cat_sized AS (
    SELECT pc.category_id AS term_id, count(*)::integer AS term_posts
      FROM cat_shared s
      JOIN public.post_categories pc ON pc.category_id = s.term_id
      JOIN public.posts p ON p.id = pc.post_id
      JOIN cat_anchor a ON a.tenant_id = p.tenant_id
     WHERE p.status = 'published'
       AND p.deleted_at IS NULL
     GROUP BY pc.category_id
  ),
  cat_ranked AS (
    -- sqrt(shared² / (n_b * n_k)), nie shared / sqrt(n_b * n_k): równe
    -- kosinusy muszą dać bitowo równy float8, inaczej remis rozstrzyga szum
    -- zaokrągleń zamiast `shared_posts` (uzasadnienie w nagłówku).
    SELECT c.id, c.slug, c.name_pl, c.name_en, s.shared_posts,
           sqrt(s.shared_posts::double precision * s.shared_posts
                / (n.anchor_posts::double precision * z.term_posts)) AS score
      FROM cat_shared s
      JOIN cat_sized z ON z.term_id = s.term_id
      JOIN public.categories c ON c.id = s.term_id
      JOIN cat_anchor a ON a.tenant_id = c.tenant_id AND a.kind = c.kind
     CROSS JOIN (SELECT count(*) AS anchor_posts FROM cat_anchor_posts) n
  ),

  -- ── Tagi (jeden wymiar, jedna nazwa dla obu języków) ─────────────────────
  tag_anchor AS (
    SELECT t.id, t.tenant_id
      FROM public.tags t
      JOIN tenant tn ON tn.id = t.tenant_id
     WHERE _kind = 'tag'
       AND t.id = _taxonomy_id
  ),
  tag_anchor_posts AS (
    SELECT pt.post_id
      FROM tag_anchor a
      JOIN public.post_tags pt ON pt.tag_id = a.id
      JOIN public.posts p ON p.id = pt.post_id
     WHERE p.tenant_id = a.tenant_id
       AND p.status = 'published'
       AND p.deleted_at IS NULL
  ),
  tag_shared AS (
    SELECT pt.tag_id AS term_id, count(*)::integer AS shared_posts
      FROM tag_anchor_posts ap
      JOIN public.post_tags pt ON pt.post_id = ap.post_id
     WHERE pt.tag_id <> _taxonomy_id
     GROUP BY pt.tag_id
  ),
  tag_sized AS (
    SELECT pt.tag_id AS term_id, count(*)::integer AS term_posts
      FROM tag_shared s
      JOIN public.post_tags pt ON pt.tag_id = s.term_id
      JOIN public.posts p ON p.id = pt.post_id
      JOIN tag_anchor a ON a.tenant_id = p.tenant_id
     WHERE p.status = 'published'
       AND p.deleted_at IS NULL
     GROUP BY pt.tag_id
  ),
  tag_ranked AS (
    -- Ta sama postać wyniku co w gałęzi kategorii (bitowo równe remisy).
    SELECT t.id, t.slug, t.name AS name_pl, t.name AS name_en, s.shared_posts,
           sqrt(s.shared_posts::double precision * s.shared_posts
                / (n.anchor_posts::double precision * z.term_posts)) AS score
      FROM tag_shared s
      JOIN tag_sized z ON z.term_id = s.term_id
      JOIN public.tags t ON t.id = s.term_id
      JOIN tag_anchor a ON a.tenant_id = t.tenant_id
     CROSS JOIN (SELECT count(*) AS anchor_posts FROM tag_anchor_posts) n
  )

  SELECT r.id, r.slug, r.name_pl, r.name_en, r.shared_posts, r.score
    FROM (
      SELECT * FROM cat_ranked
      UNION ALL
      SELECT * FROM tag_ranked
    ) r
   ORDER BY r.score DESC, r.shared_posts DESC, r.name_pl, r.slug, r.id
   LIMIT GREATEST(LEAST(COALESCE(_limit, 12), 24), 1);
$$;

REVOKE ALL ON FUNCTION public.related_taxonomies(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.related_taxonomies(text, uuid, integer)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.related_taxonomies(text, uuid, integer) IS
  'Powiązane terminy archiwum (_kind: category | tag) z WSPÓŁWYSTĘPOWANIA na '
  'opublikowanych, nieusuniętych wpisach najemcy publicznego (public_tenant_id, '
  'liczony raz): ranking kosinusem shared / sqrt(n_bieżący * n_kandydat), remisy po '
  'shared_posts, nazwie, slugu. Kategorie tylko z tego samego wymiaru categories.kind. '
  'SECURITY DEFINER (RLS liczy public_tenant_id per wiersz: jako INVOKER sekundy '
  'zamiast milisekund), bez has_role. Nieznany _kind / brak terminu -> pusty wynik; '
  '_limit klamrowany do 1..24. Zasila lib/queries/relatedTaxonomies.';
