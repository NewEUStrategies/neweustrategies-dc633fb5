-- ============================================================================
-- MENU WITRYNY: CAŁE DRZEWO POZYCJI ZAPISYWANE W JEDNEJ TRANSAKCJI
-- ============================================================================
--
-- PRZYCZYNA ŹRÓDŁOWA. `saveMenuItems` (`src/lib/menus/menu.functions.ts`)
-- zapisywało menu SEKWENCJĄ osobnych żądań PostgREST na kliencie użytkownika:
-- dwie bramki `has_role`, odczyt menu, `DELETE` WSZYSTKICH pozycji, a potem
-- `INSERT` poziomami drzewa (BFS) - po jednym żądaniu na poziom. Każde żądanie
-- to własna transakcja, więc błąd w połowie (zerwane połączenie, limit czasu
-- Workera, naruszenie ograniczenia w jednej pozycji) zostawiał w bazie stan
-- ZATWIERDZONY: menu puste (padł pierwszy `INSERT`) albo obcięte do górnych
-- poziomów (padł `INSERT` dzieci). Nie było ani transakcji, ani odtworzenia -
-- stare pozycje były już skasowane, więc nie było z czego wrócić.
--
-- SKUTEK. Nawigacja serwisu znika albo traci podmenu PUBLICZNIE, na każdej
-- trasie z chrome: menu jest grzane w loaderze roota, a migawka kolonii (L2
-- `edgeTtlCache`) trzyma je do doby, więc pusty stan rozchodzi się dalej sam.
-- Drugi, cichszy skutek tej samej przyczyny: dwa równoległe zapisy (dwie karty,
-- dwóch redaktorów) przeplatały się żądanie po żądaniu - oba `DELETE` przed
-- oboma `INSERT` - więc menu kończyło z obiema partiami naraz, czyli
-- z podwójną nawigacją.
--
-- ROZWIĄZANIE. Jedna funkcja przyjmująca CAŁE drzewo. Funkcja plpgsql wykonuje
-- się w jednej transakcji, więc błąd na którejkolwiek pozycji wycofuje także
-- `DELETE` starych - czytelnik widzi stare menu albo nowe, nigdy stan pośredni.
-- Ten sam wybór i ten sam kształt (jsonb niesie pozycję jako CAŁOŚĆ) co
-- `set_user_consents(jsonb)` i `admin_event_sponsor_contacts_set(jsonb)`.
--
-- ZAKRES NAJEMCY - BEZ ZMIANY SEMANTYKI. Menu jest rozstrzygane po kluczu
-- w tenancie DOMOWYM wołającego (`current_tenant_id()`). Dokładnie tam trafiał
-- stary zapis: klient użytkownika w `saveMenu` nie niesie `x-tenant-assert`,
-- więc `menus_read_public` (`public_tenant_id()`) oddawało mu menu tenanta
-- domowego, a polityki `menu_items_staff_*` i tak wpuszczały zapis wyłącznie
-- tam. Funkcja NIE sięga po `public_tenant_id()`: SECURITY DEFINER łączący
-- tenanta z nagłówka z `has_role` to dokładnie wyciek, którego pilnuje
-- `scripts/check-sql-tenant-scope.ts` - admin tenanta A podrobiłby host B.
-- Menu innego tenanta jest więc dla tej funkcji NIEADRESOWALNE z konstrukcji.
--
-- BRAMKA 1:1 Z POLITYKAMI `menu_items_staff_*`: admin albo editor w tenancie
-- domowym. Wcześniej to samo sprawdzał kod aplikacji przed zapisem; teraz baza
-- jest jedynym miejscem decyzji, więc aplikacja nie płaci za to osobnej fali
-- round-tripów.
--
-- HIERARCHIA W BAZIE. Edytor wysyła `local_id` / `parent_local_id`, a funkcja
-- nadaje nowe UUID i mapuje rodziców sama - te same reguły, które dotąd
-- realizował BFS w TypeScripcie:
--   * SIEROTA (rodzic nieobecny w payloadzie) ląduje na najwyższym poziomie -
--     tak samo pokazuje ją edytor (`buildMenuTree`) i publiczne `SiteMenu`;
--   * pozycja w PIERŚCIENIU (A rodzicem B, B rodzicem A, albo A rodzicem
--     samego siebie) nie jest osiągalna z korzenia, więc nie jest zapisywana -
--     BFS nigdy jej nie wstawiał, a edytor i `SiteMenu` jej nie pokazują.
--     Odrzucenie całego zapisu byłoby gorsze: takiej pozycji nie da się
--     w edytorze zobaczyć ani usunąć, więc menu stałoby się niezapisywalne.
-- Wszystkie pozycje wchodzą JEDNYM `INSERT ... SELECT` uporządkowanym po
-- głębokości. Klucz obcy `parent_id` (NOT DEFERRABLE) jest sprawdzany na końcu
-- instrukcji, więc kolejność nie jest tu warunkiem poprawności - porządek po
-- głębokości zostaje jako determinizm, nie jako obejście.
--
-- BLOKADA. Sama transakcja nie wystarcza na równoległe zapisy: `DELETE`
-- drugiej transakcji nie widzi niezatwierdzonych pozycji pierwszej, więc obie
-- partie i tak by przeżyły. `FOR UPDATE` na wierszu menu szereguje zapisy tego
-- samego menu: drugi czeka na zatwierdzenie pierwszego, a jego `DELETE` (nowa
-- migawka READ COMMITTED po zdjęciu blokady) widzi już pozycje pierwszego
-- i je kasuje. Wygrywa zapis późniejszy - jak przy każdym „Zapisz".
--
-- WALIDACJA. Baza powtarza limity `saveMenuInputSchema` (tablica, najwyżej 500
-- pozycji, `local_id` wymagane i unikalne), bo wywołanie RPC może przyjść
-- z pominięciem walidatora Zod. Zdublowane `local_id` stary kod zamieniał
-- w konflikt klucza głównego W POŁOWIE zapisu - tu jest czytelnym błędem przed
-- jakąkolwiek zmianą. Typy pól pilnuje sama tabela (enum `menu_item_type`,
-- CHECK `menu_items_visibility_check`, rzutowania uuid/integer) - błąd każdego
-- z nich wycofuje całość.

