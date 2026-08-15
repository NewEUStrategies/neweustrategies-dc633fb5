-- ============================================================================
-- KOTWICA WĄTKU KLUBOWEGO CZYTA JEDYNĄ TABELĘ PROGRAMÓW
--
-- Domknięcie `20260815100000_programs_single_table.sql`: po scaleniu
-- `research_programs` jest widokiem zgodności, a kanoniczną relacją jest
-- `public.programs`. Funkcja `SECURITY DEFINER` powinna celować w tabelę,
-- nie w widok - i tego pilnuje bramka `check:rpc-contract`.
--
-- DLACZEGO TO OSOBNY PLIK, A NIE CZĘŚĆ SCALENIA
-- `scripts/pg-harness` wybiera migracje do odtworzenia PO TREŚCI
-- (`grep -lE 'public\.(club_|admin_club_)'`), a nie po nazwie pliku - bo
-- panel Lovable nazywa migracje klubowe losowymi UUID-ami i glob po nazwie
-- zostawiał martwe pole. Selektor działa poprawnie: migracja scalająca
-- zawierała `public.club_anchor_label`, więc harness klubów wciągnął ją
-- w całości - razem z `ALTER TABLE public.programs`, której jego atrapa
-- schematu nie zna:
--
--   FAIL 20260815100000_programs_single_table.sql
--        ERROR: relation "public.programs" does not exist
--
-- Ten plik zawiera WYŁĄCZNIE redefinicję funkcji. Ciała plpgsql nie są
-- walidowane przy `CREATE`, więc w harnessie klubów wykonuje się tak samo
-- bezboleśnie, jak `20260808280000` odwołujące się do `research_programs`,
-- których tamta atrapa też nie ma. Granice modułów zostają uczciwe: scalenie
-- programów jest migracją programów, a redefinicja funkcji klubowej -
-- migracją klubu.
--
-- Ciało poniżej to kopia z `20260808280000` ze zmienioną WYŁĄCZNIE relacją
-- w gałęzi `research_program`.
-- ============================================================================

-- Etykieta kotwicy wątku klubowego (kopia z 20260808280000 - zmieniona
-- WYŁĄCZNIE relacja w gałęzi 'research_program').
CREATE OR REPLACE FUNCTION public.club_anchor_label(p_type text, p_id text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
BEGIN
  IF p_type IS NULL OR NULLIF(btrim(COALESCE(p_id, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;

  CASE p_type
    WHEN 'eu_policy_item' THEN
      SELECT COALESCE(NULLIF(btrim(i.title_pl), ''), NULLIF(btrim(i.title_en), ''))
        INTO v_label FROM public.eu_policy_items i WHERE i.id = p_id::uuid;
    WHEN 'post' THEN
      SELECT COALESCE(NULLIF(btrim(p.title_pl), ''), NULLIF(btrim(p.title_en), ''), p.slug)
        INTO v_label FROM public.posts p
       WHERE p.id = p_id::uuid AND p.deleted_at IS NULL;
    WHEN 'event' THEN
      SELECT COALESCE(NULLIF(btrim(e.title_pl), ''), NULLIF(btrim(e.title_en), ''), e.slug)
        INTO v_label FROM public.events e WHERE e.id = p_id::uuid;
    -- Programy nazywają kolumny `name_*`, nie `title_*` - różnica, która nie
    -- odezwałaby się przy CREATE, tylko przy pierwszym wątku zakotwiczonym
    -- w programie (ciało plpgsql nie jest walidowane).
    WHEN 'research_program' THEN
      SELECT COALESCE(NULLIF(btrim(r.name_pl), ''), NULLIF(btrim(r.name_en), ''), r.slug)
        INTO v_label FROM public.programs r WHERE r.id = p_id::uuid;
    WHEN 'club_thread' THEN
      v_label := public.club_linked_item_label('club_thread', p_id);
    ELSE
      v_label := NULL;
  END CASE;

  RETURN v_label;
EXCEPTION WHEN OTHERS THEN
  -- Kotwica wskazująca na skasowaną treść nie może wywalić CAŁEJ listy wątków.
  RETURN NULL;
END;
$$;

