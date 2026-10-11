-- ============================================================================
-- MENU: POZYCJE KATEGORII PODĄŻAJĄ ZA KATEGORIĄ + NAPRAWA MARTWYCH LINKÓW
-- `/category/<slug>`
-- ============================================================================
--
-- PRZYCZYNA (2026-10 audyt SEO). Menu główne linkowało `/category/ekonomia`
-- (Analizy → Specjalizacja → Ekonomia, pozycja `item_type = 'category'`
-- z `ref_id = 8d03c162-…`), a ten adres odpowiada 404. Pozycja menu KOPIUJE
-- adres w chwili dodania (`/category/${slug}` w panelu „Dodaj element menu"),
-- a `ref_id` był zapisywany i nigdy nieczytany. Zmiana slugu kategorii
-- (`upsertCategory` - zwykły UPDATE) ani jej skasowanie (`deleteCategory`) nie
-- dotykały `menu_items`, więc każdy taki zapis zostawiał w nagłówku KAŻDEJ
-- strony link do nieistniejącego archiwum - dla crawlera wewnętrzny 404
-- z najmocniejszego miejsca serwisu.
--
-- CO TA MIGRACJA ROBI
--   1. `_menu_items_prune_dead(uuid[])` - jedna reguła dla martwej pozycji:
--      LIŚĆ znika, a pozycja, która ma jeszcze żywe dzieci, zostaje NAGŁÓWKIEM
--      bez linku (`custom`, pusty `href`, bez `ref_id`). Kasowanie kaskadą
--      (`parent_id ON DELETE CASCADE`) zabrałoby działające linki dzieci,
--      a przeniesienie ich wyżej przestawiłoby układ mega menu; nagłówek bez
--      linku renderuje się jako tytuł kolumny albo przycisk panelu.
--   2. Wyzwalacz `categories_sync_menu_items`: zmiana slugu przepisuje `href`
--      pozycji wskazujących kategorię (po `ref_id` oraz pozycji bez `ref_id`
--      z DOKŁADNIE starym adresem), skasowanie kategorii przepuszcza je przez
--      regułę z punktu 1. Zakres to menu TEGO SAMEGO najemcy
--      (`menus.tenant_id = kategoria.tenant_id`), a zapis idzie w tej samej
--      transakcji co zmiana kategorii - niezależnie od ścieżki (panel, import
--      WordPressa, SQL). Przekierowanie 301 starego adresu zakłada aplikacja
--      (`upsertCategory` → `captureAutoRedirect`), tak jak przy stronach.
--   3. `_menu_items_repair_category_links()` - naprawa danych zastanych,
--      wywołana raz na końcu tej migracji (idempotentna, można ją powtórzyć):
--        a) pozycja kategorii z żywym `ref_id` dostaje bieżący adres
--           kategorii,
--        b) pozycja kategorii z martwym (albo pustym) `ref_id`, której `href`
--           wskazuje istniejącą kategorię najemcy, zostaje do niej dowiązana,
--        c) martwe linki - pozycja kategorii bez żywej referencji i bez
--           żywego adresu oraz własny link `/category/<slug>` do kategorii,
--           której w najemcy nie ma - idą przez regułę z punktu 1.
--
-- Odczyt publiczny (`fetchMenuWithItems`) rozstrzyga od dziś pozycję po
-- `ref_id` sam, więc ta migracja nie jest jedyną obroną - ale bez niej panel
-- pokazywałby martwe pozycje, a stary klient (karta sprzed wdrożenia)
-- renderowałby zapisany `href`.