CREATE OR REPLACE FUNCTION public.save_menu_items(p_menu_key text, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_menu_id uuid;
  v_saved integer;
BEGIN
  -- SECURITY DEFINER: brak użytkownika musi być odmową, a nie zapisem
  -- „na nikogo".
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'admin'::public.app_role)
    OR public.has_role(v_uid, 'editor'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden: staff role required' USING ERRCODE = '42501';
  END IF;

  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: caller has no tenant' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_payload: items must be an array' USING ERRCODE = '22023';
  END IF;

  -- Sufit odwzorowuje `saveMenuInputSchema` (`items` max 500).
  IF jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
       OR NULLIF(e.item ->> 'local_id', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_payload: local_id is required for every item' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS e(item)
    GROUP BY e.item ->> 'local_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'invalid_payload: duplicate local_id' USING ERRCODE = '22023';
  END IF;

  SELECT m.id INTO v_menu_id
  FROM public.menus m
  WHERE m.tenant_id = v_tenant
    AND m.key = p_menu_key
  FOR UPDATE;

  IF v_menu_id IS NULL THEN
    RAISE EXCEPTION 'menu_not_found' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.menu_items mi WHERE mi.menu_id = v_menu_id;

  -- `src` jest MATERIALIZED, bo niesie `gen_random_uuid()`: to samo UUID musi
  -- wyjść i jako `id` pozycji, i jako `parent_id` jej dzieci (samozłączenie
  -- niżej czyta `src` dwa razy).
  WITH RECURSIVE src AS MATERIALIZED (
    SELECT
      e.item,
      e.item ->> 'local_id' AS local_id,
      NULLIF(e.item ->> 'parent_local_id', '') AS parent_local_id,
      gen_random_uuid() AS id
    FROM jsonb_array_elements(p_items) AS e(item)
  ),
  linked AS (
    -- Rodzic spoza payloadu nie znajduje pary, więc `parent_id` wychodzi NULL:
    -- sierota trafia na najwyższy poziom.
    SELECT s.id, s.item, p.id AS parent_id
    FROM src s
    LEFT JOIN src p ON p.local_id = s.parent_local_id
  ),
  tree AS (
    SELECT l.id, l.parent_id, l.item, 0 AS depth
    FROM linked l
    WHERE l.parent_id IS NULL
    UNION ALL
    SELECT l.id, l.parent_id, l.item, t.depth + 1
    FROM linked l
    JOIN tree t ON l.parent_id = t.id
  )
  INSERT INTO public.menu_items (
    id, menu_id, parent_id, position, item_type, ref_id,
    label_pl, label_en, href, target, css_class, visibility, icon,
    mega_enabled, mega_config
  )
  SELECT
    t.id,
    v_menu_id,
    t.parent_id,
    COALESCE((t.item ->> 'position')::integer, 0),
    (t.item ->> 'item_type')::public.menu_item_type,
    NULLIF(t.item ->> 'ref_id', '')::uuid,
    COALESCE(t.item ->> 'label_pl', ''),
    COALESCE(t.item ->> 'label_en', ''),
    COALESCE(t.item ->> 'href', ''),
    COALESCE(NULLIF(t.item ->> 'target', ''), '_self'),
    COALESCE(t.item ->> 'css_class', ''),
    COALESCE(NULLIF(t.item ->> 'visibility', ''), 'all'),
    COALESCE(t.item ->> 'icon', ''),
    COALESCE((t.item ->> 'mega_enabled')::boolean, false),
    -- Kolumna jest NOT NULL, a jsonb `null` przeszedłby przez nią jako wartość:
    -- wszystko, co nie jest obiektem, schodzi do `{}` (odczyt i tak normalizuje
    -- przez `parseMegaConfig`).
    CASE
      WHEN jsonb_typeof(t.item -> 'mega_config') = 'object' THEN t.item -> 'mega_config'
      ELSE '{}'::jsonb
    END
  FROM tree t
  ORDER BY t.depth;

  GET DIAGNOSTICS v_saved = ROW_COUNT;
  RETURN v_saved;
END;
$$;

COMMENT ON FUNCTION public.save_menu_items(text, jsonb) IS
  'Zapisuje CAŁE drzewo pozycji menu (klucz w tenancie domowym wołającego) w JEDNEJ transakcji: kasuje stare pozycje i wstawia nowe albo nie zmienia niczego. p_items: [{local_id, parent_local_id, position, item_type, ref_id, label_pl, label_en, href, target, css_class, visibility, icon, mega_enabled, mega_config}]. UUID i rodziców mapuje baza; sierota ląduje na najwyższym poziomie, pozycja w pierścieniu nie jest zapisywana. Bramka: admin albo editor w tenancie domowym. Zwraca liczbę zapisanych pozycji.';

-- `anon` nie zapisuje menu; `authenticated` woła przez server-fn `saveMenu`,
-- a bramka roli jest w ciele funkcji.
REVOKE ALL ON FUNCTION public.save_menu_items(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_menu_items(text, jsonb) TO authenticated;