-- ---------------------------------------------------------------------------
-- 1. Reguła martwej pozycji
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._menu_items_prune_dead(_item_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dead uuid[] := COALESCE(_item_ids, '{}'::uuid[]);
  v_round integer := 0;
  v_rows integer;
  v_total integer := 0;
BEGIN
  IF cardinality(v_dead) = 0 THEN
    RETURN 0;
  END IF;

  -- Liście kasujemy RUNDAMI: martwy rodzic, którego wszystkie dzieci też były
  -- martwe, staje się liściem dopiero po skasowaniu dzieci. Menu ma najwyżej
  -- trzy poziomy (`MAX_MENU_DEPTH`); bezpiecznik dziesięciu rund chroni przed
  -- pętlą na danych z cyklem w `parent_id`.
  LOOP
    v_round := v_round + 1;
    DELETE FROM public.menu_items mi
     WHERE mi.id = ANY (v_dead)
       AND NOT EXISTS (SELECT 1 FROM public.menu_items c WHERE c.parent_id = mi.id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
    EXIT WHEN v_rows = 0 OR v_round >= 10;
  END LOOP;

  -- Zostały martwe pozycje z ŻYWYMI dziećmi: nagłówek bez linku.
  UPDATE public.menu_items mi
     SET item_type = 'custom'::public.menu_item_type,
         ref_id = NULL,
         href = ''
   WHERE mi.id = ANY (v_dead)
     AND (mi.item_type <> 'custom'::public.menu_item_type OR mi.ref_id IS NOT NULL OR mi.href <> '');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_total + v_rows;
END;
$$;

COMMENT ON FUNCTION public._menu_items_prune_dead(uuid[]) IS
  'Usuwa martwe pozycje menu: liść kasuje (rundami, więc martwy rodzic martwych dzieci też znika), a pozycję z żywymi dziećmi zamienia w nagłówek bez linku (custom, pusty href, bez ref_id). Wołający odpowiada za zakres najemcy listy identyfikatorów. Pomocnik wewnętrzny.';

REVOKE ALL ON FUNCTION public._menu_items_prune_dead(uuid[]) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Kategoria → pozycje menu (slug, kasowanie)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._categories_sync_menu_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dead uuid[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.slug IS DISTINCT FROM OLD.slug THEN
      UPDATE public.menu_items mi
         SET href = CASE WHEN mi.href LIKE '/en/%' THEN '/en/category/' ELSE '/category/' END
                    || NEW.slug
        FROM public.menus m
       WHERE m.id = mi.menu_id
         AND m.tenant_id = NEW.tenant_id
         AND (
           (mi.item_type = 'category'::public.menu_item_type AND mi.ref_id = NEW.id)
           OR (
             mi.ref_id IS NULL
             AND mi.item_type IN ('category'::public.menu_item_type, 'custom'::public.menu_item_type)
             AND mi.href IN ('/category/' || OLD.slug, '/en/category/' || OLD.slug)
           )
         );
    END IF;
    RETURN NULL;
  END IF;

  SELECT COALESCE(array_agg(mi.id), '{}'::uuid[]) INTO v_dead
    FROM public.menu_items mi
    JOIN public.menus m ON m.id = mi.menu_id
   WHERE m.tenant_id = OLD.tenant_id
     AND (
       (mi.item_type = 'category'::public.menu_item_type AND mi.ref_id = OLD.id)
       OR (
         mi.ref_id IS NULL
         AND mi.item_type IN ('category'::public.menu_item_type, 'custom'::public.menu_item_type)
         AND mi.href IN ('/category/' || OLD.slug, '/en/category/' || OLD.slug)
       )
     );
  PERFORM public._menu_items_prune_dead(v_dead);
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public._categories_sync_menu_items() IS
  'Wyzwalacz categories: zmiana slugu przepisuje href pozycji menu wskazujących kategorię (po ref_id albo dokładnym starym adresie), skasowanie kategorii usuwa je regułą _menu_items_prune_dead. Zakres: menu tego samego najemcy.';

REVOKE ALL ON FUNCTION public._categories_sync_menu_items() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS categories_sync_menu_items ON public.categories;
CREATE TRIGGER categories_sync_menu_items
  AFTER UPDATE OF slug OR DELETE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public._categories_sync_menu_items();

-- ---------------------------------------------------------------------------
-- 3. Naprawa danych zastanych
-- ---------------------------------------------------------------------------
--
-- Wzorzec adresu archiwum: `/category/<slug>` (także z prefiksem `/en`,
-- z końcowym ukośnikiem, query albo hashem) - ten sam, którym odczyt publiczny
-- rozpoznaje własne linki do kategorii (`CATEGORY_HREF_RE`,
-- `src/lib/menus/refResolution.ts`). Slug porównujemy w zakresie najemcy
-- menu, bo slugi kategorii są unikalne wyłącznie w obrębie najemcy.
CREATE OR REPLACE FUNCTION public._menu_items_repair_category_links()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pattern constant text := '^(?:/en)?/category/([^/?#]+)/?(?:[?#].*)?$';
  v_rows integer;
  v_total integer := 0;
  v_dead uuid[];
BEGIN
  -- a) żywy `ref_id` → bieżący adres kategorii.
  UPDATE public.menu_items mi
     SET href = '/category/' || c.slug
    FROM public.menus m, public.categories c
   WHERE m.id = mi.menu_id
     AND mi.item_type = 'category'::public.menu_item_type
     AND c.id = mi.ref_id
     AND c.tenant_id = m.tenant_id
     AND mi.href IS DISTINCT FROM '/category/' || c.slug;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  -- b) martwy albo pusty `ref_id`, żywy adres → dowiązanie do kategorii.
  UPDATE public.menu_items mi
     SET ref_id = c.id
    FROM public.menus m, public.categories c
   WHERE m.id = mi.menu_id
     AND mi.item_type = 'category'::public.menu_item_type
     AND c.tenant_id = m.tenant_id
     AND c.slug = (regexp_match(mi.href, v_pattern))[1]
     AND NOT EXISTS (
       SELECT 1 FROM public.categories live
        WHERE live.id = mi.ref_id AND live.tenant_id = m.tenant_id
     );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  -- c) martwe linki.
  SELECT COALESCE(array_agg(mi.id), '{}'::uuid[]) INTO v_dead
    FROM public.menu_items mi
    JOIN public.menus m ON m.id = mi.menu_id
   WHERE (
           (mi.item_type = 'category'::public.menu_item_type
             AND (mi.ref_id IS NOT NULL OR mi.href ~ v_pattern))
           OR (mi.item_type = 'custom'::public.menu_item_type AND mi.href ~ v_pattern)
         )
     AND NOT (
           mi.item_type = 'category'::public.menu_item_type
           AND EXISTS (
             SELECT 1 FROM public.categories live
              WHERE live.id = mi.ref_id AND live.tenant_id = m.tenant_id
           )
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.categories byslug
            WHERE byslug.tenant_id = m.tenant_id
              AND byslug.slug = (regexp_match(mi.href, v_pattern))[1]
         );
  RETURN v_total + public._menu_items_prune_dead(v_dead);
END;
$$;

COMMENT ON FUNCTION public._menu_items_repair_category_links() IS
  'Naprawa linków menu do kategorii (wszyscy najemcy, idempotentna): żywy ref_id dostaje bieżący adres, martwy ref_id z żywym adresem zostaje dowiązany, martwe linki /category/<slug> idą przez _menu_items_prune_dead. Zwraca liczbę zmienionych pozycji. Pomocnik wewnętrzny (migracja 20261011090000).';

REVOKE ALL ON FUNCTION public._menu_items_repair_category_links() FROM PUBLIC, anon, authenticated;

SELECT public._menu_items_repair_category_links();
